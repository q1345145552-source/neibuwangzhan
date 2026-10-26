import { bossPendingSubmissions } from '../boss-submissions';
import { readBilling } from '../commerce-ledger';
import { classifyOrders, failed, moduleResult, money, orderAggregation, text, unique, validAmount, incomeReviewState } from './aggregate';
import { QUERIES } from './queries';
import { utcMillis } from './time';
import { POLICY_VERSION, type Gap, type ModuleResult, type Options, type Reader, type Row } from './types';

/** Existing pure read functions receive ONLY this select facade, never the business DB initializer. */
function legacyReader(reader: Reader) {
  return { prepare: (sql: string) => ({ all: (...args: unknown[]) => reader.all(sql, ...args), get: (...args: unknown[]) => reader.get(sql, ...args) }) };
}
function paginate(rows: Row[], options: Options) {
  const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id), 'en'));
  const offset = (options.page - 1) * options.pageSize;
  return { total: sorted.length, items: sorted.slice(offset, offset + options.pageSize), page: options.page, pageSize: options.pageSize };
}

/** Presentation only, after statistics/subset/date selection: malformed typed fields are not free text. */
function safeDetailItems(rows:Row[],detail:Options['detail']):Row[] {
  return rows.map(row=>{
    const result={...row};
    for(const field of ['created_at','verify_at','submitted_at'])if(field in result&&utcMillis(result[field])===null)result[field]=null;
    if(detail==='orders')delete result.source_system;
    if(detail==='finances'){if(!validAmount(result.amount))result.amount=null;if(result.currency!=='CNY'&&result.currency!=='THB')result.currency=null;}
    if(detail==='billing'&&result.currency!=='CNY'&&result.currency!=='THB')result.currency=null;
    return result;
  });
}
export function overview(reader: Reader, options: Options, now = new Date()) {
  const cache = new Map<string, Row[]>();
  const all = (name: keyof typeof QUERIES) => {
    const sql = QUERIES[name];
    if (!cache.has(sql)) cache.set(sql, reader.all(sql));
    return cache.get(sql)!;
  };
  let orderRows: Row[] | null = null, parentRows: Row[] | null = null;
  let orders: ModuleResult<unknown> = failed(), parents: ModuleResult<unknown> = failed();
  const baseGaps: Gap[] = [];
  try {
    const raw = unique(all('orders'), 'id');
    const graph = classifyOrders(raw.rows, all('fulfillments'), all('inbox'), all('parents'), all('lines'), all('sales'));
    if (raw.conflicts) baseGaps.push({ code: 'CONFLICTING_ORDER_ID', count: raw.conflicts });
    baseGaps.push(...graph.gaps);
    let awaiting: Set<string> | null = null;
    try { awaiting = new Set(all('confirmations').map(r => text(r.id))); }
    catch { baseGaps.push({ code: 'CONFIRMATION_UNAVAILABLE', count: 1 }); }
    orderRows = graph.rows.filter(r => options.source === 'all' || r.source === options.source).map(r => ({ ...r, awaiting_confirmation: awaiting ? awaiting.has(text(r.id)) : null }));
    const conflicts = orderRows.filter(r => r.source === 'conflict').length;
    if (conflicts) baseGaps.push({ code: 'SOURCE_CONFLICT', count: conflicts });
    orders = orderAggregation(orderRows, options, baseGaps);
    const allParents: Row[] = [
      ...unique(all('sales'), 'id').rows.map(r => ({ id: 'commerce:' + r.id, parent_no: r.id, source: 'commerce', created_at: r.created_at })),
      ...unique(all('parents'), 'source_order_no').rows.map(r => ({ id: 'saved_source:' + r.source_order_no, parent_no: r.source_order_no, source: 'saved_source', created_at: r.created_at })),
    ];
    parentRows = allParents.filter(r => options.source === 'all' || options.source === r.source).map(r => ({ ...r, fulfillments: orderRows!.filter(o => o.parentKey === r.id).map(o => ({ id: o.id, href: o.href, status: o.status })) }));
    const parentStats = orderAggregation(parentRows, options, baseGaps);
    parents = moduleResult({ ...parentStats.data, period: { ...parentStats.data.period, unit: 'parent_transaction' }, current: { unit: 'parent_transaction', count: parentRows.length, bySource: { commerce: parentRows.filter(r => r.source === 'commerce').length, saved_source: parentRows.filter(r => r.source === 'saved_source').length } }, withoutTrustedParent: orderRows.filter(r => !r.parentKey).length }, parentStats.gaps);
  } catch { /* Failure is isolated; no zero fallback or raw database error. */ }

  let finances: ModuleResult<unknown> = failed(), billing: ModuleResult<unknown> = failed();
  let financeDetails: Row[] = [], billingDetails: Row[] = [];
  if (orderRows) {
    const ids = new Set(orderRows.map(r => text(r.id)));
    try {
      const raw = unique(all('finances'), 'id');
      const rows = raw.rows.filter(r => ids.has(text(r.order_id)));
      const refunds = new Set(all('refunds').map(r => String(r.finance_id)));
      financeDetails = rows.map(r => ({ ...r, amount_valid: validAmount(r.amount), currency_known: r.currency === 'CNY' || r.currency === 'THB', kind: refunds.has(String(r.id)) ? 'commerce_refund' : r.type === 'expense' ? 'cost' : 'income', href: '/orders/' + encodeURIComponent(text(r.order_id)) }));
      const paid = rows.filter(r => r.type === 'income' && r.status === 'paid');
      const waiting = rows.filter(r => incomeReviewState(r) === 'waiting');
      const notArrived = rows.filter(r => incomeReviewState(r) === 'not_arrived');
      const missingVerification = paid.filter(r => !text(r.verify_by) || utcMillis(r.verify_at) === null);
      const invalidMoney = money(rows).unknownCount;
      const gaps = [...baseGaps, ...(raw.conflicts ? [{ code: 'CONFLICTING_FINANCE_ID', count: raw.conflicts }] : []), ...(invalidMoney ? [{ code: 'MONEY_UNKNOWN', count: invalidMoney }] : [])];
      const orderIds = new Set(unique(all('orders'), 'id').rows.map(r => text(r.id)));
      const dangling = raw.rows.filter(r => !orderIds.has(text(r.order_id))).length;
      if (dangling) gaps.push({ code: 'FINANCE_ORDER_MISSING', count: dangling });
      finances = moduleResult({ unit: 'minor_currency_unit', label: '内部已记录到账收入', bankVerified: false, currentIncome: money(paid), currentIncomeCount: paid.length, missingVerification: { count: missingVerification.length, money: money(missingVerification) }, awaitingVerification: { count: waiting.length, money: money(waiting) }, notArrived: { count: notArrived.length, money: money(notArrived) }, detailsCount: financeDetails.length, financialTrend: { status: 'unsupported', reason: 'CONFIRMED_CREATION_TRENDS_ONLY' } }, gaps);
    } catch { /* other modules can still succeed */ }
    try {
      const saleIds = unique(all('sales'), 'id').rows.filter(r => options.source === 'all' || options.source === 'commerce');
      const connection = legacyReader(reader) as unknown as Parameters<typeof readBilling>[0];
      let total = 0, unknownCount = 0, mismatchCount = 0;
      const receiptRows = all('receipts'), invoiceRows = all('invoices'), credits = all('credits'), refunds = all('refunds'), financeMap = new Map(all('finances').map(r => [String(r.id), r]));
      for (const sale of saleIds) {
        const value = readBilling(connection, text(sale.id));
        const allocations = value.allocations;
        const links = allocations.map(a => ({ id: a.order_id, href: ids.has(a.order_id) ? '/orders/' + encodeURIComponent(a.order_id) : null }));
        const badRelation = !allocations.length || links.some(l => !l.href) || allocations.some(a => {
          const order = orderRows!.find(r => r.id === a.order_id);
          return order?.parentKey !== 'commerce:' + sale.id;
        });
        const linked = receiptRows.filter(r => allocations.some(a => a.order_id === r.order_id));
        const mismatch = linked.some(r => { const f = financeMap.get(String(r.finance_id)); return !f || f.status !== 'paid' || f.type !== 'income' || f.currency !== 'CNY'; });
        if (mismatch) mismatchCount++;
        const amounts = [value.original_cents, value.credited_cents, value.adjusted_cents, value.received_cents, value.refunded_cents, value.balance_due_cents, value.refund_due_cents];
        const invalidDetail = linked.some(r => { const f = financeMap.get(String(r.finance_id)); return !f || f.order_id !== r.order_id || money([f]).unknownCount > 0 || !invoiceRows.some(i => i.id === r.invoice_id && i.sale_id === sale.id); }) || [...credits.map(r => ({ ...r, cents: r.credit_cents } as Row)), ...refunds.map(r => ({ ...r, cents: r.amount_cents } as Row))].filter(r => allocations.some(a => a.order_id === r.order_id)).some(r => typeof r.cents !== 'number' || !Number.isSafeInteger(r.cents) || r.cents < 0);
        const valid = sale.currency === 'CNY' && !badRelation && !invalidDetail && amounts.every(n => Number.isSafeInteger(n) && n >= 0);
        if (valid) total += value.balance_due_cents; else unknownCount++;
        billingDetails.push({ id: sale.id, currency: sale.currency, status: valid ? 'success' : 'unknown', originalCents: valid ? value.original_cents : null, adjustedCents: valid ? value.adjusted_cents : null, creditedCents: valid ? value.credited_cents : null, receivedCents: valid ? value.received_cents : null, refundedCents: valid ? value.refunded_cents : null, dueCents: valid ? value.balance_due_cents : null, refundDueCents: valid ? value.refund_due_cents : null, mappedIncomeDiffersFromPaid: mismatch, fulfillments: links });
      }
      const gaps = [...baseGaps, ...(unknownCount ? [{ code: 'BILLING_UNKNOWN', count: unknownCount }] : []), ...(mismatchCount ? [{ code: 'MAPPED_INCOME_DIFFERS_FROM_PAID', count: mismatchCount }] : [])];
      billing = moduleResult({ unit: 'minor_currency_unit', currentDue: { CNY: total, unknownCount }, scope: 'commerce_only', recordCount: billingDetails.length }, gaps);
    } catch { billingDetails = []; }
  }
  let pending: ModuleResult<unknown> = failed(); let pendingDetails: Row[] = [];
  try {
    const original = bossPendingSubmissions(legacyReader(reader) as unknown as Parameters<typeof bossPendingSubmissions>[0]);
    pendingDetails = unique(original.items as unknown as Row[], 'id').rows;
    pending = moduleResult({ current: { unit: 'category_source_item', total: pendingDetails.length, counts: original.counts }, scope: 'existing_boss_categories', sourceFilterApplies: false });
  } catch { /* do not call /api/todos */ }
  const details = options.detail === 'orders' ? orderRows : options.detail === 'parents' ? parentRows : options.detail === 'finances' ? (finances.status === 'failed' ? null : financeDetails) : options.detail === 'billing' ? (billing.status === 'failed' ? null : billingDetails) : pending.status === 'failed' ? null : pendingDetails;
  const selectedDetails = details?.filter(row => {
    if (options.status && (text(row.status) || 'unknown') !== options.status) return false;
    if (options.category && row.category !== options.category) return false;
    if (options.currency && (options.currency === 'unknown' ? ['CNY', 'THB'].includes(text(row.currency)) : row.currency !== options.currency)) return false;
    switch (options.subset) {
      case 'awaiting': return row.awaiting_confirmation === true;
      case 'without_parent': return !row.parentKey;
      case 'date_unknown': return utcMillis(row.created_at) === null;
      case 'income_paid': return row.type === 'income' && row.status === 'paid';
      case 'income_waiting': return row.type === 'income' && ['待核对', 'pending'].includes(text(row.status));
      case 'income_not_arrived': return row.type === 'income' && row.status === '未到账';
      case 'missing_verification': return row.type === 'income' && row.status === 'paid' && (!text(row.verify_by) || utcMillis(row.verify_at) === null);
      case 'cost': return row.kind === 'cost';
      case 'refund': return row.kind === 'commerce_refund';
      default: return true;
    }
  });
  const detailModule = options.detail === 'orders' ? orders : options.detail === 'parents' ? parents : options.detail === 'finances' ? finances : options.detail === 'billing' ? billing : pending;
  const pageData=selectedDetails?paginate(options.basis === 'period' ? selectedDetails.filter(r => { const time = utcMillis(r.created_at); return time !== null && time >= options.startUtc && time < options.endUtc; }) : selectedDetails,options):null;
  return {
    policyVersion: POLICY_VERSION, generatedAt: now.toISOString(), timezone: 'Asia/Bangkok', scope: { source: options.source, internalSavedRecordsOnly: true, independentLedgersExcluded: ['vat', 'influencer'], currentStockDateFiltered: false, pendingSourceFilterApplies: false }, period: { fromInclusive: options.from, toExclusive: options.to, startUtc: new Date(options.startUtc).toISOString(), endUtc: new Date(options.endUtc).toISOString(), axis: 'internal_created_at', historicalRestatement: true },
    modules: { orders, parents, finances, billing, pending, delivery: { status: 'unsupported', reason: 'ROUND_6_READ_ADAPTER_NOT_IMPLEMENTED', units: ['order', 'step', 'requirement'], scope: 'existing-object-permission', fields: ['status', 'phase', 'currentSteps', 'assignee', 'materials'] }, overdue: { status: 'unsupported', reason: 'ROUND_7_READ_ADAPTER_NOT_IMPLEMENTED', algorithm: 'existing_workday_expected_days', missingConfiguration: 'unknown' }, exceptions: { status: 'unsupported', reason: 'ROUND_8_READ_ADAPTER_NOT_IMPLEMENTED', scope: 'admin', channels: ['progress', 'documents'], fields: ['eventId', 'attempts', 'nextAttemptAt', 'lastAcknowledgedAt'] } },
    details: selectedDetails ? moduleResult({ ...pageData!, items:safeDetailItems(pageData!.items,options.detail), selection: { subset: options.subset || 'all', status: options.status, currency: options.currency, category: options.category }, basis: options.basis, kind: options.detail }, detailModule.gaps) : failed(), consistency: 'sequential_read_only_current_records_not_historical_snapshot',
  };
}
