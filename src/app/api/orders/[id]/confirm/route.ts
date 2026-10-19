import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";
import { queueProgressEventsForOrder, requestProgressFlush } from "@/lib/progress-sync";
import { isAwaitingConfirmation, recordConfirmation, siblingOrderIds, sourceOrderNoOf } from "@/lib/order-confirm";

// 确认订单（2026-10-19 老板拍板 1A/2B）：客户网站来的单先确认再办理，所有员工都能点。
// 一笔客户订单拆出的几张办理单一起确认；确认后客户站从「待确认」变「已确认」，客户才能传资料和付款水单。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  const sourceOrderNo = sourceOrderNoOf(db, id);
  if (!sourceOrderNo) return NextResponse.json({ error: "只有客户网站下的单需要确认" }, { status: 409 });

  let result: { confirmed: boolean; orderIds: string[]; queued: number };
  try {
    result = db.transaction(() => {
      // 事务里再看一次：两个人同时点，或者别人刚取消了，都按最新状态处理。同一笔订单里有一张还在等确认就算
      const orderIds = siblingOrderIds(db, sourceOrderNo);
      if (!orderIds.some(orderId => isAwaitingConfirmation(db, orderId))) return { confirmed: false, orderIds: [], queued: 0 };
      recordConfirmation(db, sourceOrderNo, auth.name || "");
      let queued = 0;
      for (const orderId of orderIds) queued += queueProgressEventsForOrder(orderId, db);
      return { confirmed: true, orderIds, queued };
    }).immediate();
  } catch (error) {
    console.error("[orders/confirm] 确认订单事务失败:", error);
    return NextResponse.json({ error: "确认失败，请重试" }, { status: 500 });
  }
  if (!result.confirmed) {
    const status = (db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string }).status;
    return NextResponse.json({ error: status === "客户取消" ? "这张单已取消，不用确认" : "这张单已经确认过了，请刷新页面" }, { status: 409 });
  }
  if (result.queued > 0) requestProgressFlush();
  logOperation(auth.name || "", "确认订单", "order", id, `客户站单号 ${sourceOrderNo}${result.orderIds.length > 1 ? `，同一笔订单的 ${result.orderIds.length} 张办理单一起确认` : ""}`);
  return NextResponse.json({ ok: true, source_order_no: sourceOrderNo, order_ids: result.orderIds });
}
