import type { getDb } from "./db";

/**
 * 按该客户该月所有申报记录的税额合计，重算对账表的应付/未付。
 * 已付金额（tax_paid）保持不变，只重算应付和差额。
 */
export function syncVatReconciliation(db: ReturnType<typeof getDb>, customerId: number, yearMonth: string) {
  const total = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as t FROM vat_records WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth) as { t: number }).t;

  const exists = db.prepare(
    "SELECT id FROM vat_reconciliation WHERE customer_id = ? AND year_month = ?"
  ).get(customerId, yearMonth);

  if (!exists) {
    db.prepare(
      "INSERT INTO vat_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, ?, 0, ?)"
    ).run(customerId, yearMonth, total, total);
  } else {
    db.prepare(`
      UPDATE vat_reconciliation
      SET tax_payable = ?, tax_unpaid = MAX(0, ? - COALESCE(tax_paid, 0)), updated_at = datetime('now')
      WHERE customer_id = ? AND year_month = ?
    `).run(total, total, customerId, yearMonth);
  }
}
