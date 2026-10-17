import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reviewDetails } from "@/lib/notice-rule-review";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看验收清单" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的通知编号" }, { status: 400 });
  const db = getDb();
  if (!db.prepare("SELECT id FROM notice_rules WHERE id=?").get(id)) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  return NextResponse.json(reviewDetails(db, id), { headers: { "Cache-Control": "private, no-store" } });
}
