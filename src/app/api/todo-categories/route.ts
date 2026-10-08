import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 待办分类：每个员工自己的一套分类，互不干扰。
// GET 只返回当前登录人自己的分类；增删改也只作用于自己的分类。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const db = getDb();
  const rows = db.prepare("SELECT * FROM todo_categories WHERE created_by = ? ORDER BY id ASC").all(auth.name);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "请填写分类名" }, { status: 400 });

  const r = db.prepare("INSERT INTO todo_categories (name, created_by) VALUES (?, ?)").run(name, auth.name);
  logOperation(auth.name, "新建待办分类", "todo_category", String(r.lastInsertRowid), name);
  return NextResponse.json(db.prepare("SELECT * FROM todo_categories WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  const name = String(body?.name || "").trim();
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "请填写分类名" }, { status: 400 });

  const own = db.prepare("SELECT id FROM todo_categories WHERE id = ? AND created_by = ?").get(id, auth.name);
  if (!own) return NextResponse.json({ error: "只能操作自己的分类" }, { status: 403 });

  db.prepare("UPDATE todo_categories SET name = ? WHERE id = ?").run(name, id);
  logOperation(auth.name, "重命名待办分类", "todo_category", String(id), name);
  return NextResponse.json(db.prepare("SELECT * FROM todo_categories WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const db = getDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少分类ID" }, { status: 400 });

  const own = db.prepare("SELECT id, name FROM todo_categories WHERE id = ? AND created_by = ?").get(id, auth.name);
  if (!own) return NextResponse.json({ error: "只能操作自己的分类" }, { status: 403 });

  // 删除分类时，把属于该分类的待办置回「未分类」
  db.transaction(() => {
    db.prepare("UPDATE todos SET category_id = NULL WHERE category_id = ?").run(id);
    db.prepare("DELETE FROM todo_categories WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除待办分类", "todo_category", String(id), (own as any).name);
  return NextResponse.json({ success: true });
}
