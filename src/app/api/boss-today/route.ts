import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { bossToday } from "@/lib/boss-today";
import { bangkokToday } from "@/lib/time";

// 老板今日：只读聚合，仅管理员可看。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });
  const db = getDb();
  return NextResponse.json(db.transaction(() => bossToday(db, auth.name, bangkokToday()))(), { headers: { "Cache-Control": "private, no-store" } });
}
