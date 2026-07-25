import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation, INFLUENCER_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const influencer = db.prepare(
    "SELECT i.*, dt.task_number as task_number, dt.creator as task_creator FROM influencers i LEFT JOIN discovery_tasks dt ON i.discovery_task_id = dt.id WHERE i.id = ?"
  ).get(id);
  if (!influencer) return NextResponse.json({ error: "达人不存在" }, { status: 404 });
  // 各阶段的 step_order 都从 1 开始，只按 step_order 排会把不同阶段的步骤交错在一起
  const steps = db.prepare(`
    SELECT * FROM influencer_steps WHERE influencer_id = ?
    ORDER BY CASE phase WHEN 'discovery' THEN 1 WHEN 'contract' THEN 2 WHEN 'incubation' THEN 3 ELSE 4 END,
             step_order
  `).all(id);
  const evaluations = db.prepare("SELECT * FROM influencer_evaluations WHERE influencer_id = ? ORDER BY created_at DESC").all(id);
  const contracts = db.prepare("SELECT c.*, i.name AS influencer_name FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.influencer_id = ?").all(id);
  return NextResponse.json({ ...influencer, steps, evaluations, contracts });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { ...fields } = body;

  const errEnum = validateEnums({
    "influencers.status": fields.status,
    "influencers.reply_status": fields.reply_status,
    "influencers.phase": fields.phase,
  });
  if (errEnum) return NextResponse.json({ error: errEnum }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "id" || !INFLUENCER_UPDATABLE_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE influencers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const influencer = db.prepare(
    "SELECT i.*, dt.task_number as task_number, dt.creator as task_creator FROM influencers i LEFT JOIN discovery_tasks dt ON i.discovery_task_id = dt.id WHERE i.id = ?"
  ).get(id);
  return NextResponse.json(influencer);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 主数据删除不可恢复：仅管理员或创建人本人可删
  const _delId = (await params).id;
  const _owner = getDb().prepare("SELECT created_by as o FROM influencers WHERE id = ?").get(_delId) as { o: string } | undefined;
  if (!_owner) return NextResponse.json({ error: "达人不存在" }, { status: 404 });
  if (auth.role !== "admin" && (_owner.o || "") !== auth.name) {
    return NextResponse.json({ error: "只能删除自己创建的达人，其他请联系管理员" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  // 级联删除必须在事务里：中途失败会留下一堆指向已删达人的孤儿数据（步骤、评估、合同…）
  db.transaction(() => {
    db.prepare("DELETE FROM influencer_step_notes WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_documents WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_finances WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_certificates WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencers WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除达人", "influencer", String(id));
  return NextResponse.json({ success: true });
}
