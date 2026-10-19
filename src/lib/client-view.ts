/** Customer API DTOs. Internal entities never spread into a customer response. */
import { customerStepView } from "./step-public-copy";

type Row = Record<string, unknown>;
function pick(row: unknown, fields: readonly string[]): Row {
  const source = row as Row;
  return Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(source, field)).map(field => [field, source[field]]));
}
export function publicOrder(row: unknown): Row {
  return pick(row, ['id', 'customer_name', 'business_type_id', 'business_type_name', 'sub_service_type',
    'address_type', 'status', 'total_amount', 'currency', 'trademark_name', 'created_at', 'updated_at']);
}
export function publicStep(row: unknown): Row {
  return pick(row, ['id', 'order_id', 'step_name', 'step_order', 'status', 'started_at', 'completed_at']);
}
/** 给客户看的整单步骤（按 step_order 排好）：步骤名换成对外说法，内部原名带员工名、合作方和内部费用（2026-10-03）。
 *  有统一子标题的步骤用子标题、多带说明（2026-10-20，跟客户站看到的一样）。 */
export function publicSteps(rows: readonly unknown[], order: unknown): Row[] {
  const view = customerStepView(order as Row, rows.map(row => ({ step_name: String((row as Row).step_name ?? ""), public_name: ((row as Row).public_name as string | null | undefined) ?? null })));
  return rows.map((row, i) => ({ ...publicStep(row), step_name: view[i].name, ...(view[i].description ? { description: view[i].description } : {}) }));
}
export function publicDocument(row: unknown): Row {
  return pick(row, ['id', 'order_id', 'name', 'file_type', 'status', 'direction', 'file_url', 'created_at']);
}
export function publicCertificate(row: unknown): Row {
  return pick(row, ['id', 'order_id', 'certificate_number', 'product_name', 'issue_date', 'expiry_date', 'status', 'file_url', 'created_at']);
}
export function publicStepDocument(row: unknown): Row {
  return pick(row, ['id', 'order_id', 'step_id', 'name', 'document_name', 'status']);
}
export function publicClientNote(row: unknown): Row {
  return pick(row, ['id', 'order_id', 'step_id', 'content', 'created_by', 'created_at']);
}
export function isPublicDocument(row: unknown, employeeId: number): boolean {
  const doc = row as Row;
  return doc.client_author_id === employeeId || (doc.direction === 'us_to_client' && doc.status === '已审核' && doc.publication_verified === 1);
}
