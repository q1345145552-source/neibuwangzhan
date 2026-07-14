import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  let sql = "SELECT * FROM templates";
  const params: any[] = [];
  if (type) { sql += " WHERE type = ?"; params.push(type); }
  sql += " ORDER BY created_at DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  const db = getDb();
  const body = await req.json();
  const { name, type, category, data_json } = body;
  if (!name || !type) return NextResponse.json({ error: "请填写名称和类型" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO templates (name, type, category, data_json, created_by) VALUES (?, ?, ?, ?, ?)"
  ).run(name, type, category || "", JSON.stringify(data_json || {}), auth.name);
  return NextResponse.json(db.prepare("SELECT * FROM templates WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  const db = getDb();
  const body = await req.json();
  const { id, name, category, data_json } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  if (name) { sets.push("name = ?"); vals.push(name); }
  if (category) { sets.push("category = ?"); vals.push(category); }
  if (data_json) { sets.push("data_json = ?"); vals.push(JSON.stringify(data_json)); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  vals.push(id);
  db.prepare(`UPDATE templates SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return NextResponse.json(db.prepare("SELECT * FROM templates WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  getDb().prepare("DELETE FROM templates WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
