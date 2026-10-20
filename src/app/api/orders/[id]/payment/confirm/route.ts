import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";
import { isAwaitingConfirmation } from "@/lib/order-confirm";
import { confirmCustomerPayment, CustomerPaymentError, paymentSourceOf } from "@/lib/customer-payment";

// POST /api/orders/:id/payment/confirm — 确认收款（2026-10-20 老板 1A）：只有管理员能点（跟业务系统后台原来的规矩一样）。
// 业务系统把账单标「已付款」并通知客户；同一笔客户订单拆出的几张办理单共用一张账单，点哪张都一样。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能确认收款" }, { status: 403 });
  const { id } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  const sourceOrderNo = paymentSourceOf(db, id);
  if (!sourceOrderNo) return NextResponse.json({ error: "不是客户网站来的单，账单不在业务系统" }, { status: 409 });
  if (isAwaitingConfirmation(db, id)) return NextResponse.json({ error: "这张单还没确认订单，请先点「确认订单」" }, { status: 409 });
  try {
    const result = await confirmCustomerPayment(sourceOrderNo, auth.name || "");
    if (!result.already) logOperation(auth.name || "", "确认收款", "order", id, `客户站单号 ${sourceOrderNo}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CustomerPaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[orders/payment/confirm] 确认收款失败:", error);
    return NextResponse.json({ error: "确认收款失败，请稍后再试" }, { status: 502 });
  }
}
