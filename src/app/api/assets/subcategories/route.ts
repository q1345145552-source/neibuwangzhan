import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/assets/subcategories — 资产子分类列表（全员共用）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare("SELECT * FROM asset_subcategories ORDER BY id ASC").all();
  return NextResponse.json(rows);
}

// POST /api/assets/subcategories — 新增子分类（全员共用）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const body = await readJson(req);
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "请填写子分类名称" }, { status: 400 });

  const db = getDb();
  const exists = db.prepare("SELECT id FROM asset_subcategories WHERE name = ?").get(name);
  if (exists) return NextResponse.json({ error: "该子分类已存在" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO asset_subcategories (name, created_by) VALUES (?, ?)"
  ).run(name, auth.name);

  logOperation(auth.name, "新增资产子分类", "asset_subcategory", String(result.lastInsertRowid), name);
  return NextResponse.json(db.prepare("SELECT * FROM asset_subcategories WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
