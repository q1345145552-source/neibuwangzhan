import type { Options } from './types';
/** SQLite UTC strings and explicit ISO offsets only. Never infer the host timezone. */
export function utcMillis(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  let input = value;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input)) input = input.replace(' ', 'T') + 'Z';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input)) return null;
  const clock = input.slice(11, 19).split(':').map(Number);
  if (clock[0] > 23 || clock[1] > 59 || clock[2] > 59) return null;
  const n = Date.parse(input);
  return Number.isFinite(n) && validDay(input.slice(0, 10)) ? n : null;
}
function validDay(day: string): boolean {
  const value = Date.parse(day + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === day;
}
export function parseOptions(url: URL): Options {
  const allowed = new Set(['from', 'to', 'page', 'pageSize', 'source', 'detail', 'basis']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('INVALID_QUERY');
  const from = url.searchParams.get('from') || '', to = url.searchParams.get('to') || '';
  if (!validDay(from) || !validDay(to)) throw new Error('INVALID_DATE');
  const startUtc = Date.parse(from + 'T00:00:00+07:00');
  const endUtc = Date.parse(to + 'T00:00:00+07:00');
  if (endUtc <= startUtc || endUtc - startUtc > 366 * 86400000) throw new Error('INVALID_RANGE');
  function integer(key: string, fallback: number, max: number) {
    const value = url.searchParams.get(key);
    if (value === null) return fallback;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new Error('INVALID_PAGE');
    return Number(value);
  }
  const source = url.searchParams.get('source') || 'all';
  const detail = url.searchParams.get('detail') || 'orders';
  const basis = url.searchParams.get('basis') || 'current';
  if (!['current', 'period'].includes(basis) || (basis === 'period' && !['orders', 'parents'].includes(detail))) throw new Error('INVALID_BASIS');
  if (!['all', 'local', 'commerce', 'saved_source', 'conflict'].includes(source) || !['orders', 'parents', 'finances', 'billing', 'pending'].includes(detail)) throw new Error('INVALID_FILTER');
  return { from, to, startUtc, endUtc, page: integer('page', 1, 1000000), pageSize: integer('pageSize', 25, 100), basis: basis as Options['basis'], source: source as Options['source'], detail: detail as Options['detail'] };
}
export function bangkokDay(ms: number): string { return new Date(ms + 7 * 3600000).toISOString().slice(0, 10); }
