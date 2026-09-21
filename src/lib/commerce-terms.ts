import type Database from "better-sqlite3";
import type { CommerceTerms, CommerceOrderPurchase } from "./commerce-types";

export { productTerms, LEGACY_TERMS_VERSION } from "./commerce-catalog";

/** Read only the recorded sale snapshot; never infer old entitlements from today's catalog. */
export function readLineTerms(db: Database.Database, lineId: string): CommerceTerms | null {
  const row = db.prepare("SELECT terms_json FROM commerce_line_terms WHERE line_id=?").get(lineId) as { terms_json: string } | undefined;
  return row ? JSON.parse(row.terms_json) as CommerceTerms : null;
}
export function readOrderPurchase(db: Database.Database, orderId: string): CommerceOrderPurchase | null {
  // Old installations/feature-off databases may predate these additive tables.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commerce_line_terms'").get()) return null;
  const row = db.prepare(`SELECT l.sale_id,l.sku,l.id AS line_id,f.copy_no FROM commerce_fulfillments f
    JOIN commerce_lines l ON l.id=f.line_id JOIN orders o ON o.id=f.order_id
    WHERE f.order_id=? AND o.source_system='commerce'`).get(orderId) as
    { sale_id: string; sku: string; line_id: string; copy_no: number } | undefined;
  return row ? { sale_id: row.sale_id, sku: row.sku, copy_no: row.copy_no, terms: readLineTerms(db,row.line_id) } : null;
}
