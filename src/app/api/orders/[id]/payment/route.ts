import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CustomerPaymentError, fetchCustomerPayment, paymentSourceOf } from "@/lib/customer-payment";

// GET /api/orders/:id/payment — 客户站账单和客户传的付款水单（2026-10-20 老板 1A）；员工能看，只有管理员能确认收款
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可查看" }, { status: 403 });
  const { id } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  const sourceOrderNo = paymentSourceOf(db, id);
  if (!sourceOrderNo) return NextResponse.json({ available: false, reason: "不是客户网站来的单，账单不在业务系统" });
  try {
    const payment = await fetchCustomerPayment(sourceOrderNo);
    return NextResponse.json({ available: true, can_confirm: auth.role === "admin", ...payment });
  } catch (error) {
    if (error instanceof CustomerPaymentError) return NextResponse.json({ available: false, reason: error.message }, { status: error.status === 404 ? 200 : error.status });
    console.error("[orders/payment] 取客户站账单失败:", error);
    return NextResponse.json({ available: false, reason: "取客户的账单失败，请稍后再试" }, { status: 502 });
  }
}
