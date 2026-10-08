import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 话术分类：管理员可增删改，员工只读

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "请填写分类名" }, { status: 400 });
  const sort = Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  const r = db.prepare("INSERT INTO logistics_script_categories (name, sort_order, created_by) VALUES (?, ?, ?)").run(name, sort, auth.name);
  logOperation(auth.name, "新增物流话术分类", "logistics_script_category", String(r.lastInsertRowid), name);
  return NextResponse.json(db.prepare("SELECT * FROM logistics_script_categories WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });
  const name = body?.name !== undefined ? String(body.name).trim() : "";
  if (body?.name !== undefined && !name) return NextResponse.json({ error: "请填写分类名" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (body?.name !== undefined) { sets.push("name = ?"); vals.push(name); }
  if (body?.sort_order !== undefined) { sets.push("sort_order = ?"); vals.push(Number(body.sort_order) || 0); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_by = ?"); vals.push(auth.name);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE logistics_script_categories SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改物流话术分类", "logistics_script_category", String(id), name);
  return NextResponse.json(db.prepare("SELECT * FROM logistics_script_categories WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });

  // 级联删除：该分类下的问题及其话术一起删
  db.transaction(() => {
    const qids = db.prepare("SELECT id FROM logistics_script_questions WHERE category_id = ?").all(id) as { id: number }[];
    for (const q of qids) {
      db.prepare("DELETE FROM logistics_scripts WHERE question_id = ?").run(q.id);
    }
    db.prepare("DELETE FROM logistics_script_questions WHERE category_id = ?").run(id);
    db.prepare("DELETE FROM logistics_script_categories WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除物流话术分类", "logistics_script_category", String(id));
  return NextResponse.json({ success: true });
}
