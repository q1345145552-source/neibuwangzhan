export const POLICY_VERSION = 'internal-visualization/2026-10-26/confirmed-v1';
export type Row = Record<string, unknown>;
export type Actor = { id: number; name: string; role: string };
export interface Reader { all(sql: string, ...args: unknown[]): Row[]; get(sql: string, ...args: unknown[]): Row | undefined }
export type Gap = { code: string; count: number };
export type ModuleResult<T> = { status: 'success' | 'unknown'; data: T; gaps: Gap[] } | { status: 'failed' | 'unsupported'; data: null; gaps: Gap[] };
export type Source = 'local' | 'commerce' | 'saved_source' | 'conflict';
export type Options = { from: string; to: string; startUtc: number; endUtc: number; page: number; pageSize: number; basis: 'current' | 'period'; source: 'all' | Source; detail: 'orders' | 'parents' | 'finances' | 'billing' | 'pending' };
export type DeliveryBoundary = { status: 'unsupported'; reason: string; units: readonly ['order', 'step', 'requirement']; scope: 'existing-object-permission'; fields: readonly string[] };
export type ExceptionBoundary = { status: 'unsupported'; reason: string; scope: 'admin'; channels: readonly ['progress', 'documents']; fields: readonly string[] };
export type Money = { CNY: number; THB: number; unknownCount: number };
export type Page = { items: Row[]; total: number; page: number; pageSize: number };
