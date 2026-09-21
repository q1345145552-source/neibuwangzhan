/** Customer API DTOs. Internal entities never spread into a customer response. */
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
