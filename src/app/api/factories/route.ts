import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM factories ORDER BY created_at DESC").all();
  const res = NextResponse.json(rows);
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { name, category, moq, contact, contact_phone, address, notes } = body;
  if (!name) return NextResponse.json({ error: "请填写工厂名称" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO factories (name, category, moq, contact, contact_phone, address, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(name, category || "", moq || "", contact || "", contact_phone || "", address || "", notes || "");
  const row = db.prepare("SELECT * FROM factories WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE factories SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  return NextResponse.json(db.prepare("SELECT * FROM factories WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  db.prepare("DELETE FROM influencer_factories WHERE factory_id = ?").run(id);
  db.prepare("DELETE FROM factories WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
