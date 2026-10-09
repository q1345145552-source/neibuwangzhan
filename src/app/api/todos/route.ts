import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { syncAnnouncementOverdueTodos } from "@/lib/announcement-overdue";

// GET /api/todos — 待办列表（紧急的排前面）
// 管理员看所有员工的待办（前端按员工分组）；员工只看自己的
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  if (isAdmin) {
    // 管理员打开我的待办页面：顺带检测一遍逾期待办（生成/清理）
    syncAnnouncementOverdueTodos(auth.name);
  }
  // 每条待办附带最新一条跟进记录（按时间倒序取第一条），列表页直接展示进展
  const select = `SELECT t.*,
      (SELECT name FROM todo_categories tc WHERE tc.id = t.category_id) AS category_name,
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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { content, assignee, priority, images, category_id } = body;

  // 工作内容必填
  if (!content?.trim()) {
    return NextResponse.json({ error: "请填写工作内容" }, { status: 400 });
  }

  // 负责人：员工固定为自己（不接受请求体伪造）；管理员可从员工档案下拉指定
  const finalAssignee = auth.role === "admin" ? (assignee?.trim() || auth.name) : auth.name;
  // 紧急程度：紧急/普通两选，默认普通
  const finalPriority = priority === "紧急" ? "紧急" : "普通";
  // 分类：只能是当前登录人自己创建的分类（防止伪造别人的分类）
  let categoryId: number | null = null;
  if (category_id !== undefined && category_id !== null && category_id !== "") {
    const cid = Number(category_id);
    if (Number.isInteger(cid) && cid > 0) {
      const cat = db.prepare("SELECT id FROM todo_categories WHERE id = ? AND created_by = ?").get(cid, auth.name);
      if (cat) categoryId = cid;
    }
  }

  const result = db.prepare(
    "INSERT INTO todos (content, assignee, priority, status, created_by, category_id) VALUES (?, ?, ?, '未完成', ?, ?)"
  ).run(content.trim(), finalAssignee, finalPriority, auth.name, categoryId);

  const todoId = Number(result.lastInsertRowid);

  // 自己给自己建的待办算「已看过」；派给别人的待办初始为未读（seen_at 留空）
  if (finalAssignee === auth.name) {
    db.prepare("UPDATE todos SET seen_at = datetime('now') WHERE id = ?").run(todoId);
  } else {
    // 有人给别的员工建待办 → 给负责人发消息中心通知
    db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
      "待办指派", "你有新待办", `待办「${content.trim()}」由 ${auth.name} 派给你`, finalAssignee, String(todoId), "todo"
    );
  }

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
