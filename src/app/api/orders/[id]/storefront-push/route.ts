import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { sourceOrderNoOf } from "@/lib/order-confirm";
import { requestProgressFlush } from "@/lib/progress-sync";
import { customerOrderLink, defaultServiceTitle, ownerAccount, pushBlocker, pushOrderToStorefront, StorefrontPushError } from "@/lib/storefront-push";

// GET /api/orders/:id/storefront-push — 这张单在业务系统里没有、客户链接（2026-10-22 老板选 B）
// 员工都能看、复制客户链接、推单（2026-10-28 起推单不再只给管理员；新单在建单时就直接挂到客户账号下）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可查看" }, { status: 403 });
  const { id } = await params;
  const db = getDb();
  const source = sourceOrderNoOf(db, id);
  if (source) {
    const row = db.prepare("SELECT payload FROM sync_orders WHERE source_order_no = ?").get(source) as { payload: string } | undefined;
    // 客户登录用的账号：手机号建的号邮箱是系统占位的 phone_手机号@user.xiangtai，从里面取回手机号
    let customer: { name: string; login: string } | null = null;
    try {
      const c = JSON.parse(row?.payload || "{}").customer;
      if (c) { const email = String(c.email || ""); customer = { name: String(c.name || ""), login: email.match(/^phone_(.+)@user\.xiangtai$/)?.[1] || email }; }
    } catch { /* 坏数据不显示账号 */ }
    return NextResponse.json({ linked: true, source_order_no: source, link: customerOrderLink(source), customer });
  }
  const { order, reason } = pushBlocker(db, id);
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  const names = reason && !order.business_type_name ? null : defaultServiceTitle(order);
  // 客户名称就是某个账号的客户群名：推单框直接选上这个账号，不让换
  const owner = ownerAccount(db, order.customer_name);
  return NextResponse.json({
    linked: false, can_push: !reason, reason,
    account: owner ? { id: owner.account_id, name: "", phone: "", email: owner.login, group_name: owner.group_name } : null,
    prefill: { title: names?.title || "", amount: order.currency === "CNY" && order.total_amount > 0 ? order.total_amount : null },
    original: { amount: order.total_amount, currency: order.currency },
  });
}

// POST /api/orders/:id/storefront-push — 推到业务系统：{ customer_id, amount（人民币）, title（客户看到的服务名）}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  try {
    const result = await pushOrderToStorefront(getDb(), id, await readJson(req), auth.name);
    requestProgressFlush();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StorefrontPushError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[orders/storefront-push] 推单失败:", error);
    return NextResponse.json({ error: "推单失败，请稍后再试" }, { status: 500 });
  }
}
