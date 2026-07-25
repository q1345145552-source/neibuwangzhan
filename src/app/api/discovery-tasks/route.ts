import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
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
  const body = await readJson(req);
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
  const body = await readJson(req);
  const { id, status } = body;
  if (!id) return NextResponse.json({ error: "缺少任务ID" }, { status: 400 });

  // 状态白名单：discovery_tasks.status 有 CHECK 约束，非法值会撞约束变 500
  const errEnum = validateEnums({ "discovery_tasks.status": status });
  if (errEnum) return NextResponse.json({ error: errEnum }, { status: 400 });

  const current = db.prepare("SELECT id, status FROM discovery_tasks WHERE id = ?").get(id) as
    { id: number; status: string } | undefined;
  if (!current) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  if (status === "completed") {
    // 幂等保护：原实现不看当前状态，重复点「完成」会再 seed 一遍步骤
    //（实测 5 步变 10 步，每种步骤两份）。已完成的任务直接原样返回。
    if (current.status === "completed") {
      return NextResponse.json(db.prepare("SELECT * FROM discovery_tasks WHERE id = ?").get(id));
    }

    db.transaction(() => {
      db.prepare("UPDATE discovery_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(id);

      const infs = db.prepare("SELECT * FROM influencers WHERE discovery_task_id = ?").all(id) as any[];

      for (const inf of infs) {
        // 已经有发现步骤的就不再生成（达人可能是"直接新建"进来的，创建时已 seed 过）
        const existingSteps = (db.prepare(
          "SELECT COUNT(*) as c FROM influencer_steps WHERE influencer_id = ? AND phase = 'discovery'"
        ).get(inf.id) as { c: number }).c;
        if (existingSteps === 0) seedInfluencerSteps(db, inf.id, "discovery");

        // 第一步「通过任务找到达人」直接标完成
        const step1 = db.prepare(
          "SELECT id, status FROM influencer_steps WHERE influencer_id = ? AND phase = 'discovery' ORDER BY step_order LIMIT 1"
        ).get(inf.id) as { id: number; status: string } | undefined;
        if (step1 && step1.status !== "已完成") {
          db.prepare("UPDATE influencer_steps SET status = '已完成', completed_at = datetime('now') WHERE id = ?").run(step1.id);
        }

        // 只把「待提交」推进到「待评估」，不覆盖已经走更远的状态
        //（原实现无条件改写，会把已签约/已停止的达人打回待评估）
        if (inf.status === "待提交") {
          db.prepare("UPDATE influencers SET status = '待评估', updated_at = datetime('now') WHERE id = ?").run(inf.id);
        }
      }
    })();
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

  // 主数据删除不可恢复：仅管理员或创建人本人可删
  const _delId = new URL(req.url).searchParams.get("id");
  if (!_delId) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const _owner = getDb().prepare("SELECT creator as o FROM discovery_tasks WHERE id = ?").get(_delId) as { o: string } | undefined;
  if (!_owner) return NextResponse.json({ error: "发现任务不存在" }, { status: 404 });
  if (auth.role !== "admin" && (_owner.o || "") !== auth.name) {
    return NextResponse.json({ error: "只能删除自己创建的发现任务，其他请联系管理员" }, { status: 403 });
  }

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const deleteInfluencers = searchParams.get("deleteInfluencers") === "true";
  if (!id) return NextResponse.json({ error: "缺少任务ID" }, { status: 400 });

  // 整个级联删除放进事务：中途失败会留下指向已删任务/达人的孤儿数据
  db.transaction(() => {
    if (deleteInfluencers) {
      const infs = db.prepare("SELECT id FROM influencers WHERE discovery_task_id = ?").all(id) as { id: number }[];
      for (const inf of infs) {
        db.prepare("DELETE FROM influencer_step_notes WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_documents WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_finances WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_certificates WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(inf.id);
        db.prepare("DELETE FROM influencers WHERE id = ?").run(inf.id);
      }
    } else {
      // 不删达人时要解除关联，否则达人会指向一个已经不存在的任务
      db.prepare("UPDATE influencers SET discovery_task_id = NULL WHERE discovery_task_id = ?").run(id);
    }
    db.prepare("DELETE FROM discovery_tasks WHERE id = ?").run(id);
  })();
  return NextResponse.json({ success: true });
}
