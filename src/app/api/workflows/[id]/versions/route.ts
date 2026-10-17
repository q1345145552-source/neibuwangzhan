import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { workflowVersions } from "@/lib/workflow-templates";

// GET /api/workflows/:id/versions — 版本历史（仅管理员）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可看" }, { status: 403 });
  const { id } = await params;
  return NextResponse.json(workflowVersions(getDb(), Number(id)));
}
