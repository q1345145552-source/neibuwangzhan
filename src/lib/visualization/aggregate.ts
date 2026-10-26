import type { Gap, ModuleResult, Money, Options, Row, Source } from './types';
import { bangkokDay, utcMillis } from './time';
export const text = (value: unknown) => typeof value === 'string' ? value : '';
export function unique(rows: Row[], key: string): { rows: Row[]; conflicts: number } {
  const map = new Map<string, Row>(); const conflicting = new Set<string>(); let conflicts = 0;
  for (const row of rows) {
    const id = String(row[key] ?? '');
    if (!id) { conflicts++; continue; }
    const old = map.get(id);
    if (old && JSON.stringify(old) !== JSON.stringify(row)) { if (!conflicting.has(id)) conflicts++; conflicting.add(id); map.set(id, { [key]: row[key], _conflict: true }); }
    else if (!old) map.set(id, row);
  }
  return { rows: [...map.values()], conflicts };
}
export const moduleResult = <T>(data: T, gaps: Gap[] = []) => ({ status: gaps.length ? 'unknown' as const : 'success' as const, data, gaps });
export const failed = (): ModuleResult<never> => ({ status: 'failed', data: null, gaps: [{ code: 'READ_FAILED', count: 1 }] });
export function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) <= 0.00001;
}
export function money(rows: Row[]): Money {
  const result: Money = { CNY: 0, THB: 0, unknownCount: 0 };
  for (const row of rows) {
    if ((row.currency !== 'CNY' && row.currency !== 'THB') || !validAmount(row.amount)) { result.unknownCount++; continue; }
    const cents = Math.round(row.amount * 100);
    if (!Number.isSafeInteger(result[row.currency] + cents)) { result.unknownCount++; continue; }
    result[row.currency] += cents;
  }
  return result; // Integer minor units; never combine currencies.
}
export function orderAggregation(rows: Row[], options: Options, gap: Gap[]) {
  const statuses: Record<string, number> = {}, sources: Record<string, number> = {}, trend = new Map<string, { count: number; statuses: Record<string, number>; sources: Record<string, number> }>();
  // Include empty successful days; this is not a historical snapshot of statuses.
  for (let t = options.startUtc; t < options.endUtc; t += 86400000) trend.set(bangkokDay(t), { count: 0, statuses: {}, sources: {} });
  const periodStatuses: Record<string, number> = {}, periodSources: Record<string, number> = {}; let periodAwaiting = 0;
  let added = 0, missingDates = 0, awaiting = 0;
  for (const row of rows) {
    const status = text(row.status) || 'unknown'; const source = String(row.source);
    statuses[status] = (statuses[status] || 0) + 1; sources[source] = (sources[source] || 0) + 1;
    if (row.awaiting_confirmation) awaiting++;
    const time = utcMillis(row.created_at);
    if (time === null) { missingDates++; continue; }
    if (time >= options.startUtc && time < options.endUtc) {
      added++; periodStatuses[status] = (periodStatuses[status] || 0) + 1; periodSources[source] = (periodSources[source] || 0) + 1; if (row.awaiting_confirmation) periodAwaiting++; const item = trend.get(bangkokDay(time))!;
      item.count++; item.statuses[status] = (item.statuses[status] || 0) + 1; item.sources[source] = (item.sources[source] || 0) + 1;
    }
  }
  return moduleResult({ current: { unit: 'fulfillment', count: rows.length, statuses, sources, awaitingConfirmation: awaiting }, period: { unit: 'fulfillment', count: added, statuses: periodStatuses, sources: periodSources, awaitingConfirmation: periodAwaiting, dateUnknownCount: missingDates }, trend: [...trend].map(([date, value]) => ({ date, ...value })) }, [...gap, ...(missingDates ? [{ code: 'CREATED_AT_UNKNOWN', count: missingDates }] : [])]);
}
export function classifyOrders(orders: Row[], fulfills: Row[], inbox: Row[], parents: Row[], lines: Row[], sales: Row[]) {
  const saleIds = new Set(sales.map(r => text(r.id))); const lineMap = new Map(lines.map(r => [text(r.id), text(r.sale_id)]));
  const sourceIds = new Set(parents.map(r => text(r.source_order_no)));
  let broken = 0;
  const relations = new Map<string, Set<string>>();
  const add = (id: string, parent: string) => { const set = relations.get(id) || new Set<string>(); set.add(parent); relations.set(id, set); };
  for (const f of fulfills) {
    const parent = lineMap.get(text(f.line_id));
    if (!parent || !saleIds.has(parent)) { broken++; add(text(f.order_id), 'broken:commerce'); }
    else add(text(f.order_id), 'commerce:' + parent);
  }
  for (const f of inbox) {
    const id = text(f.internal_order_id); if (!id) continue;
    if (!sourceIds.has(text(f.source_order_no))) { broken++; add(id, 'broken:saved_source'); }
    else add(id, 'saved_source:' + text(f.source_order_no));
  }
  const orderIds = new Set(orders.map(r => text(r.id)));
  for (const id of relations.keys()) if (!orderIds.has(id)) broken++;
  const result: Row[] = orders.map(row => {
    const links = [...(relations.get(text(row.id)) || [])];
    let source: Source = 'local';
    if (links.length > 1) source = 'conflict';
    else if (links[0]?.startsWith('commerce:')) source = 'commerce';
    else if (links.length || text(row.source_system)) source = 'saved_source';
    const trusted = links.length === 1 && !links[0].startsWith('broken:');
    return { ...row, source, parentKey: trusted ? links[0] : null, href: '/orders/' + encodeURIComponent(text(row.id)) };
  });
  return { rows: result, gaps: broken ? [{ code: 'BROKEN_RELATION', count: broken }] : [] };
}
