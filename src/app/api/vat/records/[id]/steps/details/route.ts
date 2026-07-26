import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * GET /api/vat/records/:id/steps/details
 *
 * 一次返回该 VAT 申报记录所有步骤的备注和所需文件，按 step_id 分组。
 * 替代原来「遍历步骤逐个请求 notes + documents」的写法（N 个步骤 = 2N 个请求）。
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

  // 这两张表由各自的 notes/documents 路由用 CREATE TABLE IF NOT EXISTS 懒创建，
  // 如果用户还没访问过任何步骤详情，表可能不存在——查不到就当空处理，别 500。
  const safeAll = (sql: string): { step_id: number }[] => {
    try { return db.prepare(sql).all(id) as { step_id: number }[]; } catch { return []; }
  };

  const notes = safeAll("SELECT * FROM vat_step_notes WHERE record_id = ? ORDER BY created_at DESC");
  const documents = safeAll("SELECT * FROM vat_step_documents WHERE record_id = ? ORDER BY id");

  const group = <T extends { step_id: number }>(rows: T[]) => {
    const out: Record<number, T[]> = {};
    for (const r of rows) (out[r.step_id] ||= []).push(r);
    return out;
  };

  const res = NextResponse.json({ notes: group(notes), documents: group(documents) });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
