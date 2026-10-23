import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { translateText } from "@/lib/deepseek";
import { todoTranslationKey, withValidTodoTranslation } from "@/lib/todo-translation";

type TodoSource = { id: number; content: string; content_zh: string; content_zh_key: string; assignee: string; category_id: number | null; category_name: string | null };
const pending = new Map<string, Promise<string>>();

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const body = await readJson(req);
  const rawId = body?.id;
  const id = Number(rawId);
  if ((typeof rawId !== "number" && !(typeof rawId === "string" && /^[1-9]\d*$/.test(rawId))) || !Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的待办ID" }, { status: 400 });

  const db = getDb();
  const readTodo = () => db.prepare(`SELECT t.id, t.content, t.content_zh, t.content_zh_key, t.assignee, t.category_id,
    (SELECT name FROM todo_categories WHERE id = t.category_id) AS category_name FROM todos t WHERE t.id = ?`).get(id) as TodoSource | undefined;
  const todo = readTodo();
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });
  if (auth.role !== "admin" && todo.assignee !== auth.name) return NextResponse.json({ error: "只能翻译自己的待办" }, { status: 403 });
  const response = (row: TodoSource, cached: boolean) => NextResponse.json({ content_zh: row.content_zh, content_zh_key: row.content_zh_key, cached, content: row.content, category_id: row.category_id, category_name: row.category_name });
  if (withValidTodoTranslation(todo).content_zh?.trim()) return response(todo, true);
  if (!todo.content?.trim()) return NextResponse.json({ error: "工作内容为空" }, { status: 400 });

  const sourceKey = todoTranslationKey(todo);
  const requestKey = `${id}:${sourceKey}`;
  try {
    let work = pending.get(requestKey);
    if (!work) {
      work = translateText(todo.content, "中文", `待办分类：${todo.category_name || "未分类"}`);
      pending.set(requestKey, work);
      const currentWork = work;
      void work.finally(() => { if (pending.get(requestKey) === currentWork) pending.delete(requestKey); }).catch(() => {});
    }
    const translated = (await work).trim();
    if (!translated) throw new Error("AI 返回的翻译为空，请重试");
    // 翻译期间可能编辑、改派或重命名分类：重新核对权限和整个翻译输入。
    const latest = readTodo();
    if (!latest) return NextResponse.json({ error: "待办不存在" }, { status: 404 });
    if (auth.role !== "admin" && latest.assignee !== auth.name) return NextResponse.json({ error: "只能翻译自己的待办" }, { status: 403 });
    if (todoTranslationKey(latest) !== sourceKey) return NextResponse.json({ error: "待办内容或分类已更新，请刷新后重试" }, { status: 409 });
    const saved = db.prepare(`UPDATE todos SET content_zh = ?, content_zh_key = ? WHERE id = ? AND content = ? AND assignee = ? AND category_id IS ?
      AND COALESCE((SELECT name FROM todo_categories WHERE id = todos.category_id), '') = ?`)
      .run(translated, sourceKey, id, todo.content, latest.assignee, todo.category_id, todo.category_name || "");
    if (saved.changes !== 1) return NextResponse.json({ error: "待办已更新，请刷新后重试" }, { status: 409 });
    return response({ ...latest, content_zh: translated, content_zh_key: sourceKey }, false);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败，请重试" }, { status: 502 });
  }
}
