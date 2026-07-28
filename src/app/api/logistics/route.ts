import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";

const SHIPPING_STEPS = [
  "创建柜号(物流系统员工端创建)",
  "装柜清单(从国内仓库获取确认柜子货物)",
  "更新柜子状态时间(从国内端获取更新到物流系统的已装柜:预计开船预计到港)",
  "发运确认(对应物流系统已开船 查船名)",
  "跟拆派仓确认到仓(对应物流系统的已到港)",
  "跟拆派仓确认派送时间(对应物流系统的清关)",
  "做派送单(对应物流系统的已到仓)",
  "收到派送单回执(对应物流系统的派送中以及派送完成)",
];

// GET /api/logistics - 列表 or ?action=stats
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const action = new URL(req.url).searchParams.get("action");

  if (action === "stats") {
    // 总数
    const total = (db.prepare("SELECT COUNT(*) as c FROM shipping_orders").get() as { c: number }).c;
    // 进行中
    const inProgress = (db.prepare("SELECT COUNT(*) as c FROM shipping_orders WHERE progress = '进行中'").get() as { c: number }).c;
    // 本周新增（泰国时区 UTC+7）
    const thisWeek = (db.prepare(
      "SELECT COUNT(*) as c FROM shipping_orders WHERE created_at >= datetime('now','localtime','-7 days')"
    ).get() as { c: number }).c;

    // 仓库分布
    const warehouses = ["义乌","深圳","广州","东莞","揭阳"];
    const whCounts: Record<string, number> = {};
    for (const w of warehouses) {
      whCounts[w] = (db.prepare("SELECT COUNT(*) as c FROM shipping_orders WHERE warehouse = ?").get(w) as { c: number }).c;
    }

    // 拆派仓延迟：步骤5 vs 步骤6
    // 步骤5 = 跟拆派仓确认到仓, 步骤6 = 跟拆派仓确认派送时间
    const delayRows = db.prepare(`
      SELECT s5.order_id, s5.completed_at as s5_done, s6.completed_at as s6_done
      FROM shipping_steps s5
      JOIN shipping_steps s6 ON s5.order_id = s6.order_id AND s5.step_order = 5 AND s6.step_order = 6
      WHERE s5.completed_at IS NOT NULL AND s5.completed_at != ''
        AND s6.completed_at IS NOT NULL AND s6.completed_at != ''
    `).all() as { order_id: number; s5_done: string; s6_done: string }[];

    let totalDelay = 0;
    let delayCount = 0;
    const delayDetails: { order_id: number; days: number }[] = [];

    for (const r of delayRows) {
      const d5 = new Date(r.s5_done!.replace(" ","T") + "+07:00").getTime();
      const d6 = new Date(r.s6_done!.replace(" ","T") + "+07:00").getTime();
      const days = Math.max(0, Math.round((d6 - d5) / 86400000));
      totalDelay += days;
      delayCount++;
      delayDetails.push({ order_id: r.order_id, days });
    }

    const avgDelay = delayCount > 0 ? +(totalDelay / delayCount).toFixed(1) : 0;
    // 超平均 50% 标红
    const threshold = avgDelay * 1.5;
    const overdueOrders = delayDetails
      .filter(d => d.days > threshold)
      .map(d => d.order_id);

    return NextResponse.json({
      total, inProgress, thisWeek, whCounts, avgDelay, delayCount, overdueOrders,
    });
  }

  const rows = db.prepare(
    "SELECT * FROM shipping_orders ORDER BY created_at DESC"
  ).all();
  return NextResponse.json(rows);
}

// POST /api/logistics - 新建订单
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const { cabinet_number, warehouse } = body;

  if (!cabinet_number || !warehouse) {
    return NextResponse.json({ error: "柜号和仓库为必填项" }, { status: 400 });
  }
  const validWarehouses = ["义乌", "深圳", "广州", "东莞", "揭阳"];
  if (!validWarehouses.includes(warehouse)) {
    return NextResponse.json({ error: "无效的仓库" }, { status: 400 });
  }

  const creator = auth.name || "";

  const result = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO shipping_orders (cabinet_number, warehouse, progress, creator) VALUES (?, ?, '待处理', ?)"
    ).run(cabinet_number, warehouse, creator);

    const orderId = r.lastInsertRowid as number;

    const stepInsert = db.prepare(
      "INSERT INTO shipping_steps (order_id, step_name, step_order, status) VALUES (?, ?, ?, '待处理')"
    );
    SHIPPING_STEPS.forEach((stepName, i) => {
      stepInsert.run(orderId, stepName, i + 1);
    });

    return orderId;
  })();

  const order = db.prepare("SELECT * FROM shipping_orders WHERE id = ?").get(result);
  return NextResponse.json(order, { status: 201 });
}
