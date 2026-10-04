import type { getDb } from "./db";

type Db = ReturnType<typeof getDb>;

const ANNUAL_DAYS = 6;

/** 年假总额：工龄（按入职日期）超过一年 6 天，否则 0 天 */
export function annualLeaveTotal(hireDate: string | null | undefined, today: string): number {
  if (!hireDate || !/^\d{4}-\d{2}-\d{2}$/.test(hireDate)) return 0;
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCFullYear(t.getUTCFullYear() - 1);
  const oneYearAgo = t.toISOString().split("T")[0];
  return hireDate < oneYearAgo ? ANNUAL_DAYS : 0;
}

/** 当年已通过（已用）年假天数 */
export function annualLeaveUsed(db: Db, employeeName: string, year: string): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(julianday(end_date) - julianday(start_date) + 1), 0) AS total FROM leave_requests WHERE employee_name = ? AND leave_type = '年假' AND status = '已通过' AND start_date LIKE ?"
  ).get(employeeName, `${year}%`) as { total: number };
  return Math.round(row.total || 0);
}

/** 年假余额：总额 / 已用 / 剩余 */
export function annualLeaveBalance(db: Db, employeeName: string, today: string) {
  const year = today.slice(0, 4);
  const emp = db.prepare("SELECT hire_date FROM employees WHERE name = ?").get(employeeName) as { hire_date: string } | undefined;
  const total = annualLeaveTotal(emp?.hire_date, today);
  const used = annualLeaveUsed(db, employeeName, year);
  return { total, used, remaining: Math.max(0, total - used) };
}
