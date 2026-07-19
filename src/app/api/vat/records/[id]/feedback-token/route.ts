import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import crypto from "crypto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM feedback_tokens WHERE order_id = ?").get(id) as any;
  if (existing) {
    const host = req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || "http";
    return NextResponse.json({
      token: existing.token,
      link: `${proto}://${host}/feedback/${existing.token}`,
    });
  }

  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO feedback_tokens (token, order_id) VALUES (?, ?)").run(token, id);
  const host = req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  return NextResponse.json({ token, link: `${proto}://${host}/feedback/${token}` }, { status: 201 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM feedback_tokens WHERE order_id = ?").get(id) as any;
  if (!existing) return NextResponse.json({ link: null, submitted: false });

  const host = req.headers.get("host") || "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const feedback = db.prepare(
    "SELECT overall, attitude, speed, professionalism, comment FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(id) as any;
  return NextResponse.json({
    token: existing.token,
    link: `${proto}://${host}/feedback/${existing.token}`,
    submitted: Boolean(existing.submitted),
    overall: feedback?.overall || 0,
  });
}
