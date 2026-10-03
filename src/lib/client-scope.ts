import { getDb } from "./db";
import { isCommerceBuyer } from "./commerce-schema";

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

  const explicit = db.prepare("SELECT 1 FROM client_scope_settings WHERE employee_id = ?").get(employeeId);
  if (rows.length > 0 || explicit) {
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
    // Name/company mappings are legacy scopes only, never account links for storefront purchases.
    // Check inbox too: old rows and partially migrated records must remain fail-closed.
    clause: `(${column} IN (${names.map(() => "?").join(",")})
      AND COALESCE(o.source_system, '') = ''
      AND NOT EXISTS (SELECT 1 FROM sync_inbox si WHERE si.internal_order_id = o.id))`,
    params: names,
  };
}

/** Legacy client API access; storefront purchases have no implicit internal-client binding. */
export function isClientOrderVisible(employeeId: number, accountName: string, orderId: string): boolean {
  const { names } = getClientCustomerNames(employeeId, accountName);
  const scope = customerNameFilter(names);
  return !!getDb().prepare(`SELECT 1 FROM orders o WHERE o.id=? AND ${scope.clause}`).get(orderId, ...scope.params);
}

/** Documents use an explicit native-sales identity; generic legacy APIs remain separate. */
export function isClientDocumentOrderVisible(employeeId: number, accountName: string, orderId: string): boolean {
  return isCommerceBuyer(getDb(), employeeId, orderId) || isClientOrderVisible(employeeId, accountName, orderId);
}

/** Local API file names must be canonical, not remote URLs or path aliases. */
export function localFileName(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = /^\/api\/files\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(url);
  return match?.[1] || null;
}

/** Only a trusted uploader or a deliberately published customer document proves access.
 * Old rows with no trusted uploader are not silently backfilled using their mutable text author.
 * Staff keep their existing ability to publish old certificates/reviewed outgoing documents.
 */
export function isClientFileVisible(employeeId: number, accountName: string, filename: string): boolean {
  const db = getDb();
  const upload = db.prepare('SELECT uploaded_by_id, uploaded_by_role FROM file_uploads WHERE filename = ?').get(filename) as
    { uploaded_by_id: number; uploaded_by_role: string } | undefined;
  if (upload?.uploaded_by_id === employeeId && upload.uploaded_by_role === 'client') return true;
  const url = `/api/files/${filename}`;
  const published = db.prepare(`
    SELECT order_id FROM documents WHERE file_url = ? AND direction = 'us_to_client' AND status = '已审核' AND publication_verified = 1
    UNION ALL SELECT order_id FROM certificates WHERE file_url = ?
  `).all(url, url) as { order_id: string }[];
  return published.some(row => isClientDocumentOrderVisible(employeeId, accountName, row.order_id));
}

export function canClientAttachFile(employeeId: number, accountName: string, url: unknown): boolean {
  const filename = localFileName(url);
  return !!filename && isClientFileVisible(employeeId, accountName, filename);
}
