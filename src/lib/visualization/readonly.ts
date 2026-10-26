import type { Reader, Row } from './types';
export interface SelectConnection { prepare(sql: string): { readonly: boolean; all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown }; close(): void }
/** The driver must itself be opened readonly + fileMustExist. No business DB getter. */
export function readOnlyReader(connection: SelectConnection): Reader {
  function statement(sql: string) {
    // Only a single SELECT statement; comments and multi-statements are deliberately unsupported.
    if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw new Error('READ_ONLY_QUERY_REQUIRED');
    const stmt = connection.prepare(sql);
    if (!stmt.readonly) throw new Error('READ_ONLY_QUERY_REQUIRED');
    return stmt;
  }
  return Object.freeze({
    all: (sql: string, ...args: unknown[]) => statement(sql).all(...args) as Row[],
    get: (sql: string, ...args: unknown[]) => statement(sql).get(...args) as Row | undefined,
  });
}
