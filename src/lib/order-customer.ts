import type Database from "better-sqlite3";
import { logOperation } from "@/lib/db";

/**
 * 员工建的订单，客户名称要从「客户管理」里选（2026-10-16 老板选 2A）。
 * 订单和客户管理是靠名字一字不差对上的（成交金额、客户状态都按名字算），手打差一个字就对不上。
 * - 客户管理里有：照用（前后空格去掉）。
 * - 没有：可以在新建订单时当场新建（new_customer），跟订单在同一个事务里存，订单没建成客户也不会多出来。
 *   员工、管理员都能当场新建（2026-10-27 老板「改成普通员工也能注册」；10-16 那版只给管理员）。
 *   客户管理页的「录入客户」、批量导入照旧只给管理员（7-20 刘雄 3911a8a，没让改）。
 *   当场新建的客户跟在客户管理里点「新建客户」建的一模一样（状态「潜在」，其余留空），之后照客户管理原来的规矩走。
 * 客户站、商城转来的单不走这里（客户名来自客户账号）。
 */
export type OrderCustomerCheck =
  | { ok: true; name: string; create: boolean }
  | { ok: false; status: number; error: string };

const MAX_NAME = 100;

export function checkOrderCustomer(db: Database.Database, rawName: unknown, wantCreate: unknown, role: string | undefined): OrderCustomerCheck {
  const name = String(rawName ?? "").trim();
  if (!name) return { ok: false, status: 400, error: "请选择客户" };
  // 按去掉前后空格比，存库里那条的原名（订单和客户管理才一字不差）
  const stored = db.prepare("SELECT company_name FROM customers WHERE company_name = ? OR trim(company_name) = ? ORDER BY company_name = ? DESC LIMIT 1").get(name, name, name) as { company_name: string } | undefined;
  if (stored) return { ok: true, name: stored.company_name, create: false };
  if (wantCreate !== true) return { ok: false, status: 400, error: `客户管理里没有「${name}」：请从下拉里选客户，客户管理里还没有的在下拉里点「新建客户」` };
  if (role !== "admin" && role !== "employee") return { ok: false, status: 403, error: "只有员工能新建客户" };
  if (name.length > MAX_NAME) return { ok: false, status: 400, error: `客户名称太长（最多 ${MAX_NAME} 字）` };
  // 只差大小写的算同一家，别再建一条重复的
  const similar = db.prepare("SELECT company_name FROM customers WHERE lower(trim(company_name)) = lower(?) LIMIT 1").get(name) as { company_name: string } | undefined;
  if (similar) return { ok: false, status: 409, error: `客户管理里已经有「${similar.company_name}」，请从下拉里选它` };
  return { ok: true, name, create: true };
}

/**
 * 当场新建客户：放在建单/改单的事务里调。跟客户管理里管理员点「新建客户」写的一样（只填公司名，状态默认「潜在」），
 * 记同样的「录入客户」操作日志。别人刚好同时建了同名的，就直接用那条。
 */
export function createOrderCustomer(db: Database.Database, name: string, actor: string, orderId: string): void {
  const result = db.prepare("INSERT OR IGNORE INTO customers (company_name) VALUES (?)").run(name);
  if (result.changes > 0) logOperation(actor, "录入客户", "customer", String(result.lastInsertRowid), `${name}（新建/修改订单 ${orderId} 时录入）`);
}
