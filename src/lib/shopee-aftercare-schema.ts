import type Database from "better-sqlite3";

/** 扩展旧台账 CHECK；保留所有列、记录、入向外键、索引、触发器和自增序号。 */
export function ensureShopeeAftercareSchema(db: Database.Database): void {
  const needsMigration = () => {
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='shopee_stores' AND type='table'").get() as { sql: string } | undefined)?.sql;
    if (!sql) throw new Error("缺少店铺台账表");
    const check = sql.match(/CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i);
    if (!check) throw new Error("店铺状态约束异常，停止自动迁移");
    const hasColumn = (db.prepare('PRAGMA table_info(shopee_stores)').all() as { name: string }[]).some(c => c.name === 'aftercare_order_id');
    return !hasColumn || !check[1].split(',').some(v => v.trim() === "'售后'");
  };
  if (!needsMigration()) return;
  if (db.inTransaction) throw new Error("店铺台账迁移必须在独立事务执行");
  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (!needsMigration()) return;
      const before = new Set((db.pragma('foreign_key_check') as unknown[]).map(v => JSON.stringify(v)));
      const columns = db.prepare('PRAGMA table_info(shopee_stores)').all() as { name: string }[];
      if (!columns.some(c => c.name === 'aftercare_order_id')) db.exec('ALTER TABLE shopee_stores ADD COLUMN aftercare_order_id INTEGER REFERENCES shopee_orders(id) ON DELETE RESTRICT');
      const original = (db.prepare("SELECT sql FROM sqlite_master WHERE name='shopee_stores'").get() as { sql: string }).sql;
      const pattern = /CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)\s*\)/i;
      const match = original.match(pattern)!;
      if (!match[1].split(',').some(v => v.trim() === "'售后'")) {
        const temp = 'shopee_stores_aftercare_upgrade';
        if (db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(temp)) throw new Error('店铺迁移临时表已存在，停止迁移');
        const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='shopee_stores' AND type IN ('index','trigger') AND sql IS NOT NULL").all() as { sql: string }[];
        const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='shopee_stores'").get() as { seq: number } | undefined;
        const names = (db.prepare('PRAGMA table_info(shopee_stores)').all() as { name: string }[]).map(c => `"${c.name.replaceAll('"','""')}"`).join(',');
        const extended = original.replace(pattern, `CHECK(status IN (${match[1]},'售后'))`);
        const create = extended.replace(/^CREATE TABLE (?:IF NOT EXISTS )?["`]?shopee_stores["`]?/i, `CREATE TABLE ${temp}`);
        if (create === extended) throw new Error('店铺建表语句异常，停止迁移');
        db.exec(create);
        db.exec(`INSERT INTO ${temp} (${names}) SELECT ${names} FROM shopee_stores`);
        db.exec(`DROP TABLE shopee_stores; ALTER TABLE ${temp} RENAME TO shopee_stores`);
        if (sequence) {
          db.prepare("DELETE FROM sqlite_sequence WHERE name='shopee_stores'").run();
          db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('shopee_stores',?)").run(sequence.seq);
        }
        for (const object of objects) db.exec(object.sql);
      }
      if ((db.pragma('foreign_key_check') as unknown[]).some(v => !before.has(JSON.stringify(v)))) throw new Error('店铺迁移产生外键异常，已回滚');
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
