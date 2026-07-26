import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * GET /api/orders/:id/steps/details
 *
 * 一次返回该订单所有步骤的备注和所需文件，按 step_id 分组。
 *
 * 为什么加这个：订单详情页原来是遍历步骤逐个请求
 * （fetchStepNotes + fetchStepDocuments 各一次），10 个步骤就是 20 个 HTTP 请求，
 * 每个请求都要重新鉴权、开库、查询。这里用 2 条 SQL 一次查完。
 *
 * 返回 { notes: { [stepId]: StepNote[] }, documents: { [stepId]: StepDocument[] } }
 * ——和前端原来自己拼的 map 结构一致，页面改动最小。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  // 与 /api/orders/:id 保持一致：客户账号不能看步骤内部的备注和文件清单
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  const notes = db
    .prepare("SELECT * FROM step_notes WHERE order_id = ? ORDER BY created_at DESC")
    .all(id) as { step_id: number }[];
  const documents = db
    .prepare("SELECT * FROM step_documents WHERE order_id = ? ORDER BY id")
    .all(id) as { step_id: number }[];

  const group = <T extends { step_id: number }>(rows: T[]) => {
    const out: Record<number, T[]> = {};
    for (const r of rows) (out[r.step_id] ||= []).push(r);
    return out;
  };

  const res = NextResponse.json({ notes: group(notes), documents: group(documents) });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
