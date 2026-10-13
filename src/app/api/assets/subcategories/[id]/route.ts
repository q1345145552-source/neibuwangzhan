import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 判断是否有权改/删：管理员可管所有，普通上传者只能管自己新增的
function canManage(row: any, auth: { role: string; name: string }): boolean {
  if (auth.role === "admin") return true;
  return row.created_by === auth.name;
}

// PATCH /api/assets/subcategories/[id] — 改名字
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM asset_subcategories WHERE id = ?").get(id) as any;
  if (!row) return NextResponse.json({ error: "子分类不存在" }, { status: 404 });
  if (!canManage(row, auth)) return NextResponse.json({ error: "只能改自己新增的子分类" }, { status: 403 });

  const body = await readJson(req);
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "请填写子分类名称" }, { status: 400 });

  const dup = db.prepare("SELECT id FROM asset_subcategories WHERE name = ? AND id != ?").get(name, id);
  if (dup) return NextResponse.json({ error: "该子分类已存在" }, { status: 400 });

  db.prepare("UPDATE asset_subcategories SET name = ? WHERE id = ?").run(name, id);
  logOperation(auth.name, "改名资产子分类", "asset_subcategory", String(id), `${row.name} → ${name}`);
  return NextResponse.json(db.prepare("SELECT * FROM asset_subcategories WHERE id = ?").get(id));
}

// DELETE /api/assets/subcategories/[id] — 删除（不影响已用它的旧资产）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM asset_subcategories WHERE id = ?").get(id) as any;
  if (!row) return NextResponse.json({ error: "子分类不存在" }, { status: 404 });
  if (!canManage(row, auth)) return NextResponse.json({ error: "只能删自己新增的子分类" }, { status: 403 });

  db.prepare("DELETE FROM asset_subcategories WHERE id = ?").run(id);
  logOperation(auth.name, "删除资产子分类", "asset_subcategory", String(id), row.name);
  return NextResponse.json({ success: true });
}
