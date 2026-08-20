import type Database from "better-sqlite3";

export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

interface LoginState {
  failed_login_attempts: number;
  locked_until: number;
}

export interface LoginLock {
  retryAfterSeconds: number;
}

function toLock(lockedUntil: number, now: number): LoginLock | null {
  if (lockedUntil <= now) return null;
  return { retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)) };
}

export function getLoginLock(
  db: Database.Database,
  employeeId: number,
  now = Date.now()
): LoginLock | null {
  const state = db.prepare(
    "SELECT failed_login_attempts, locked_until FROM employees WHERE id = ?"
  ).get(employeeId) as LoginState | undefined;
  if (!state) return null;

  const lock = toLock(state.locked_until || 0, now);
  if (lock) return lock;

  // 锁定期已结束，从新一轮连续失败重新计数。
  if (state.locked_until > 0) {
    db.prepare(
      "UPDATE employees SET failed_login_attempts = 0, locked_until = 0 WHERE id = ?"
    ).run(employeeId);
  }
  return null;
}

export function recordFailedLogin(
  db: Database.Database,
  employeeId: number,
  now = Date.now()
): LoginLock | null {
  return db.transaction(() => {
    const state = db.prepare(
      "SELECT failed_login_attempts, locked_until FROM employees WHERE id = ?"
    ).get(employeeId) as LoginState | undefined;
    if (!state) return null;

    const existingLock = toLock(state.locked_until || 0, now);
    if (existingLock) return existingLock;

    const attempts = (state.locked_until > 0 ? 0 : state.failed_login_attempts) + 1;
    if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockedUntil = now + LOGIN_LOCK_DURATION_MS;
      db.prepare(
        "UPDATE employees SET failed_login_attempts = ?, locked_until = ? WHERE id = ?"
      ).run(attempts, lockedUntil, employeeId);
      return toLock(lockedUntil, now);
    }

    db.prepare(
      "UPDATE employees SET failed_login_attempts = ?, locked_until = 0 WHERE id = ?"
    ).run(attempts, employeeId);
    return null;
  })();
}

export function clearFailedLogins(db: Database.Database, employeeId: number): void {
  db.prepare(
    "UPDATE employees SET failed_login_attempts = 0, locked_until = 0 WHERE id = ?"
  ).run(employeeId);
}

export function loginLockMessage(lock: LoginLock): string {
  const minutes = Math.max(1, Math.ceil(lock.retryAfterSeconds / 60));
  return `登录尝试过多，请在 ${minutes} 分钟后稍后再试`;
}
