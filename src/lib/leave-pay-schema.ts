import type Database from "better-sqlite3";

/** 只补默认不带薪的列，不根据旧证明/审批状态推断历史带薪资格。 */
export function ensureLeavePaySchema(db: Database.Database) {
  const columns = db.prepare("PRAGMA table_info(leave_requests)").all() as { name: string }[];
  if (!columns.some(column => column.name === "pay_status")) {
    db.exec("ALTER TABLE leave_requests ADD COLUMN pay_status TEXT NOT NULL DEFAULT '不带薪' CHECK(pay_status IN ('带薪','不带薪'))");
  }
}
