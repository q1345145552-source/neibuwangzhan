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

// GET /api/logistics - 列表
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
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
