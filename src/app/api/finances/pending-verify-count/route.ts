import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/finances/pending-verify-count — 待核对收入笔数（侧栏「费用管理」角标；仅管理员需要）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ count: 0 });

  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM finances WHERE type = 'income' AND status = '待核对'").get() as { count: number };
  return NextResponse.json({ count: row.count });
}
