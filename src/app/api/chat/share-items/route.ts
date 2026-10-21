import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listLeaveCards } from "@/lib/chat-leave-card";
import { listAttendanceCards } from "@/lib/chat-attendance-card";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "leave" && type !== "attendance") return NextResponse.json({ error: "不支持的分享类型" }, { status: 400 });
  const db = getDb();
  return NextResponse.json(type === "attendance" ? listAttendanceCards(db, auth) : listLeaveCards(db, auth), { headers: { "Cache-Control": "private, no-store" } });
}
