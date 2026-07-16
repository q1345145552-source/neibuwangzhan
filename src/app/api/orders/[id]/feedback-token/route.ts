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
    return NextResponse.json({
      token: existing.token,
      link: `${req.nextUrl.origin}/feedback/${existing.token}`,
    });
  }

  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO feedback_tokens (token, order_id) VALUES (?, ?)").run(token, id);
  return NextResponse.json({ token, link: `${req.nextUrl.origin}/feedback/${token}` }, { status: 201 });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const { id } = await params;
  const db = getDb();

  const existing = db.prepare("SELECT * FROM feedback_tokens WHERE order_id = ?").get(id) as any;
  if (!existing) return NextResponse.json({ link: null, submitted: false });

  const feedback = db.prepare("SELECT score, comment FROM client_feedback WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").get(id) as any;
  return NextResponse.json({
    token: existing.token,
    link: `${req.nextUrl.origin}/feedback/${existing.token}`,
    submitted: Boolean(existing.submitted),
    score: feedback?.score || "",
    comment: feedback?.comment || "",
  });
}
