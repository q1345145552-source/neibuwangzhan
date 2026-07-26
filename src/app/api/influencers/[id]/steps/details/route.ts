import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * GET /api/influencers/:id/steps/details
 *
 * 一次返回该达人所有步骤的备注，按 step_id 分组。
 *
 * 这个页面原来的写法是最慢的一个：for 循环里 await，串行发请求。
 * 达人走完三个阶段有 19 个步骤，就是 19 次串行往返，
 * 每次几十毫秒叠起来能到一两秒，页面明显卡在那里。
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

  const rows = db
    .prepare("SELECT * FROM influencer_step_notes WHERE influencer_id = ? ORDER BY created_at DESC")
    .all(id) as { step_id: number }[];

  const notes: Record<number, typeof rows> = {};
  for (const r of rows) (notes[r.step_id] ||= []).push(r);

  const res = NextResponse.json({ notes });
  res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return res;
}
