import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * 公开客户反馈问卷 API — 无需登录
 * GET  ?token=xxx  → 返回问卷状态
 * POST body { token, overall, attitude, speed, professionalism, comment } → 提交反馈
 */

export async function GET(req: NextRequest) {
  const db = getDb();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });

  const row = db.prepare("SELECT * FROM feedback_tokens WHERE token = ?").get(token) as any;
  if (!row) return NextResponse.json({ error: "无效的链接" }, { status: 404 });

  if (row.submitted) {
    const fb = db.prepare(
      "SELECT overall, attitude, speed, professionalism, comment FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(row.order_id) as any;
    return NextResponse.json({
      token: row.token,
      order_id: row.order_id,
      submitted: true,
      submitted_at: row.submitted_at,
      overall: fb?.overall || 0,
      attitude: fb?.attitude || 0,
      speed: fb?.speed || 0,
      professionalism: fb?.professionalism || 0,
      comment: fb?.comment || "",
    });
  }

  return NextResponse.json({
    token: row.token,
    order_id: row.order_id,
    submitted: false,
  });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { token, overall, attitude, speed, professionalism, comment } = body;

  if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });
  const o = Number(overall);
  const a = Number(attitude);
  const sp = Number(speed);
  const pr = Number(professionalism);
  if (!o || o < 1 || o > 5 || !a || a < 1 || a > 5 || !sp || sp < 1 || sp > 5 || !pr || pr < 1 || pr > 5) {
    return NextResponse.json({ error: "请完成所有评分" }, { status: 400 });
  }

  // 查找 token
  const tokenRow = db.prepare("SELECT * FROM feedback_tokens WHERE token = ?").get(token) as any;
  if (!tokenRow) return NextResponse.json({ error: "无效的链接" }, { status: 404 });
  if (tokenRow.submitted) return NextResponse.json({ error: "该订单已提交过评价" }, { status: 409 });

  const orderId = tokenRow.order_id;

  // 查订单
  const order = db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(orderId) as { responsible_person: string } | undefined;
  const responsiblePerson = order?.responsible_person || "";

  // 查询所有完成过步骤的员工（去重）
  const completers = db.prepare(
    "SELECT DISTINCT assignee FROM order_steps WHERE order_id = ? AND status = '已完成' AND assignee != ''"
  ).all(orderId) as { assignee: string }[];

  // 确保负责人也在名单里（如果步骤表里没有）
  const participantSet = new Set(completers.map(c => c.assignee));
  if (responsiblePerson) participantSet.add(responsiblePerson);
  const participants = [...participantSet];

  // 原子更新 token
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  db.prepare("UPDATE feedback_tokens SET submitted = 1, submitted_at = ? WHERE id = ? AND submitted = 0").run(now, tokenRow.id);

  // 插入反馈记录
  db.prepare(
    "INSERT INTO client_feedback (order_id, responsible_person, overall, attitude, speed, professionalism, comment, feedback_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'client')"
  ).run(orderId, responsiblePerson, o, a, sp, pr, (comment || "").slice(0, 500));

  // 计算积分并写入每个参与人
  let pts = 0;
  if (o >= 4) pts = 3;
  else if (o <= 2) pts = -3;

  const ptsLabel = pts > 0 ? `+${pts}` : pts < 0 ? `${pts}` : "0";
  const reason = `客户反馈: 订单 ${orderId} 综合${'★'.repeat(o)}${'☆'.repeat(5-o)}，${ptsLabel}分`;

  for (const name of participants) {
    db.prepare(
      "INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status) VALUES (?, ?, ?, 'client_feedback', ?, 'order', '有效')"
    ).run(name, pts, reason, orderId);
  }

  return NextResponse.json({ success: true, order_id: orderId, participants, points: pts });
}
