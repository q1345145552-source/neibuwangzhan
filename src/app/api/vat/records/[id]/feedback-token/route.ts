import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import crypto from "crypto";

// VAT 申报记录的评价链接。
// 注意：feedback_tokens.order_id 是全表 UNIQUE 的公共字段，业务订单存 "ORD-xxx"，
// VAT 记录必须加 "VAT-" 前缀（否则 VAT 记录 id=5 会和订单号撞 UNIQUE，
// 且公开问卷提交时会误当成订单去 orders 表查 → 评价没有归属人、积分发不出去）。
function vatRef(recordId: string): string {
  return `VAT-${recordId}`;
}

function buildLink(req: NextRequest, token: string): string {
  const host = req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return `${proto}://${host}/feedback/${token}`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  const db = getDb();

  const record = db.prepare("SELECT id FROM vat_records WHERE id = ?").get(id);
  if (!record) return NextResponse.json({ error: "申报记录不存在" }, { status: 404 });

  const ref = vatRef(id);
  const existing = db.prepare("SELECT * FROM feedback_tokens WHERE order_id = ?").get(ref) as any;
  if (existing) {
    return NextResponse.json({ token: existing.token, link: buildLink(req, existing.token) });
  }

  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO feedback_tokens (token, order_id, ref_type) VALUES (?, ?, 'vat')").run(token, ref);
  return NextResponse.json({ token, link: buildLink(req, token) }, { status: 201 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const ref = vatRef(id);
  const existing = db.prepare("SELECT * FROM feedback_tokens WHERE order_id = ?").get(ref) as any;
  if (!existing) return NextResponse.json({ link: null, submitted: false });

  const feedback = db.prepare(
    "SELECT overall, attitude, speed, professionalism, comment FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(ref) as any;

  return NextResponse.json({
    token: existing.token,
    link: buildLink(req, existing.token),
    submitted: Boolean(existing.submitted),
    overall: feedback?.overall || 0,
  });
}
