import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildWorkflowCatalog } from "@/lib/workflow-catalog";

// GET /api/workflows — 流程设置只读清单（现在程序里的每套流程，仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可看" }, { status: 403 });
  return NextResponse.json({ entries: buildWorkflowCatalog(getDb()) });
}
