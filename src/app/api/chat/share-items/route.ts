import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listLeaveCards } from "@/lib/chat-leave-card";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (new URL(req.url).searchParams.get("type") !== "leave") return NextResponse.json({ error: "不支持的分享类型" }, { status: 400 });
  return NextResponse.json(listLeaveCards(getDb(), auth), { headers: { "Cache-Control": "private, no-store" } });
}
