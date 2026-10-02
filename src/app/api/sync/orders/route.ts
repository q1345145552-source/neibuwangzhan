import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readJson } from '@/lib/req';
import { getDb, getOrderStepsWithDocs, logOperation } from '@/lib/db';
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from '@/lib/sync-auth';
import { mapSku } from '@/lib/storefront-mapping';
import { allocateCents, moneyToCents, splitCents } from '@/lib/sync-money';
import { queueProgressEventsForOrder, requestProgressFlush } from '@/lib/progress-sync';
import { assertSyncPayload, SyncContractError, SYNC_CONTRACT_VERSION, textField } from '@/lib/sync-contract';
import { notifyNewSyncedOrder, notifyUnclassifiedOrder } from '@/lib/order-alerts';

interface SyncLine {
  line_no: number;
  sku_code: string | null;
  quantity: number;
  amount: number;
  amountCents: number;
  raw: Record<string, unknown>;
}
interface SyncOrder {
  source: 'storefront' | 'recurring';
  sourceOrderNo: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  revision: number;
  totalCents: number;
  discountCents: number;
  netCents: number;
  lines: SyncLine[];
  identityJson: string;
  financialJson: string;
  payload: string;
}
interface InboxRow {
  id: string;
  line_no: number;
  copy_no: number;
  internal_order_id: string | null;
  note: string;
}
interface SyncResult { line_no: number; copy: number; status: string; order_id?: string; note?: string }
class SyncConflict extends Error {}

function parseOrder(body: unknown): SyncOrder {
  assertSyncPayload(body);
  const sourceOrderNo = body.source_order_no as string;
  const source = body.source as SyncOrder['source'];
  const revision = body.billing_revision as number;
  const customer = body.customer as Record<string, unknown>;
  const customerId = customer.id as string;
  const customerName = textField(customer.name, 'customer.name', 100, false);
  const customerEmail = textField(customer.email, 'customer.email', 254, false);
  const currency = body.currency as string;
  const totalCents = moneyToCents(body.total_amount, 'total_amount');
  const discountCents = moneyToCents(body.discount, 'discount');
  const netCents = totalCents - discountCents;
  // Deposit is payment scheduling, not an additional price discount.
  const depositCents = body.deposit === undefined ? 0 : moneyToCents(body.deposit, 'deposit');
  const billingStatus = textField(body.billing_status, 'billing_status', 32, false);
  const lines: SyncLine[] = (body.lines as Record<string, unknown>[]).map(raw => ({
    line_no: raw.line_no as number,
    sku_code: raw.sku_code === undefined || raw.sku_code === null ? null : raw.sku_code as string,
    quantity: raw.quantity as number,
    amount: raw.amount as number,
    amountCents: moneyToCents(raw.amount, 'lines.amount'),
    raw,
  })).sort((a,b) => a.line_no-b.line_no);
  const identityJson = JSON.stringify({ source, currency, customerId, lines: lines.map(line => ({
    line_no: line.line_no, sku_code: line.sku_code, quantity: line.quantity, amount_cents: line.amountCents,
  })) });
  const financialJson = JSON.stringify({ totalCents, discountCents, depositCents, billingStatus });
  return { source, sourceOrderNo, customerId, customerName, customerEmail, currency, revision,
    totalCents, discountCents, netCents, lines, identityJson, financialJson, payload: JSON.stringify(body) };
}

