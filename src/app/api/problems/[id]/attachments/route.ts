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
      try { unlinkSync(fp); } catch (e) { console.error("[问题附件] 删除磁盘文件失败", fp, e); }
    }
  }
}

// 判断是否有权操作附件：负责人或管理员
function canManage(role: string, name: string, assignee: string): boolean {
  return role === "admin" || name === assignee;
}

// POST /api/problems/:id/attachments — 上传后保存附件记录（仅负责人/管理员）
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT assignee FROM problems WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  if (!canManage(auth.role, auth.name, problem.assignee)) {
    return NextResponse.json({ error: "只有负责人或管理员能上传附件" }, { status: 403 });
  }

  const body = await readJson(req);
  const { name, url } = body;
  if (!name || !url) return NextResponse.json({ error: "缺少文件名或文件地址" }, { status: 400 });

  const result = db.prepare(
    "INSERT INTO problem_attachments (problem_id, name, url, uploaded_by) VALUES (?, ?, ?, ?)"
  ).run(id, name, url, auth.name);

  const attachment = db.prepare("SELECT * FROM problem_attachments WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(attachment, { status: 201 });
}

// DELETE /api/problems/:id/attachments?id=附件编号 — 删除记录 + 磁盘文件（仅负责人/管理员）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT assignee FROM problems WHERE id = ?").get(id) as { assignee: string } | undefined;
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  if (!canManage(auth.role, auth.name, problem.assignee)) {
    return NextResponse.json({ error: "只有负责人或管理员能删除附件" }, { status: 403 });
  }

  const attachmentId = new URL(req.url).searchParams.get("id");
  if (!attachmentId) return NextResponse.json({ error: "缺少附件编号" }, { status: 400 });

  const attachment = db.prepare(
    "SELECT id, url FROM problem_attachments WHERE id = ? AND problem_id = ?"
  ).get(attachmentId, id) as { id: number; url: string } | undefined;
  if (!attachment) return NextResponse.json({ error: "附件不存在" }, { status: 404 });

  db.prepare("DELETE FROM problem_attachments WHERE id = ? AND problem_id = ?").run(attachmentId, id);
  deleteDiskFile(attachment.url);
  logOperation(auth.name, "删除问题附件", "problem", String(id));
  return NextResponse.json({ success: true });
}
