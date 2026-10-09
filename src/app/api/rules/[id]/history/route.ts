import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/rules/[id]/history — 规则更新历史（仅管理员；员工只读看不到历史）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看历史" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const rule = db.prepare("SELECT id FROM rules WHERE id = ?").get(id) as any;
  if (!rule) return NextResponse.json({ error: "规则不存在" }, { status: 404 });

  const history = db.prepare("SELECT * FROM rule_history WHERE rule_id = ? ORDER BY id DESC").all(id) as any[];
  return NextResponse.json({ history });
}
