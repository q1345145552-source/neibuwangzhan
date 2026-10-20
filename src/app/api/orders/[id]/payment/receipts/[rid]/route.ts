import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { CustomerPaymentError, fetchCustomerReceipt, paymentSourceOf } from "@/lib/customer-payment";

// GET /api/orders/:id/payment/receipts/:rid — 打开客户传的付款水单（从业务系统取，内部不留存）。
// 只认请求头里的登录凭证：页面用带凭证的请求取回来再显示，不把凭证放进网址（会进访问日志、浏览器历史）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可查看" }, { status: 403 });
  const { id, rid } = await params;
  const sourceOrderNo = paymentSourceOf(getDb(), id);
  if (!sourceOrderNo) return NextResponse.json({ error: "不是客户网站来的单" }, { status: 404 });
  try {
    const file = await fetchCustomerReceipt(sourceOrderNo, rid);
    return new NextResponse(file.body, { headers: {
      "content-type": file.type, "cache-control": "private, no-store",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name || "水单")}`,
    } });
  } catch (error) {
    if (error instanceof CustomerPaymentError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[orders/payment/receipt] 取水单失败:", error);
    return NextResponse.json({ error: "取水单失败，请稍后再试" }, { status: 502 });
  }
}
