import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listLeaveCards } from "@/lib/chat-leave-card";
import { listAttendanceCards } from "@/lib/chat-attendance-card";
import { listNoticeCards } from "@/lib/chat-notice-card";
import { listReportCards } from "@/lib/chat-report-card";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const type = new URL(req.url).searchParams.get("type");
  if (type !== "leave" && type !== "attendance" && type !== "notice" && type !== "report") return NextResponse.json({ error: "不支持的分享类型" }, { status: 400 });
  const db = getDb();
  const cards = type === "report" ? listReportCards(db, auth) : type === "notice" ? listNoticeCards(db, auth) : type === "attendance" ? listAttendanceCards(db, auth) : listLeaveCards(db, auth);
  return NextResponse.json(cards, { headers: { "Cache-Control": "private, no-store" } });
}
