import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { REVIEW_COLUMNS, reviewDetails, submissionToken, type ReviewRecord } from "@/lib/notice-rule-review";
import { syncNoticeTodo } from "@/lib/submission-todos";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可验收" }, { status: 403 });
  const paramsValue = await params;
  const id = Number(paramsValue.id), recordId = Number(paramsValue.recordId);
  if (![id, recordId].every(v => Number.isSafeInteger(v) && v > 0)) return NextResponse.json({ error: "无效的通知或记录编号" }, { status: 400 });
  const body = await readJson(req);
  if (body.decision !== "通过" && body.decision !== "打回") return NextResponse.json({ error: "请选择通过或打回" }, { status: 400 });
  if (body.comment !== undefined && typeof body.comment !== "string") return NextResponse.json({ error: "评论须为文字" }, { status: 400 });
  if (typeof body.submission_token !== "string") return NextResponse.json({ error: "请刷新清单后再验收" }, { status: 400 });
  const db = getDb();
  const result = db.transaction(() => {
    const row = db.prepare(`SELECT ${REVIEW_COLUMNS} FROM notice_rule_implementations WHERE id=? AND notice_id=?`).get(recordId, id) as ReviewRecord | undefined;
    if (!row) return { error: "落实记录不存在", status: 404 };
    if (!row.submitted_at || row.review_status !== "还没处理") return { error: "只能验收已提交且等待验收的记录", status: 409 };
    if (submissionToken(row) !== body.submission_token) return { error: "员工提交内容已更新，请刷新清单后再验收", status: 409 };
    db.prepare(`UPDATE notice_rule_implementations SET review_status=?, boss_comment=?,
      reviewed_at=strftime('%Y-%m-%d %H:%M:%f','now'), updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=? AND notice_id=?`)
      .run(body.decision, (body.comment || "").trim(), recordId, id);
    syncNoticeTodo(db, recordId);
    return { data: reviewDetails(db, id) };
  }).immediate();
  if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
}
