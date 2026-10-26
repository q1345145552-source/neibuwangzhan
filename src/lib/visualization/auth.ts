import type { Actor, Reader } from './types';
/** Same current-account/auth_version/password-change/revocation checks as existing auth.ts. */
export function currentActor(payload: Record<string, unknown>, reader: Reader): Actor | null {
  if (!Number.isInteger(payload.id) || !Number.isInteger(payload.authVersion)) return null;
  const user = reader.get('SELECT name, role, must_change_password, auth_version, status FROM employees WHERE id = ?', payload.id);
  if (!user || user.auth_version !== payload.authVersion || user.status === '离职' || user.must_change_password === 1 || typeof user.name !== 'string' || typeof user.role !== 'string') return null;
  return { id: payload.id as number, name: user.name, role: user.role };
}
