import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { translateText } from "@/lib/deepseek";
import { followUpTranslationKey, withValidFollowUpTranslation } from "@/lib/todo-translation";

type FollowUpSource = { id: number; todo_id: number; content: string; content_zh: string; content_zh_key: string; assignee: string; todo_content: string };
const pending = new Map<string, Promise<string>>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; followUpId: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id, followUpId } = await params;
  if (![id, followUpId].every(value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))) {
    return NextResponse.json({ error: "无效的待办或跟进ID" }, { status: 400 });
  }

  const db = getDb();
  const readFollowUp = () => db.prepare(`SELECT f.id, f.todo_id, f.content, f.content_zh, f.content_zh_key,
    t.assignee, t.content AS todo_content FROM todo_follow_ups f JOIN todos t ON t.id = f.todo_id WHERE f.id = ? AND f.todo_id = ?`)
    .get(Number(followUpId), Number(id)) as FollowUpSource | undefined;
  const followUp = readFollowUp();
  if (!followUp) return NextResponse.json({ error: "待办跟进不存在" }, { status: 404 });
  if (auth.role !== "admin" && auth.name !== followUp.assignee) return NextResponse.json({ error: "只能翻译自己的待办跟进" }, { status: 403 });
  const response = (row: FollowUpSource, cached: boolean) => NextResponse.json({ id: row.id, todo_id: row.todo_id, content: row.content, content_zh: row.content_zh, content_zh_key: row.content_zh_key, cached });
  if (withValidFollowUpTranslation(followUp).content_zh?.trim()) return response(followUp, true);
  if (!followUp.content?.trim()) return NextResponse.json({ error: "跟进内容为空" }, { status: 400 });

  const sourceKey = followUpTranslationKey(followUp.content);
  const requestKey = JSON.stringify([Number(id), Number(followUpId), sourceKey, followUp.todo_content]);
  try {
    let work = pending.get(requestKey);
    if (!work) {
      work = translateText(followUp.content, "中文", `待办工作内容：${followUp.todo_content}`);
      pending.set(requestKey, work);
      const currentWork = work;
      void work.finally(() => { if (pending.get(requestKey) === currentWork) pending.delete(requestKey); }).catch(() => {});
    }
    const translated = (await work).trim();
    if (!translated) throw new Error("AI 返回的翻译为空，请重试");
    const latest = readFollowUp();
    if (!latest) return NextResponse.json({ error: "待办跟进不存在" }, { status: 404 });
    if (auth.role !== "admin" && auth.name !== latest.assignee) return NextResponse.json({ error: "只能翻译自己的待办跟进" }, { status: 403 });
    if (latest.content !== followUp.content || latest.todo_content !== followUp.todo_content) return NextResponse.json({ error: "跟进内容或待办背景已更新，请刷新后重试" }, { status: 409 });
    const saved = db.prepare(`UPDATE todo_follow_ups SET content_zh = ?, content_zh_key = ? WHERE id = ? AND todo_id = ? AND content = ?
      AND EXISTS (SELECT 1 FROM todos WHERE id = todo_follow_ups.todo_id AND assignee = ? AND content = ?)`)
      .run(translated, sourceKey, Number(followUpId), Number(id), followUp.content, latest.assignee, followUp.todo_content);
    if (saved.changes !== 1) return NextResponse.json({ error: "待办跟进已更新，请刷新后重试" }, { status: 409 });
    return response({ ...latest, content_zh: translated, content_zh_key: sourceKey }, false);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败，请重试" }, { status: 502 });
  }
}
