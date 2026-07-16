import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * 公开客户反馈问卷 API — 无需登录
 * GET  ?token=xxx  → 返回问卷状态和订单信息
 * POST body { token, score, comment } → 提交反馈
 */

export async function GET(req: NextRequest) {
  const db = getDb();
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });

  const row = db.prepare("SELECT * FROM feedback_tokens WHERE token = ?").get(token) as any;
  if (!row) return NextResponse.json({ error: "无效的链接" }, { status: 404 });

  if (row.submitted) {
    const fb = db.prepare("SELECT score, comment FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(row.order_id) as any;
    return NextResponse.json({
      token: row.token,
      order_id: row.order_id,
      submitted: true,
      submitted_at: row.submitted_at,
      score: fb?.score || "",
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
  const { token, score, comment } = body;

  if (!token) return NextResponse.json({ error: "缺少 token" }, { status: 400 });
  if (!score || !["满意","不满意"].includes(score)) {
    return NextResponse.json({ error: "请选择满意或不满意" }, { status: 400 });
  }

  // 查找 token
  const tokenRow = db.prepare("SELECT * FROM feedback_tokens WHERE token = ?").get(token) as any;
  if (!tokenRow) return NextResponse.json({ error: "无效的链接" }, { status: 404 });
  if (tokenRow.submitted) return NextResponse.json({ error: "该订单已提交过评价" }, { status: 409 });

  const orderId = tokenRow.order_id;

  // 查订单负责人
  const order = db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(orderId) as { responsible_person: string } | undefined;
  const responsiblePerson = order?.responsible_person || "";

  // 原子操作：更新 token 提交状态 + 插入反馈
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  db.prepare("UPDATE feedback_tokens SET submitted = 1, submitted_at = ? WHERE id = ? AND submitted = 0").run(now, tokenRow.id);

  // 插入反馈
  db.prepare(
    "INSERT INTO client_feedback (order_id, responsible_person, score, feedback_type, comment) VALUES (?, ?, ?, 'client', ?)"
  ).run(orderId, responsiblePerson, score, (comment || "").slice(0, 500));

  // 写入积分
  const pts = score === "满意" ? 3 : -3;
  const reason = `客户反馈: 订单 ${orderId} ${score}，${pts > 0 ? "+" : ""}${pts}分`;
  db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status) VALUES (?, ?, ?, 'client_feedback', ?, 'order', '有效')"
  ).run(responsiblePerson, pts, reason, orderId);

  return NextResponse.json({ success: true, order_id: orderId });
}
