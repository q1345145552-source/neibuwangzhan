import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";

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
  const body = await readJson(req);
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

  const refId: string = tokenRow.order_id;
  // ref_type 兼容旧数据：老 token 没有该列值时按订单处理；VAT 的 ref 形如 "VAT-12"
  const refType: string = tokenRow.ref_type || (refId.startsWith("VAT-") ? "vat" : "order");

  // ── 按评价对象类型解析「参与人」──
  let responsiblePerson = "";
  const participantSet = new Set<string>();
  let subjectLabel = "";

  if (refType === "vat") {
    const recordId = refId.replace(/^VAT-/, "");
    const record = db.prepare(
      "SELECT r.assignee, r.year_month, c.company_name FROM vat_records r LEFT JOIN vat_customers c ON r.customer_id = c.id WHERE r.id = ?"
    ).get(recordId) as { assignee: string; year_month: string; company_name: string } | undefined;
    if (!record) return NextResponse.json({ error: "关联的申报记录不存在" }, { status: 404 });

    responsiblePerson = record.assignee || "";
    subjectLabel = `${record.company_name || "VAT"} ${record.year_month} VAT申报`;
    const completers = db.prepare(
      "SELECT DISTINCT assignee FROM vat_record_steps WHERE record_id = ? AND status = '已完成' AND assignee != ''"
    ).all(recordId) as { assignee: string }[];
    for (const c of completers) participantSet.add(c.assignee);
  } else {
    const order = db.prepare("SELECT responsible_person FROM orders WHERE id = ?").get(refId) as { responsible_person: string } | undefined;
    if (!order) return NextResponse.json({ error: "关联的订单不存在" }, { status: 404 });

    responsiblePerson = order.responsible_person || "";
    subjectLabel = `订单 ${refId}`;
    const completers = db.prepare(
      "SELECT DISTINCT assignee FROM order_steps WHERE order_id = ? AND status = '已完成' AND assignee != ''"
    ).all(refId) as { assignee: string }[];
    for (const c of completers) participantSet.add(c.assignee);
  }

  // 确保负责人也在名单里（如果步骤表里没有）
  if (responsiblePerson) participantSet.add(responsiblePerson);
  const participants = [...participantSet];

  // 计算积分
  let pts = 0;
  if (o >= 4) pts = 3;
  else if (o <= 2) pts = -3;
  const ptsLabel = pts > 0 ? `+${pts}` : pts < 0 ? `${pts}` : "0";
  const reason = `客户反馈: ${subjectLabel} 综合${'★'.repeat(o)}${'☆'.repeat(5 - o)}，${ptsLabel}分`;

  // 整段放进事务，并以 UPDATE 的 changes 作为唯一性判据：
  // 该接口无需登录，只靠前面的 if (tokenRow.submitted) 挡不住并发重复提交（会重复发积分）
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  let duplicated = false;
  db.transaction(() => {
    const upd = db.prepare(
      "UPDATE feedback_tokens SET submitted = 1, submitted_at = ? WHERE id = ? AND submitted = 0"
    ).run(now, tokenRow.id);
    if (upd.changes === 0) { duplicated = true; return; }

    db.prepare(
      "INSERT INTO client_feedback (order_id, responsible_person, overall, attitude, speed, professionalism, comment, feedback_type, ref_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'client', ?)"
    ).run(refId, responsiblePerson, o, a, sp, pr, (comment || "").slice(0, 500), refType);

    const insPoints = db.prepare(
      "INSERT INTO points_records (employee_name, points, reason, rule_key, ref_id, ref_type, status) VALUES (?, ?, ?, 'client_feedback', ?, ?, '有效')"
    );
    for (const name of participants) insPoints.run(name, pts, reason, refId, refType);
  })();

  if (duplicated) return NextResponse.json({ error: "该评价已提交过" }, { status: 409 });

  return NextResponse.json({ success: true, order_id: refId, ref_type: refType, participants, points: pts });
}
