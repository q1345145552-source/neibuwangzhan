import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const steps = db.prepare(
    "SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order"
  ).all(id);
  return NextResponse.json(steps);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { step_id, status, assignee } = body;
  if (!step_id) return NextResponse.json({ error: "缺少步骤 ID" }, { status: 400 });

  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (status) { sets.push("status = ?"); vals.push(status); }
  if (assignee) { sets.push("assignee = ?"); vals.push(assignee); }
  if (status === "已完成" && !sets.includes("completed_at")) {
    sets.push("completed_at = datetime('now')");
  }
  if (!sets.length) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  vals.push(step_id);
  db.prepare(`UPDATE wht_record_steps SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  const steps = db.prepare("SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order").all(id);
  return NextResponse.json(steps);
}
