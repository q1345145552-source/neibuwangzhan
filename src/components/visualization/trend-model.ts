import { nextDay, type DetailSpec, type Filter } from './model';
export type TrendDay = { date: string; count: number; sources: Record<string, number>; statuses: Record<string, number> };
export type TrendBucket = { label: string; from: string; end: string; count: number; sources: Record<string, number>; statuses: Record<string, number>; partialMonth: boolean };
export type TrendGroup = 'total' | 'source' | 'status';
/** Presentation-only rollup of the COMPLETE server day series, never detail-page rows. */
export function bucketDays(days: TrendDay[], granularity: 'day' | 'month'): TrendBucket[] {
  const buckets = new Map<string, TrendBucket>();
  for (const day of days) {
    const key = granularity === 'month' ? day.date.slice(0, 7) : day.date;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { label: key, from: day.date, end: day.date, count: 0, sources: {}, statuses: {}, partialMonth: false }; buckets.set(key, bucket); }
    bucket.end = day.date; bucket.count += day.count;
    for (const [name, count] of Object.entries(day.sources)) bucket.sources[name] = (bucket.sources[name] || 0) + count;
    for (const [name, count] of Object.entries(day.statuses)) bucket.statuses[name] = (bucket.statuses[name] || 0) + count;
  }
  return [...buckets.values()].map(bucket => ({ ...bucket, partialMonth: granularity === 'month' && (bucket.from.slice(8) !== '01' || nextDay(bucket.end).slice(8) !== '01') }));
}
export function bucketValue(bucket: TrendBucket, group: TrendGroup, selection: string): number {
  return group === 'total' ? bucket.count : group === 'source' ? bucket.sources[selection] || 0 : bucket.statuses[selection] || 0;
}
export function trendDetail(bucket: TrendBucket, unit: 'orders' | 'parents', group: TrendGroup, selection: string, label: string): DetailSpec {
  return { title: `内部创建趋势 · ${bucket.label} · ${label} · ${unit === 'orders' ? '办理份' : '父交易'}`, detail: unit, basis: 'period', from: bucket.from, end: bucket.end, ...(group === 'source' ? { source: selection } : group === 'status' ? { status: selection } : {}) };
}
export function trendScopeText(filter: Filter) { return `${filter.from} 至 ${filter.end}（含结束日）· 曼谷内部创建 / 接收日期`; }
