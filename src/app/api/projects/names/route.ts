import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/projects/names — 轻量项目名称列表（仅 id + name，员工和老板都能访问）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare("SELECT id, name FROM projects ORDER BY created_at DESC, id DESC").all();
  return NextResponse.json(rows);
}
