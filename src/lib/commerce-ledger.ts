import type Database from "better-sqlite3";
import type { CommerceBilling, CommerceCancellation } from "./commerce-types";
import { fail } from "./commerce-validation";

export function hasAftercare(db: Database.Database): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commerce_aftercare_state'").get();
}
export function billingRevision(db: Database.Database, saleId: string): number {
  return hasAftercare(db) ? (db.prepare("SELECT revision FROM commerce_aftercare_state WHERE sale_id=?").get(saleId) as {revision:number}|undefined)?.revision ?? 0 : 0;
}
export function expectRevision(db: Database.Database, saleId: string, value: unknown, legacy = false) {
  const revision = billingRevision(db,saleId);
  if (legacy && value === undefined && revision === 0) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(400,"INVALID_REVISION","请先刷新账单版本");
  if (value !== revision) fail(409,"REVISION_CHANGED","账单或申请已在另一页面更新，请刷新后重新核对");
}
export function advanceRevision(db: Database.Database, saleId: string) {
  db.prepare(`INSERT INTO commerce_aftercare_state(sale_id,revision) VALUES (?,1)
    ON CONFLICT(sale_id) DO UPDATE SET revision=revision+1`).run(saleId);
}
export function readBilling(db: Database.Database, saleId: string): CommerceBilling {
  const ready = hasAftercare(db);
  const rows = db.prepare(`SELECT f.order_id,f.allocated_cents original_cents FROM commerce_fulfillments f
    JOIN commerce_lines l ON l.id=f.line_id WHERE l.sale_id=? ORDER BY l.line_no,f.copy_no`).all(saleId) as {order_id:string;original_cents:number}[];
  const allocations = rows.map(row => {
    const credited_cents = ready ? (db.prepare("SELECT COALESCE(SUM(credit_cents),0) n FROM commerce_adjustment_items WHERE order_id=?").get(row.order_id) as {n:number}).n : 0;
    const received_cents = (db.prepare(`SELECT COALESCE(SUM(ROUND(f.amount*100)),0) n FROM commerce_receipt_finances r
      JOIN finances f ON f.id=r.finance_id WHERE r.order_id=?`).get(row.order_id) as {n:number}).n;
    const refunded_cents = ready ? (db.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM commerce_refund_items WHERE order_id=?").get(row.order_id) as {n:number}).n : 0;
    const adjusted_cents = row.original_cents - credited_cents;
    return {...row,credited_cents,adjusted_cents,received_cents,refunded_cents,refund_due_cents:Math.max(0,received_cents-refunded_cents-adjusted_cents)};
  });
  const sum = (key:"original_cents"|"credited_cents"|"adjusted_cents"|"received_cents"|"refunded_cents") => allocations.reduce((n,row)=>n+row[key],0);
  const original_cents=sum("original_cents"),credited_cents=sum("credited_cents"),adjusted_cents=sum("adjusted_cents"),received_cents=sum("received_cents"),refunded_cents=sum("refunded_cents");
  const balance_due_cents=Math.max(0,adjusted_cents-(received_cents-refunded_cents));
  const refund_due_cents=allocations.reduce((n,row)=>n+row.refund_due_cents,0);
  const settlement:CommerceBilling["settlement"]=refund_due_cents>0?"refund_due":balance_due_cents>0?"unpaid":received_cents===0?"voided":adjusted_cents===0&&refunded_cents===received_cents?"refunded":"paid";
  const adjustments = ready ? (db.prepare("SELECT id,reason,created_at FROM commerce_adjustments WHERE sale_id=? ORDER BY created_at,id").all(saleId) as {id:string;reason:string;created_at:string}[]).map(row=>({...row,items:db.prepare("SELECT order_id,credit_cents FROM commerce_adjustment_items WHERE adjustment_id=? ORDER BY order_id").all(row.id) as {order_id:string;credit_cents:number}[]})) : [];
  const refunds = ready ? (db.prepare("SELECT id,reason,reference,created_at FROM commerce_refunds WHERE sale_id=? ORDER BY created_at,id").all(saleId) as {id:string;reason:string;reference:string;created_at:string}[]).map(row=>({...row,items:db.prepare("SELECT order_id,amount_cents FROM commerce_refund_items WHERE refund_id=? ORDER BY order_id").all(row.id) as {order_id:string;amount_cents:number}[]})) : [];
  return {revision:billingRevision(db,saleId),original_cents,credited_cents,adjusted_cents,received_cents,refunded_cents,balance_due_cents,refund_due_cents,settlement,allocations,adjustments,refunds};
}
export function readCancellations(db: Database.Database, saleId: string): CommerceCancellation[] {
  if (!hasAftercare(db)) return [];
  return (db.prepare("SELECT id,reason,status,public_note,created_at,decided_at FROM commerce_cancellations WHERE sale_id=? ORDER BY created_at DESC,id DESC").all(saleId) as Omit<CommerceCancellation,"order_ids">[])
    .map(row=>({...row,order_ids:(db.prepare("SELECT order_id FROM commerce_cancellation_items WHERE cancellation_id=? ORDER BY order_id").all(row.id) as {order_id:string}[]).map(item=>item.order_id)}));
}
export function isCommerceRefund(db: Database.Database, financeId: number): boolean {
  return hasAftercare(db) && !!db.prepare("SELECT 1 FROM commerce_refund_items WHERE finance_id=?").get(financeId);
}
