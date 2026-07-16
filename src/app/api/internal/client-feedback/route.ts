import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// POST: 内部记录反馈（需登录）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { order_id, overall, attitude, speed, professionalism, comment } = body;

  if (!order_id) return NextResponse.json({ error: "缺少订单编号" }, { status: 400 });
  const o = Number(overall) || 3;
  const a = Number(attitude) || 3;
  const sp = Number(speed) || 3;
  const pr = Number(professionalism) || 3;

  const order = db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(order_id) as { responsible_person: string } | undefined;
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const existing = db.prepare("SELECT id FROM client_feedback WHERE order_id = ?").get(order_id);
  if (existing) return NextResponse.json({ error: "该订单已提交过反馈" }, { status: 409 });

  db.prepare(
    "INSERT INTO client_feedback (order_id, responsible_person, overall, attitude, speed, professionalism, comment, feedback_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'internal')"
  ).run(order_id, order.responsible_person || "", o, a, sp, pr, (comment || "").slice(0, 500));

  // 所有完成步骤的参与人加分
  const completers = db.prepare(
    "SELECT DISTINCT assignee FROM order_steps WHERE order_id = ? AND status = '已完成' AND assignee != ''"
  ).all(order_id) as { assignee: string }[];
  const participantSet = new Set(completers.map(c => c.assignee));
  if (order.responsible_person) participantSet.add(order.responsible_person);

  let pts = 0;
  if (o >= 4) pts = 3;
  else if (o <= 2) pts = -3;
  const ptsLabel = pts > 0 ? `+${pts}` : pts < 0 ? `${pts}` : "0";
  const reason = `客户反馈: 订单 ${order_id} 综合${'★'.repeat(o)}${'☆'.repeat(5-o)}，${ptsLabel}分`;

  for (const name of participantSet) {
    db.prepare(
      "INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status) VALUES (?, ?, ?, 'client_feedback', ?, 'order', '有效')"
    ).run(name, pts, reason, order_id);
  }

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
