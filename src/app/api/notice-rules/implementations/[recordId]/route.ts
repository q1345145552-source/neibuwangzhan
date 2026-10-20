import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** 通知中的编号是个人落实记录编号，只反查所属通知，不执行打印、提交或验收。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ recordId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看验收清单" }, { status: 403 });
  const rawId = (await params).recordId;
  const id = Number(rawId);
  if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "落实记录编号无效。" }, { status: 400 });
  const record = getDb().prepare(`SELECT r.id, r.notice_id FROM notice_rule_implementations r
    JOIN notice_rules n ON n.id=r.notice_id WHERE r.id=?`).get(id);
  if (!record) return NextResponse.json({ error: "落实记录不存在或你无权查看。" }, { status: 404 });
  return NextResponse.json(record, { headers: { "Cache-Control": "private, no-store" } });
}
