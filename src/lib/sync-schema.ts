import type Database from 'better-sqlite3';

const INBOX_COLUMNS = `
  id TEXT PRIMARY KEY,
  source_order_no TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  copy_no INTEGER NOT NULL DEFAULT 1,
  sku_code TEXT,
  internal_order_id TEXT,
  note TEXT DEFAULT '',
  payload TEXT NOT NULL,
  progress_seq INTEGER NOT NULL DEFAULT 0,
  allocated_cents INTEGER,
  allocated_amount REAL,
  billing_revision INTEGER,
  received_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_order_no, line_no, copy_no)`;

/** Additive/idempotent upgrades, including the first inbox version's two-column unique key. */
export function initializeSyncSchema(database: Database.Database): void {
  // Acquire the write reservation before schema reads; deferred upgrades can deadlock across workers.
  database.transaction(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS sync_inbox (${INBOX_COLUMNS})`);
    const columns = new Set((database.prepare('PRAGMA table_info(sync_inbox)').all() as {name:string}[]).map(c => c.name));
    const additions: Record<string,string> = {
      copy_no: 'INTEGER NOT NULL DEFAULT 1', progress_seq: 'INTEGER NOT NULL DEFAULT 0',
      allocated_cents: 'INTEGER', allocated_amount: 'REAL', billing_revision: 'INTEGER',
    };
    for(const [column,type] of Object.entries(additions)) {
      if(!columns.has(column)) database.exec(`ALTER TABLE sync_inbox ADD COLUMN ${column} ${type}`);
    }
    const indexes = database.prepare('PRAGMA index_list(sync_inbox)').all() as {name:string;unique:number}[];
    const oldUnique = indexes.some(index => {
      if(!index.unique) return false;
      const names = (database.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name) as {name:string}[]).map(c => c.name);
      return names.length === 2 && names.includes('source_order_no') && names.includes('line_no');
    });
    if(oldUnique) {
      database.exec(`CREATE TABLE sync_inbox_upgrade (${INBOX_COLUMNS});
        INSERT INTO sync_inbox_upgrade (id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,progress_seq,allocated_cents,allocated_amount,billing_revision,received_at)
          SELECT id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,progress_seq,allocated_cents,allocated_amount,billing_revision,received_at FROM sync_inbox;
        DROP TABLE sync_inbox;
        ALTER TABLE sync_inbox_upgrade RENAME TO sync_inbox;`);
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_sync_inbox_internal_order ON sync_inbox(internal_order_id);
      CREATE TABLE IF NOT EXISTS sync_orders (
        source_order_no TEXT PRIMARY KEY,
        source_customer_id TEXT NOT NULL,
        source TEXT NOT NULL,
        currency TEXT NOT NULL,
        billing_revision INTEGER NOT NULL CHECK(billing_revision > 0),
        total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
        discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
        net_cents INTEGER NOT NULL CHECK(net_cents >= 0),
        identity_json TEXT NOT NULL,
        financial_json TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TRIGGER IF NOT EXISTS sync_orders_identity_immutable
      BEFORE UPDATE OF source_customer_id,source,source_order_no,currency,identity_json ON sync_orders
      WHEN NEW.source_customer_id IS NOT OLD.source_customer_id OR NEW.source IS NOT OLD.source
        OR NEW.source_order_no IS NOT OLD.source_order_no OR NEW.currency IS NOT OLD.currency OR NEW.identity_json IS NOT OLD.identity_json
      BEGIN SELECT RAISE(ABORT, 'sync order identity is immutable'); END;

      -- 资料打通（2026-10-03，规则 12）：客户站送来的资料 ↔ 内部 documents 行。
      -- 一份资料挂到该客户单拆出的每一份办理单上（文件只存一份）；review_seq 是回传审核结果的版本。
      CREATE TABLE IF NOT EXISTS sync_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_order_no TEXT NOT NULL,
        submission_id TEXT NOT NULL,
        internal_order_id TEXT NOT NULL,
        document_id INTEGER NOT NULL,
        review_seq INTEGER NOT NULL DEFAULT 0,
        withdrawn INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(submission_id, internal_order_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sync_documents_document ON sync_documents(document_id);
      -- 补件要求（2026-10-03，规则 13）：员工发给客户站客户的补件要求；客户按它交的资料到达时记 submitted_at
      CREATE TABLE IF NOT EXISTS sync_document_requests (
        id TEXT PRIMARY KEY,
        source_order_no TEXT NOT NULL,
        internal_order_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        submitted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_document_requests_order ON sync_document_requests(internal_order_id);
      -- 回传客户站的发送队列（与业务写入同事务入队，提交后再发）：资料审核结果、补件要求、交付文件。
      -- submission_id 列作通用键（审核=客户站资料号，补件=request_id，交付=delivery_id），payload.event 决定发往哪个接口。
      CREATE TABLE IF NOT EXISTS sync_document_outbox (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        sent_at TEXT
      );
    `);
    const orderColumns = new Set((database.prepare('PRAGMA table_info(orders)').all() as {name:string}[]).map(c => c.name));
    if(!orderColumns.has('source_system')) database.exec("ALTER TABLE orders ADD COLUMN source_system TEXT NOT NULL DEFAULT ''");
    if(!orderColumns.has('source_customer_id')) database.exec('ALTER TABLE orders ADD COLUMN source_customer_id TEXT');
    // Old inbox rows have no trustworthy buyer ID: mark them external-origin, never infer from names.
    database.exec(`UPDATE orders SET source_system='storefront'
      WHERE source_system='' AND EXISTS (SELECT 1 FROM sync_inbox si WHERE si.internal_order_id=orders.id)`);
  }).immediate();
}
