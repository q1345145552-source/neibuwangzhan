import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/assets/[id]/view-log — 查看留痕列表（仅管理员，方便追查谁看过哪个密码）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM asset_view_logs WHERE asset_id = ? ORDER BY id DESC LIMIT 200"
  ).all(id);
  return NextResponse.json(rows);
}

// POST /api/assets/[id]/view-log — 记录一次查看/复制留痕（仅老板或上传人本人）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const asset = db.prepare("SELECT id, uploaded_by FROM assets WHERE id = ?").get(id) as any;
  if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });
  if (auth.role !== "admin" && asset.uploaded_by !== auth.name) {
    return NextResponse.json({ error: "无权查看该资产" }, { status: 403 });
  }

  const body = await readJson(req);
  const action = String(body?.action || "").trim();
  const field_name = String(body?.field_name || "").trim();
  if (!action) return NextResponse.json({ error: "缺少动作" }, { status: 400 });

  db.prepare(
    "INSERT INTO asset_view_logs (asset_id, viewer, action, field_name) VALUES (?, ?, ?, ?)"
  ).run(Number(id), auth.name, action, field_name);

  return NextResponse.json({ success: true }, { status: 201 });
}
