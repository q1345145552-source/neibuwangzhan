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
  const steps = db.prepare("SELECT * FROM wht_record_steps WHERE record_id = ? ORDER BY step_order").all(id);
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
  const step = db.prepare("SELECT * FROM wht_record_steps WHERE id = ? AND record_id = ?").get(step_id, id) as any;
  if (!step) return NextResponse.json({ error: "步骤不存在" }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];

  if (status !== undefined) {
    if (!["待处理", "进行中", "已完成", "已跳过"].includes(status)) {
      return NextResponse.json({ error: "无效的状态值" }, { status: 400 });
    }
    // 已跳过 → 不允许通过 API 改为其他状态（只能手动改回待处理）
    updates.push("status = ?"); values.push(status);

    if (status === "已完成") {
      updates.push("completed_at = datetime('now')");
    } else if (status === "进行中") {
      updates.push("started_at = COALESCE(started_at, datetime('now'))");
      updates.push("completed_at = NULL");
    } else {
      updates.push("completed_at = NULL");
    }
  }

  if (assignee !== undefined) { updates.push("assignee = ?"); values.push(assignee); }

  if (!updates.length) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  values.push(step_id, id);
  db.prepare(`UPDATE wht_record_steps SET ${updates.join(", ")} WHERE id = ? AND record_id = ?`).run(...values);

  // Sync record progress
  const steps = db.prepare("SELECT status, step_name FROM wht_record_steps WHERE record_id = ? ORDER BY step_order").all(id) as { status: string; step_name: string }[];
  const allDone = steps.every(s => s.status === "已完成" || s.status === "已跳过");
  if (steps.length > 0 && allDone) {
    db.prepare("UPDATE wht_records SET progress = '归档', updated_at = datetime('now') WHERE id = ?").run(id);
  } else if (steps.length > 0) {
    const activeStep = steps.find(s => s.status !== "已完成" && s.status !== "已跳过");
    db.prepare("UPDATE wht_records SET progress = ?, updated_at = datetime('now') WHERE id = ?").run(
      activeStep ? (activeStep as any).step_name : "进行中", id
    );
  }

  const updated = db.prepare("SELECT * FROM wht_record_steps WHERE id = ?").get(step_id);
  return NextResponse.json(updated);
}
