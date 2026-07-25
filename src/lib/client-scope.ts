import { getDb } from "./db";

/**
 * 客户端口账号能看到哪些公司的订单。
 *
 * 优先用 `client_account_customers` 里的显式映射；没有配置时回退到
 * 「账号姓名 = 订单客户名」的老逻辑，保证存量账号不会突然看不到数据。
 *
 * 回退是过渡方案：同名客户会互相可见、账号改名即失联。
 * 给客户账号配好映射后，回退就不会再触发。
 */
export function getClientCustomerNames(employeeId: number, accountName: string): {
  names: string[];
  /** true 表示走的是姓名匹配的老逻辑 */
  legacy: boolean;
} {
  const db = getDb();
  const rows = db.prepare(
    "SELECT customer_name FROM client_account_customers WHERE employee_id = ?"
  ).all(employeeId) as { customer_name: string }[];

  if (rows.length > 0) {
    return { names: rows.map(r => r.customer_name), legacy: false };
  }

  if (accountName) {
    console.warn(
      `[外部接口] 客户账号 #${employeeId}（${accountName}）未配置可见公司映射，` +
      `暂时按姓名匹配订单。请在「设置 → 员工」里给该账号关联公司名。`
    );
    return { names: [accountName], legacy: true };
  }
  return { names: [], legacy: true };
}

/** 生成 `customer_name IN (?, ?, ...)` 片段和对应参数 */
export function customerNameFilter(names: string[], column = "o.customer_name"): { clause: string; params: string[] } {
  if (names.length === 0) return { clause: "1 = 0", params: [] }; // 没有任何可见范围 → 查不到数据
  return {
    clause: `${column} IN (${names.map(() => "?").join(",")})`,
    params: names,
  };
}