/** Service-to-service reception. Stable account identity + billing revision + integer-cent ledger. */
export async function POST(req: NextRequest) {
  if (syncRateLimited(req)) return NextResponse.json({ error: '尝试过于频繁，请稍后再试' }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  let order: SyncOrder;
  try { order = parseOrder(await readJson(req)); }
  catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : '请求格式错误',
      ...(error instanceof SyncContractError ? { code: error.code, contractVersion: SYNC_CONTRACT_VERSION, field: error.field } : {}),
    }, { status: 400 });
  }
  const db = getDb();
  const { sourceOrderNo, customerId, revision } = order;
  let acceptedRevision = revision;
  let receptionStatus = 'created';
  const results: SyncResult[] = [];
  function assertLedgerTotal() {
    const ledger = db.prepare('SELECT sum(allocated_cents) AS total, sum(allocated_cents IS NULL OR allocated_cents<0) AS invalid FROM sync_inbox WHERE source_order_no=?')
      .get(sourceOrderNo) as {total:number;invalid:number};
    if (ledger.total !== order.netCents || ledger.invalid !== 0) throw new Error('分摊台账金额不守恒');
  }
  const ingest = db.transaction(() => {
    const existing = db.prepare('SELECT billing_revision,identity_json,financial_json FROM sync_orders WHERE source_order_no=?').get(sourceOrderNo) as {
      billing_revision: number; identity_json: string; financial_json: string;
    } | undefined;
    const inboxRows = db.prepare('SELECT id,line_no,copy_no,internal_order_id,note FROM sync_inbox WHERE source_order_no=? ORDER BY line_no,copy_no').all(sourceOrderNo) as InboxRow[];
    if (!existing && inboxRows.length) {
      // Legacy inbox never retained a trustworthy customer ID or full parent snapshot.
      // Automatic claiming/rebuilding would cross-bind buyers or duplicate fulfillment.
      throw new SyncConflict('旧同步单缺少可信父单和账号台账，需要管理员先核对关联');
    }
    if (existing && existing.identity_json !== order.identityJson) throw new SyncConflict('来源账号、币种或原始订单行发生冲突');
    if (existing) {
      const expectedLineNumbers = new Set(order.lines.map(line => line.line_no));
      if (!inboxRows.length || inboxRows.some(row => !expectedLineNumbers.has(row.line_no))) {
        throw new SyncConflict('已有拆单台账缺失或包含未知行，需要核对后重试');
      }
      for (const line of order.lines) {
        const rows = inboxRows.filter(row => row.line_no === line.line_no);
        const nonOrder = rows.length === 1 && rows[0].internal_order_id === null;
        if (rows.length !== (nonOrder ? 1 : line.quantity) || rows.some((row,j) => row.copy_no !== j+1 || (!nonOrder && !row.internal_order_id))) {
          throw new SyncConflict('已有拆单台账不完整，需要核对后重试');
        }
      }
    }
    if (existing && revision <= existing.billing_revision) {
      if (revision === existing.billing_revision && existing.financial_json !== order.financialJson) throw new SyncConflict('相同账单版本包含不同金额或付款状态');
      acceptedRevision = existing.billing_revision;
      receptionStatus = revision < existing.billing_revision ? 'stale' : 'duplicate';
      for (const row of inboxRows) results.push({line_no:row.line_no,copy:row.copy_no,status:receptionStatus,order_id:row.internal_order_id || undefined});
      return;
    }
    const allocatedLines = allocateCents(order.netCents, order.lines.map(line => line.amountCents));
    if (existing) {
      // Financial revisions update the existing ledger/amounts only. No remapping or step recreation.
      receptionStatus = 'updated';
      for (let i = 0; i < order.lines.length; i++) {
        const line = order.lines[i];
        const rows = inboxRows.filter(row => row.line_no === line.line_no);
        const nonOrder = rows.length === 1 && rows[0].internal_order_id === null;
        const expectedCopies = nonOrder ? 1 : line.quantity;
        if (rows.length !== expectedCopies || rows.some((row,j) => row.copy_no !== j+1 || (!nonOrder && !row.internal_order_id))) {
          throw new SyncConflict('已有拆单台账不完整，需要核对后重试');
        }
        const allocations = splitCents(allocatedLines[i], expectedCopies);
        for (let j = 0; j < rows.length; j++) {
          const row = rows[j];
          if (row.internal_order_id) {
            const update = db.prepare('UPDATE orders SET total_amount=?,updated_at=? WHERE id=? AND source_system=? AND source_customer_id=?')
              .run(allocations[j]/100,new Date().toISOString(),row.internal_order_id,'storefront',customerId);
            if (update.changes !== 1) throw new SyncConflict('已有办理单归属不匹配或记录缺失');
          }
          db.prepare('UPDATE sync_inbox SET allocated_cents=?,allocated_amount=?,billing_revision=?,payload=? WHERE id=?')
            .run(allocations[j],allocations[j]/100,revision,JSON.stringify(line.raw),row.id);
          results.push({line_no:line.line_no,copy:row.copy_no,status:'updated',order_id:row.internal_order_id || undefined});
        }
      }
      db.prepare(`UPDATE sync_orders SET billing_revision=?,total_cents=?,discount_cents=?,net_cents=?,financial_json=?,payload=?,updated_at=datetime('now') WHERE source_order_no=?`)
        .run(revision,order.totalCents,order.discountCents,order.netCents,order.financialJson,order.payload,sourceOrderNo);
      assertLedgerTotal();
      return;
    }
    db.prepare(`INSERT INTO sync_orders(source_order_no,source_customer_id,source,currency,billing_revision,total_cents,discount_cents,net_cents,identity_json,financial_json,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(sourceOrderNo,customerId,order.source,order.currency,revision,order.totalCents,order.discountCents,order.netCents,order.identityJson,order.financialJson,order.payload);
    const mappedLines: string[] = [];
    for (let i = 0; i < order.lines.length; i++) {
      const line = order.lines[i];
      const mapping = mapSku(line.sku_code);
      const noOrderNote = order.source === 'recurring' ? '周期账单，不建办理单'
        : mapping.kind === 'attachment' ? '附加费行，随主服务收取，不独立办理'
        : mapping.kind === 'reference' ? '参考资料，不建办理单' : null;
      if (noOrderNote) {
        db.prepare(`INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,note,payload,allocated_cents,allocated_amount,billing_revision) VALUES (?,?,?,1,?,?,?,?,?,?)`)
          .run(randomUUID(),sourceOrderNo,line.line_no,line.sku_code,noOrderNote,JSON.stringify(line.raw),allocatedLines[i],allocatedLines[i]/100,revision);
        results.push({line_no:line.line_no,copy:1,status:'skipped',note:noOrderNote});
        continue;
      }
      const businessTypeName = mapping.kind === 'mapped' ? mapping.businessTypeName : '待分类';
      const subServiceType = mapping.kind === 'mapped' ? mapping.subServiceType : 'storefront-unclassified';
      const addressType = mapping.kind === 'mapped' ? mapping.addressType : 'client';
      const note = mapping.kind === 'unclassified' ? mapping.note || '' : '';
      // 待分类提醒（规则 6）：全体在职员工每人一条，谁看到谁领取（订单列表按「待分类」业务线筛选即待领取队列）
      if (mapping.kind === 'unclassified')
        notifyUnclassifiedOrder(db, sourceOrderNo, `客户站同步单 ${sourceOrderNo}（${order.customerName || order.customerEmail}）的 SKU ${line.sku_code ?? '无'} 未匹配业务线${note ? '：' + note : ''}。请在订单列表「待分类」业务线中认领并归类。`);
      const bt = db.prepare('SELECT id FROM business_types WHERE name=?').get(businessTypeName) as {id:number} | undefined;
      if (!bt) throw new Error(`业务线不存在: ${businessTypeName}`);
      if (mapping.kind === 'mapped') mappedLines.push(`${String(line.raw.sku_name || line.sku_code)} ×${line.quantity}份 → ${businessTypeName}`);
      const allocations = splitCents(allocatedLines[i],line.quantity);
      for (let c = 1; c <= line.quantity; c++) {
        const id = `ORD-${randomUUID()}`;
        const now = new Date().toISOString();
        const description = [`客户站同步单 ${sourceOrderNo} #${line.line_no}-${c}/${line.quantity}份`, `SKU ${line.sku_code ?? '无'}`,
          `来源账号 ${customerId}`, order.customerEmail ? `邮箱 ${order.customerEmail}` : '', note ? `备注:${note}` : ''].filter(Boolean).join(' · ');
        db.prepare(`INSERT INTO orders(id,customer_name,business_type_id,sub_service_type,address_type,monthly_rent,status,responsible_person,description,total_amount,currency,trademark_name,created_at,updated_at,source_system,source_customer_id)
          VALUES (?,?,?,?,?,0,'待处理','',?,?,?,'',?,?,'storefront',?)`)
          .run(id,order.customerName || order.customerEmail || customerId,bt.id,subServiceType,addressType,description,allocations[c-1]/100,order.currency,now,now,customerId);
        const insertStep = db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee,notes) VALUES (?,?,?,'待处理',?,?)");
        const insertDoc = db.prepare("INSERT INTO step_documents(step_id,order_id,document_name,status) VALUES (?,?,?,'pending')");
        getOrderStepsWithDocs(bt.id,subServiceType,addressType).forEach((step,index) => {
          const result = insertStep.run(id,step.name,index+1,step.assignee,step.notes || '');
          for (const name of step.docs) insertDoc.run(result.lastInsertRowid,id,name);
        });
        db.prepare(`INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,allocated_cents,allocated_amount,billing_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(randomUUID(),sourceOrderNo,line.line_no,c,line.sku_code,id,note,JSON.stringify(line.raw),allocations[c-1],allocations[c-1]/100,revision);
        queueProgressEventsForOrder(id, db);
        results.push({line_no:line.line_no,copy:c,status:'created',order_id:id});
      }
    }
    // 新单提醒（2026-10-03 老板定：对上业务线的新单也提醒全体员工；待分类行已有上面的待领取提醒）
    if (mappedLines.length)
      notifyNewSyncedOrder(db, sourceOrderNo, `客户站新订单 ${sourceOrderNo}（${order.customerName || order.customerEmail}）：${mappedLines.join('；')}。已按流程建好办理单，可在订单列表查看。`);
    assertLedgerTotal();
  });
  try { ingest(); }
  catch (error) {
    if (error instanceof SyncConflict) return NextResponse.json({error:error.message}, {status:409});
    console.error('[POST /api/sync/orders] transaction rolled back:',error);
    return NextResponse.json({error:'接单事务失败，保留原单等待重试'}, {status:500});
  }
  logOperation('客户站同步','接收订单','order',sourceOrderNo,JSON.stringify({billing_revision:acceptedRevision,status:receptionStatus,results}));
  requestProgressFlush();
  return NextResponse.json({received:true,source_order_no:sourceOrderNo,billing_revision:acceptedRevision,status:receptionStatus,results});
}
