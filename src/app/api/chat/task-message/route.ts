import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { sendTaskMessages, TaskMessageError } from "@/lib/chat-task-message";

export async function POST(req: NextRequest) {
  const actor = await verifyAuth(req);
  if (!actor) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(actor)) return NextResponse.json({ error: "仅员工和管理员可用" }, { status: 403 });
  try {
    const body = await readJson(req);
    return NextResponse.json(sendTaskMessages(getDb(), actor, body || {}), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TaskMessageError ? error.message : "发送结果暂时无法确认，请重试本次发送；成功项不会重复发送" }, { status: error instanceof TaskMessageError ? error.status : 500 });
  }
}
