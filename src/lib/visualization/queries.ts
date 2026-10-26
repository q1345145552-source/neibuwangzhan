/** Fixed projections: no SELECT *, customer documents, payroll, secrets or remote lookups. */
export const QUERIES = {
  orders: 'SELECT id, status, phase, source_system, created_at FROM orders',
  confirmations: "SELECT o.id FROM orders o WHERE o.status = '待处理' AND EXISTS (SELECT 1 FROM sync_inbox si WHERE si.internal_order_id = o.id) AND NOT EXISTS (SELECT 1 FROM sync_inbox si JOIN sync_order_confirmations c ON c.source_order_no = si.source_order_no WHERE si.internal_order_id = o.id) AND NOT EXISTS (SELECT 1 FROM order_steps s WHERE s.order_id = o.id AND (s.status <> '待处理' OR s.started_at IS NOT NULL OR s.completed_at IS NOT NULL))",
  sales: 'SELECT id, currency, created_at FROM commerce_sales',
  lines: 'SELECT id, sale_id FROM commerce_lines',
  fulfillments: 'SELECT line_id, order_id, copy_no, allocated_cents FROM commerce_fulfillments',
  parents: 'SELECT source_order_no, source, currency, created_at FROM sync_orders',
  inbox: 'SELECT id, source_order_no, internal_order_id, line_no, copy_no FROM sync_inbox',
  finances: 'SELECT id, order_id, type, amount, status, currency, verify_by, verify_at, created_at FROM finances',
  receipts: 'SELECT invoice_id, order_id, finance_id FROM commerce_receipt_finances',
  invoices: 'SELECT id, sale_id FROM commerce_invoices',
  credits: 'SELECT order_id, credit_cents FROM commerce_adjustment_items',
  refunds: 'SELECT order_id, amount_cents, finance_id FROM commerce_refund_items',
} as const;
