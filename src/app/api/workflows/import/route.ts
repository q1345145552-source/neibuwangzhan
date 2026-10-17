import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";
import { importLegacyWorkflows, WorkflowEditError } from "@/lib/workflow-templates";

// POST /api/workflows/import — 把程序里的流程原样导入系统（仅管理员；导入过的跳过，行为不变）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能导入流程" }, { status: 403 });
  await readJson(req).catch(() => ({}));
  try {
    return NextResponse.json(importLegacyWorkflows(getDb(), auth.name || ""));
  } catch (error) {
    if (error instanceof WorkflowEditError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("[workflows] 导入失败:", error);
    return NextResponse.json({ error: "导入失败，什么都没改，请重试" }, { status: 500 });
  }
}
