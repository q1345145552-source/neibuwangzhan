import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
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
      try { unlinkSync(fp); } catch (e) { console.error("[物流文件] 删除磁盘文件失败", fp, e); }
    }
  }
}

// POST /api/logistics/[id]/files — 上传后把文件记录写进独立文件表
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const body = await readJson(req);
  const { name, url } = body;
  if (!name || !url) return NextResponse.json({ error: "缺少文件名或文件地址" }, { status: 400 });

  const order = db.prepare("SELECT id FROM shipping_orders WHERE id = ?").get(id);
  if (!order) return NextResponse.json({ error: "柜号订单不存在" }, { status: 404 });

  const result = db.prepare(
    "INSERT INTO shipping_order_files (order_id, name, url, uploaded_by) VALUES (?, ?, ?, ?)"
  ).run(id, name, url, auth.name);

  const file = db.prepare(
    "SELECT id, order_id, name, url, uploaded_by, created_at FROM shipping_order_files WHERE id = ?"
  ).get(result.lastInsertRowid);

  return NextResponse.json(file, { status: 201 });
}

// DELETE /api/logistics/[id]/files?id=文件编号 — 删除记录 + 磁盘文件
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const fileId = new URL(req.url).searchParams.get("id");
  if (!fileId) return NextResponse.json({ error: "缺少文件编号" }, { status: 400 });

  const file = db.prepare(
    "SELECT id, url FROM shipping_order_files WHERE id = ? AND order_id = ?"
  ).get(fileId, id) as { id: number; url: string } | undefined;
  if (!file) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  db.prepare("DELETE FROM shipping_order_files WHERE id = ? AND order_id = ?").run(fileId, id);
  deleteDiskFile(file.url);

  return NextResponse.json({ success: true });
}
