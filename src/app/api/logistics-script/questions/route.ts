import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 话术问题：员工和管理员都能加；改/删只允许管理员或创建该问题的本人

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const question = String(body?.question || "").trim();
  const categoryId = Number(body?.category_id);
  if (!question) return NextResponse.json({ error: "请填写问题" }, { status: 400 });
  if (!Number.isInteger(categoryId) || categoryId <= 0) return NextResponse.json({ error: "请选择分类" }, { status: 400 });
  const cat = db.prepare("SELECT id FROM logistics_script_categories WHERE id = ?").get(categoryId);
  if (!cat) return NextResponse.json({ error: "分类不存在" }, { status: 400 });
  const sort = Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  const r = db.prepare("INSERT INTO logistics_script_questions (question, category_id, sort_order, created_by) VALUES (?, ?, ?, ?)").run(question, categoryId, sort, auth.name);
  logOperation(auth.name, "新增物流话术问题", "logistics_script_question", String(r.lastInsertRowid), question);
  return NextResponse.json(db.prepare("SELECT * FROM logistics_script_questions WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少问题ID" }, { status: 400 });
  const q = db.prepare("SELECT created_by FROM logistics_script_questions WHERE id = ?").get(id) as { created_by: string } | undefined;
  if (!q) return NextResponse.json({ error: "问题不存在" }, { status: 404 });
  if (auth.role !== "admin" && q.created_by !== auth.name) return NextResponse.json({ error: "只能修改自己创建的问题" }, { status: 403 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (body?.question !== undefined) {
    const q = String(body.question).trim();
    if (!q) return NextResponse.json({ error: "请填写问题" }, { status: 400 });
    sets.push("question = ?"); vals.push(q);
  }
  if (body?.category_id !== undefined) {
    const cid = Number(body.category_id);
    if (!Number.isInteger(cid) || cid <= 0) return NextResponse.json({ error: "请选择分类" }, { status: 400 });
    sets.push("category_id = ?"); vals.push(cid);
  }
  if (body?.sort_order !== undefined) { sets.push("sort_order = ?"); vals.push(Number(body.sort_order) || 0); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_by = ?"); vals.push(auth.name);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE logistics_script_questions SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改物流话术问题", "logistics_script_question", String(id));
  return NextResponse.json(db.prepare("SELECT * FROM logistics_script_questions WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少问题ID" }, { status: 400 });
  const q = db.prepare("SELECT created_by FROM logistics_script_questions WHERE id = ?").get(id) as { created_by: string } | undefined;
  if (!q) return NextResponse.json({ error: "问题不存在" }, { status: 404 });
  if (auth.role !== "admin" && q.created_by !== auth.name) return NextResponse.json({ error: "只能删除自己创建的问题" }, { status: 403 });

  db.transaction(() => {
    db.prepare("DELETE FROM logistics_scripts WHERE question_id = ?").run(id);
    db.prepare("DELETE FROM logistics_script_questions WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除物流话术问题", "logistics_script_question", String(id));
  return NextResponse.json({ success: true });
}
