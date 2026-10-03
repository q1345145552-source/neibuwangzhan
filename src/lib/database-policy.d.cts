import type Database from 'better-sqlite3';
export type DatabaseKind = 'client' | 'internal';
export function preflight(filename: string, kind: DatabaseKind, allowEmpty?: boolean): { existing: boolean; initialize: boolean };
export function openChecked(filename: string, kind: DatabaseKind, allowEmpty?: boolean): Database.Database;
export function validate(database: Database.Database, kind: DatabaseKind): boolean;
export function backup(filename: string, destination: string, kind: DatabaseKind): Promise<{ source: string; destination: string; identity: DatabaseKind; sourceCountsBeforeSnapshot: Record<string, number> }>;
