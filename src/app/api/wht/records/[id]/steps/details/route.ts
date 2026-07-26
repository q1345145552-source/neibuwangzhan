import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * GET /api/wht/records/:id/steps/details
 *
 * 一次返回该 WHT 申报记录所有步骤的备注，按 step_id 分组。
 * 替代原来「遍历步骤逐个请求 notes」的写法。
 * （WHT 没有 step_documents 表，所以只返回 notes，结构与 VAT 版保持一致便于前端复用）
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  // wht_step_notes 由 notes 路由懒创建，可能还不存在
  let rows: { step_id: number }[] = [];
  try {
    rows = db
      .prepare("SELECT * FROM wht_step_notes WHERE record_id = ? ORDER BY created_at DESC")
      .all(id) as { step_id: number }[];
  } catch { rows = []; }

  const notes: Record<number, typeof rows> = {};
  for (const r of rows) (notes[r.step_id] ||= []).push(r);

  const res = NextResponse.json({ notes });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
