import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/contacts — 可聊天的在职员工列表（不含自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT name, role FROM employees WHERE status = '在职' AND role IN ('admin','employee') AND name != ? ORDER BY name ASC"
  ).all(auth.name) as { name: string; role: string }[];

  return NextResponse.json(rows);
}
