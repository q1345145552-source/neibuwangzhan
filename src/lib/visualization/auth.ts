import type { Actor, Reader } from './types';
/** Preserve valid-account policy; malformed identity fields fail closed before any metrics. */
export function currentActor(payload: Record<string, unknown>, reader: Reader): Actor | null {
  if (!Number.isInteger(payload.id) || !Number.isInteger(payload.authVersion)) return null;
  const user = reader.get('SELECT name, role, must_change_password, auth_version, status FROM employees WHERE id = ?', payload.id);
  if (!user || typeof user.name !== 'string' || typeof user.role !== 'string' || typeof user.status !== 'string' ||
      !['admin','employee','client'].includes(user.role) || !['在职','试用期','待离职','停薪留职'].includes(user.status) ||
      user.must_change_password !== 0 || user.auth_version !== payload.authVersion) return null;
  return { id: payload.id as number, name: user.name, role: user.role };
}
