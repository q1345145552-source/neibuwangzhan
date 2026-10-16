import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";
import { publishWorkflowVersion, WorkflowConflictError, WorkflowEditError, type WorkflowEdit } from "@/lib/workflow-templates";

// POST /api/workflows/:id/publish — 发布新版本（只改经办人/天数/备注/资料；只影响之后新建的单；仅管理员）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能改流程" }, { status: 403 });
  const { id } = await params;
  const body = await readJson(req);
  try {
    return NextResponse.json(publishWorkflowVersion(getDb(), Number(id), body.steps as WorkflowEdit[], String(body.note || ""), auth.name || "", body.base_version_id ?? null));
  } catch (error) {
    if (error instanceof WorkflowConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof WorkflowEditError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[workflows] 发布失败:", error);
    return NextResponse.json({ error: "发布失败，什么都没改，请重试" }, { status: 500 });
  }
}
