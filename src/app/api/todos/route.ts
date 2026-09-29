import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// GET /api/todos — 待办列表（紧急的排前面）
// 管理员看所有员工的待办（前端按员工分组）；员工只看自己的
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  // 每条待办附带最新一条跟进记录（按时间倒序取第一条），列表页直接展示进展
  const select = `SELECT t.*,
      (SELECT content FROM todo_follow_ups f WHERE f.todo_id = t.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS latest_follow_content,
      (SELECT created_by FROM todo_follow_ups f WHERE f.todo_id = t.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS latest_follow_by,
      (SELECT created_at FROM todo_follow_ups f WHERE f.todo_id = t.id ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS latest_follow_at
     FROM todos t`;
  const orderBy = ` ORDER BY CASE t.priority WHEN '紧急' THEN 0 ELSE 1 END, t.created_at DESC`;

  const rows = isAdmin
    ? db.prepare(select + orderBy).all()
    : db.prepare(select + ` WHERE t.assignee = ?` + orderBy).all(auth.name);

  // 每条待办附带图片列表（按上传顺序）
  const imgsStmt = db.prepare("SELECT url FROM todo_images WHERE todo_id = ? ORDER BY id ASC");
  const result = rows.map((r: any) => ({ ...r, images: imgsStmt.all(r.id).map((i: any) => i.url) }));
  return NextResponse.json(result);
}

// POST /api/todos — 新建待办（状态默认未完成）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const { content, assignee, priority, images } = body;

  // 工作内容必填
  if (!content?.trim()) {
    return NextResponse.json({ error: "请填写工作内容" }, { status: 400 });
  }

  // 负责人：员工固定为自己（不接受请求体伪造）；管理员可从员工档案下拉指定
  const finalAssignee = auth.role === "admin" ? (assignee?.trim() || auth.name) : auth.name;
  // 紧急程度：紧急/普通两选，默认普通
  const finalPriority = priority === "紧急" ? "紧急" : "普通";

  const result = db.prepare(
    "INSERT INTO todos (content, assignee, priority, status, created_by) VALUES (?, ?, ?, '未完成', ?)"
  ).run(content.trim(), finalAssignee, finalPriority, auth.name);

  const todoId = Number(result.lastInsertRowid);

  // 图片（可选，多张）：url 列表随待办一起保存
  const imgUrls = Array.isArray(images)
    ? images.filter((u: unknown) => typeof u === "string" && u.trim()).map((u: string) => u.trim())
    : [];
  if (imgUrls.length > 0) {
    const insImg = db.prepare("INSERT INTO todo_images (todo_id, url, uploaded_by) VALUES (?, ?, ?)");
    for (const url of imgUrls) insImg.run(todoId, url, auth.name);
  }

  const todo = db.prepare("SELECT * FROM todos WHERE id = ?").get(todoId);
  logOperation(auth.name, "新建待办", "todo", String(todoId), content.trim());
  return NextResponse.json(todo, { status: 201 });
}
