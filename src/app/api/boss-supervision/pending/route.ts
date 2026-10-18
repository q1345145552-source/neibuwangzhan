import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { bossPendingSubmissions } from "@/lib/boss-submissions";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看待处理清单" }, { status: 403 });
  const db = getDb();
  return NextResponse.json(db.transaction(() => bossPendingSubmissions(db))(), { headers: { "Cache-Control": "private, no-store" } });
}
