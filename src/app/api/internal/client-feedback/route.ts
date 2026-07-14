import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// POST: 提交客户反馈（无需登录，客户协同API入口）
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { order_id, score } = body;

  if (!order_id || !score || !["满意","不满意"].includes(score)) {
    return NextResponse.json({ error: "缺少参数或参数无效" }, { status: 400 });
  }

  // 查订单负责人
  const order = db.prepare("SELECT responsible_person, status FROM orders WHERE id = ?").get(order_id) as { responsible_person: string; status: string } | undefined;
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  // 防刷分：该接口无需登录，每个订单只接受一次反馈，否则可无限刷 ±3 积分
  const existing = db.prepare("SELECT id FROM client_feedback WHERE order_id = ?").get(order_id);
  if (existing) return NextResponse.json({ error: "该订单已提交过反馈" }, { status: 409 });

  // 插入反馈记录
  db.prepare("INSERT INTO client_feedback (order_id, responsible_person, score) VALUES (?, ?, ?)").run(order_id, order.responsible_person || "", score);

  // 写入积分
  const pts = score === "满意" ? 3 : -3;
  const reason = `客户反馈: 订单 ${order_id} ${score}，${pts > 0 ? "+" : ""}${pts}分`;
  db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status) VALUES (?, ?, ?, 'client_feedback', ?, 'order', '有效')").run(order.responsible_person || "", pts, reason, order_id);

  return NextResponse.json({ success: true });
}

// GET: 查反馈列表（内部数据，需登录）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const order_id = req.nextUrl.searchParams.get("order_id") || "";
  let records: any[];
  if (order_id) {
    records = db.prepare("SELECT * FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC").all(order_id);
  } else {
    records = db.prepare("SELECT * FROM client_feedback ORDER BY created_at DESC LIMIT 100").all();
  }
  return NextResponse.json({ records });
}
