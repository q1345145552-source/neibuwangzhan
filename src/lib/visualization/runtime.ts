import path from 'node:path';
import { jwtVerify } from 'jose';
import { currentActor } from './auth';
import { readOnlyReader, type SelectConnection } from './readonly';
import type { OpenSession } from './handler';
/** Never import auth.ts/db.ts/runtime-config: those paths initialize/migrate or load .env. */
export const openSession: OpenSession = async request => {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const secret = process.env.JWT_SECRET;
  // Fail closed instead of copying the legacy development fallback secret.
  if (!secret) throw new Error('AUTH_CONFIG_UNAVAILABLE');
  let payload: Record<string, unknown>;
  try { payload = (await jwtVerify(header.slice(7), new TextEncoder().encode(secret), { algorithms: ['HS256'] })).payload; }
  catch { return null; }
  if (!Number.isInteger(payload.id) || !Number.isInteger(payload.authVersion)) return null;
  const { default: Database } = await import('better-sqlite3');
  const root = path.resolve(process.env.INTERNAL_APP_ROOT || process.cwd());
  const filename = path.resolve(root, process.env.DB_PATH || 'data.db');
  // Implementation only. Never opened against real or temporary SQLite in validation.
  const connection = new Database(filename, { readonly: true, fileMustExist: true }) as unknown as SelectConnection;
  try {
    const reader = readOnlyReader(connection);
    const actor = currentActor(payload, reader);
    return { actor, reader, close: () => connection.close() };
  } catch (error) { connection.close(); throw error; }
};
