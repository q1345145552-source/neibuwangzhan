import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, seedInfluencerSteps } from "@/lib/db";

// GET /api/discovery-tasks - list all tasks
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const creator = searchParams.get("creator");

  let sql = `SELECT dt.*, (SELECT COUNT(*) FROM influencers WHERE discovery_task_id = dt.id) as inf_count FROM discovery_tasks dt`;
  const conditions: string[] = [];
  const params: string[] = [];
  if (status) { conditions.push("dt.status = ?"); params.push(status); }
  if (creator) { conditions.push("dt.creator = ?"); params.push(creator); }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY dt.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  const res = NextResponse.json(rows);
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}

// POST /api/discovery-tasks - create a new task
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { task_number, category } = body;
  const creator = auth.name || "";
  if (!task_number) return NextResponse.json({ error: "请填写任务编号" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO discovery_tasks (task_number, category, creator) VALUES (?, ?, ?)"
  ).run(task_number, category || "", creator || "");
  const task = db.prepare("SELECT * FROM discovery_tasks WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(task, { status: 201 });
}

// PATCH /api/discovery-tasks - update task (e.g., submit for evaluation)
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { id, status } = body;
  if (!id) return NextResponse.json({ error: "缺少任务ID" }, { status: 400 });

  if (status === "completed") {
    // Mark task as completed
    db.prepare("UPDATE discovery_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(id);

    // Get all influencers in this task
    const infs = db.prepare("SELECT * FROM influencers WHERE discovery_task_id = ?").all(id) as any[];

    // For each influencer: generate discovery steps, mark step 1 as completed (found via task),
    // and change status to 评估中
    for (const inf of infs) {
      // Generate discovery steps
      seedInfluencerSteps(db, inf.id, "discovery");

      // Mark step 1 (found via task) as completed
      const step1 = db.prepare(
        "SELECT id FROM influencer_steps WHERE influencer_id = ? AND phase = 'discovery' ORDER BY step_order LIMIT 1"
      ).get(inf.id) as any;
      if (step1) {
        db.prepare("UPDATE influencer_steps SET status = '已完成', completed_at = datetime('now') WHERE id = ?").run(step1.id);
      }

      // Update influencer status to 评估中
      db.prepare("UPDATE influencers SET status = '评估中', updated_at = datetime('now') WHERE id = ?").run(inf.id);
    }
  } else if (status) {
    db.prepare("UPDATE discovery_tasks SET status = ? WHERE id = ?").run(status, id);
  }

  const task = db.prepare("SELECT * FROM discovery_tasks WHERE id = ?").get(id);
  return NextResponse.json(task);
}

// DELETE /api/discovery-tasks
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const deleteInfluencers = searchParams.get("deleteInfluencers") === "true";
  if (!id) return NextResponse.json({ error: "缺少任务ID" }, { status: 400 });

  if (deleteInfluencers) {
    // Delete influencers and related data first
    const infs = db.prepare("SELECT id FROM influencers WHERE discovery_task_id = ?").all(id) as { id: number }[];
    for (const inf of infs) {
      db.prepare("DELETE FROM influencer_step_notes WHERE influencer_id = ?").run(inf.id);
      db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ?").run(inf.id);
      db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(inf.id);
      db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(inf.id);
      db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(inf.id);
      db.prepare("DELETE FROM influencers WHERE id = ?").run(inf.id);
    }
  }
  
  db.prepare("DELETE FROM discovery_tasks WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
