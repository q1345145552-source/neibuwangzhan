import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

type FollowUp = { id: number; todo_id: number; content: string; images: string; created_by: string; revision: number; assignee: string };
type Context = { params: Promise<{ id: string; followUpId: string }> };
const validId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const imagesOf = (raw: string): string[] => { try { const value = JSON.parse(raw || "[]"); return Array.isArray(value) ? value.filter((url: unknown) => typeof url === "string") : []; } catch { return []; } };

async function mutate(req: NextRequest, context: Context, remove: boolean) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id, followUpId } = await context.params;
  if (!validId(id) || !validId(followUpId)) return NextResponse.json({ error: "无效的待办或跟进ID" }, { status: 400 });
  const body = remove ? null : await readJson(req);
  const rawRevision = remove ? new URL(req.url).searchParams.get("revision") : body?.revision;
  if (rawRevision != null && (!Number.isSafeInteger(Number(rawRevision)) || Number(rawRevision) < 0 || (remove ? !/^\d+$/.test(rawRevision) : typeof rawRevision !== "number"))) {
    return NextResponse.json({ error: "无效的跟进版本" }, { status: 400 });
  }
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare(`SELECT f.*, t.assignee FROM todo_follow_ups f JOIN todos t ON t.id = f.todo_id WHERE f.id = ? AND f.todo_id = ?`)
      .get(Number(followUpId), Number(id)) as FollowUp | undefined;
    if (!row) return NextResponse.json({ error: "待办跟进不存在" }, { status: 404 });
    if (auth.role !== "admin" && (row.assignee !== auth.name || row.created_by !== auth.name)) {
      return NextResponse.json({ error: "只能操作自己待办中本人写的跟进记录" }, { status: 403 });
    }
    if (rawRevision != null && Number(rawRevision) !== row.revision) return NextResponse.json({ error: "跟进已被修改，请刷新后重试" }, { status: 409 });
    // 与操作日志相同字段；在本事务内直接写入，审计失败时一并回滚修改/删除。
    const audit = (action: string, detail: string, next = "") => db.prepare("INSERT INTO audit_logs (actor, action, target_type, target_id, detail, old_value, new_value, field_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(auth.name, action, "todo", String(row.todo_id), detail, JSON.stringify({ content: row.content, images: imagesOf(row.images) }), next, "follow_up");
    if (remove) {
      const deleted = db.prepare("DELETE FROM todo_follow_ups WHERE id = ? AND todo_id = ? AND revision = ?").run(row.id, row.todo_id, row.revision);
      if (deleted.changes !== 1) return NextResponse.json({ error: "跟进已变化，请刷新后重试" }, { status: 409 });
      audit("删除待办跟进", `跟进 #${row.id}：${row.content}`);
      return NextResponse.json({ success: true, id: row.id, todo_id: row.todo_id });
    }
    if (typeof body?.content !== "string" || !body.content.trim()) return NextResponse.json({ error: "请填写跟进内容" }, { status: 400 });
    if (body.images !== undefined && (!Array.isArray(body.images) || !body.images.every((url: unknown) => typeof url === "string" && !!url.trim()))) return NextResponse.json({ error: "图片列表无效" }, { status: 400 });
    const content = body.content.trim();
    const images = body.images === undefined ? imagesOf(row.images) : body.images.map((url: string) => url.trim());
    const saved = db.prepare("UPDATE todo_follow_ups SET content = ?, images = ?, revision = revision + 1, content_zh = '', content_zh_key = '' WHERE id = ? AND todo_id = ? AND revision = ?")
      .run(content, JSON.stringify(images), row.id, row.todo_id, row.revision);
    if (saved.changes !== 1) return NextResponse.json({ error: "跟进已变化，请刷新后重试" }, { status: 409 });
    audit("修改待办跟进", `跟进 #${row.id}`, JSON.stringify({ content, images }));
    const updated = db.prepare("SELECT * FROM todo_follow_ups WHERE id = ?").get(row.id) as FollowUp;
    return NextResponse.json({ ...updated, images });
  }).immediate();
}

export async function PATCH(req: NextRequest, context: Context) { return mutate(req, context, false); }
export async function DELETE(req: NextRequest, context: Context) { return mutate(req, context, true); }
