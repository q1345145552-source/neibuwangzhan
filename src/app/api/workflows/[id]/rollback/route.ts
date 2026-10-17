import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";
import { rollbackWorkflow, WorkflowConflictError, WorkflowEditError } from "@/lib/workflow-templates";

// POST /api/workflows/:id/rollback — 退回到某个旧版本（原样再发布一次；仅管理员）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能改流程" }, { status: 403 });
  const { id } = await params;
  const body = await readJson(req);
  try {
    return NextResponse.json(rollbackWorkflow(getDb(), Number(id), Number(body.version_id), auth.name || "", body.base_version_id ?? null));
  } catch (error) {
    if (error instanceof WorkflowConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof WorkflowEditError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[workflows] 退回失败:", error);
    return NextResponse.json({ error: "退回失败，什么都没改，请重试" }, { status: 500 });
  }
}
