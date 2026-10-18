import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { bossSupervisionOverdues } from "@/lib/boss-supervision";

// GET /api/boss-supervision/overdue — 仅admin，只读快照；客户端不能覆盖计算时钟。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看老板监督逾期清单" }, { status: 403 });
  const db = getDb();
  const now = Date.now();
  const result = db.transaction(() => bossSupervisionOverdues(db, now))();
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
