import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { parseMeetingTopics } from "@/lib/meeting-topics";

// 发起会议时读取所有已用主题，不单独维护主题表。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可管理会议主题" }, { status: 403 });
  const meetings = getDb().prepare("SELECT topics FROM meetings ORDER BY id DESC").all() as { topics: string }[];
  const topics = [...new Set(meetings.flatMap((meeting) => parseMeetingTopics(meeting.topics)))];
  return NextResponse.json(topics);
}
