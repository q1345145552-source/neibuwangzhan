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
  const rows = db.prepare(
    "SELECT inf.*, f.name AS factory_name, f.category AS factory_category FROM influencer_factories inf JOIN factories f ON inf.factory_id = f.id WHERE inf.influencer_id = ? ORDER BY inf.created_at DESC"
  ).all(id);
  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const { factory_id, relationship, notes } = await req.json();
  if (!factory_id) return NextResponse.json({ error: "请选择工厂" }, { status: 400 });

  // Check duplicate
  const existing = db.prepare(
    "SELECT id FROM influencer_factories WHERE influencer_id = ? AND factory_id = ?"
  ).get(id, factory_id);
  if (existing) return NextResponse.json({ error: "已关联该工厂" }, { status: 409 });

  const result = db.prepare(
    "INSERT INTO influencer_factories (influencer_id, factory_id, relationship, notes) VALUES (?, ?, ?, ?)"
  ).run(id, factory_id, relationship || "合作", notes || "");
  const row = db.prepare(
    "SELECT inf.*, f.name AS factory_name, f.category AS factory_category FROM influencer_factories inf JOIN factories f ON inf.factory_id = f.id WHERE inf.id = ?"
  ).get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const linkId = searchParams.get("id");
  if (!linkId) return NextResponse.json({ error: "缺少关联ID" }, { status: 400 });
  db.prepare("DELETE FROM influencer_factories WHERE id = ?").run(linkId);
  return NextResponse.json({ success: true });
}
