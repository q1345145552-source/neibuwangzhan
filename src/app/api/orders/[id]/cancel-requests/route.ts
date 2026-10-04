import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { requestProgressFlush } from "@/lib/progress-sync";
import { CancelRequestError, decideCancelRequest, listCancelRequests } from "@/lib/cancel-sync";

// 客户站内申请取消（2026-10-03，规则 19/20）：员工都能看，只有管理员能同意/不同意（规则 4）。

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(listCancelRequests(getDb(), id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "取消申请仅管理员可处理" }, { status: 403 });
  const { id } = await params;
  const { request_id, decision, note } = await readJson(req);
  if (typeof request_id !== "string" || (decision !== "approve" && decision !== "reject")) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  if (note !== undefined && (typeof note !== "string" || note.length > 500)) return NextResponse.json({ error: "说明最多 500 字" }, { status: 400 });
  try { decideCancelRequest(getDb(), id, request_id, decision, String(note || "").trim(), auth.name); }
  catch (error) {
    if (error instanceof CancelRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[cancel-requests] 处理取消申请失败:", error);
    return NextResponse.json({ error: "处理失败，订单与申请均未改动，请重试" }, { status: 500 });
  }
  requestProgressFlush(); // 进度事件（同意时）与结果事件都在同一个刷新里发出
  logOperation(auth.name, decision === "approve" ? "同意客户取消申请" : "不同意客户取消申请", "order", id, `${request_id}${note ? ` ${String(note).slice(0, 100)}` : ""}`);
  return NextResponse.json({ ok: true, requests: listCancelRequests(getDb(), id) });
}
