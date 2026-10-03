import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

const UPLOAD_DIRS = [path.join(process.cwd(), "uploads"), path.join(os.tmpdir(), "xiangtai-uploads")];

/** 从 /api/files/xxx 地址解析出文件名并删除磁盘文件 */
function deleteDiskFile(url: string): void {
  const m = (url || "").match(/\/api\/files\/([A-Za-z0-9._-]+)/);
  if (!m) return;
  const base = path.basename(m[1]);
  for (const dir of UPLOAD_DIRS) {
    const fp = path.join(dir, base);
    if (existsSync(fp)) {
      try { unlinkSync(fp); } catch (e) { console.error("[待办图片] 删除磁盘文件失败", fp, e); }
    }
  }
}

// PATCH /api/todos/:id — 标记完成/恢复未完成，或编辑（工作内容/紧急程度/负责人）
// 权限：员工只能操作自己的待办，管理员能操作任何人的
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const todo = db.prepare("SELECT assignee FROM todos WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // 权限：员工操作自己，管理员任何人
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能操作自己的待办" }, { status: 403 });
  }

  const body = await readJson(req);
  const { status, content, priority, assignee } = body;

  // 编辑模式：不带 status 时，编辑工作内容/紧急程度/负责人
  if (status === undefined) {
    if (!content?.trim()) {
      return NextResponse.json({ error: "请填写工作内容" }, { status: 400 });
    }
    // 负责人：员工固定为自己（不能把待办转给别人），管理员可指定
    const finalAssignee = auth.role === "admin" ? (assignee?.trim() || todo.assignee) : todo.assignee;
    const finalPriority = priority === "紧急" ? "紧急" : "普通";

    if (finalAssignee !== todo.assignee) {
      // 改派给新人：新负责人未看过
      db.prepare(
        "UPDATE todos SET content = ?, priority = ?, assignee = ?, seen_at = '', updated_at = datetime('now') WHERE id = ?"
      ).run(content.trim(), finalPriority, finalAssignee, id);
    } else {
      db.prepare(
        "UPDATE todos SET content = ?, priority = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(content.trim(), finalPriority, id);
    }
    logOperation(auth.name, "编辑待办", "todo", String(id), content.trim());
    const edited = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
    return NextResponse.json(edited);
  }

  if (status === "已完成") {
    db.prepare(
      "UPDATE todos SET status = '已完成', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "标记待办完成", "todo", String(id));
  } else if (status === "未完成") {
    db.prepare(
      "UPDATE todos SET status = '未完成', completed_at = '', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "待办恢复未完成", "todo", String(id));
  } else {
    return NextResponse.json({ error: "无效的状态" }, { status: 400 });
  }

  const updated = db.prepare("SELECT * FROM todos WHERE id = ?").get(id);
  return NextResponse.json(updated);
}

// DELETE /api/todos/:id — 删除待办（级联删除跟进记录 + 图片，含磁盘文件）
// 权限：员工只能删除自己的待办，管理员能删除任何人的
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const todo = db.prepare("SELECT assignee FROM todos WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // 权限：员工删自己，管理员任何人
  if (auth.role !== "admin" && auth.name !== todo.assignee) {
    return NextResponse.json({ error: "只能删除自己的待办" }, { status: 403 });
  }

  // 先取出所有图片的磁盘文件地址，删除记录后一并清磁盘
  const images = db.prepare("SELECT url FROM todo_images WHERE todo_id = ?").all(id) as { url: string }[];

  db.transaction(() => {
    db.prepare("DELETE FROM todo_follow_ups WHERE todo_id = ?").run(id);
    db.prepare("DELETE FROM todo_images WHERE todo_id = ?").run(id);
    db.prepare("DELETE FROM todos WHERE id = ?").run(id);
  })();

  for (const img of images) deleteDiskFile(img.url);
  logOperation(auth.name, "删除待办", "todo", String(id));
  return NextResponse.json({ success: true });
}
