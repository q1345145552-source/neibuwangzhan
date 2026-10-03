import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { isPublishedDocument, sourceOrderOf } from "@/lib/delivery-sync";

/**
 * 交付文件回传（2026-10-03，规则 13）：客户站用服务密钥回拉交付文件原件。
 * 只给仍处于对客公开状态的文档、或证书附件，且必须属于客户站同步过来的办理单；其余一律 404。
 */
const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};
const notFound = () => NextResponse.json({ error: "交付文件不存在" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ deliveryId: string }> }) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { deliveryId } = await params;
  const match = /^(doc|cert)-(\d+)$/.exec(deliveryId);
  if (!match) return notFound();
  const db = getDb();
  const row = match[1] === "doc"
    ? db.prepare("SELECT * FROM documents WHERE id = ?").get(Number(match[2])) as { order_id: string; file_url: string; status: string; direction: string; publication_verified: number } | undefined
    : db.prepare("SELECT order_id, file_url FROM certificates WHERE id = ?").get(Number(match[2])) as { order_id: string; file_url: string } | undefined;
  if (!row || !row.file_url || !sourceOrderOf(db, row.order_id)) return notFound();
  if (match[1] === "doc" && !isPublishedDocument(row as unknown as Parameters<typeof isPublishedDocument>[0])) return notFound();
  const safeName = /\/api\/files\/([A-Za-z0-9._-]+)/.exec(row.file_url)?.[1];
  if (!safeName) return notFound();
  const filePath = [path.join(process.cwd(), "uploads"), path.join(os.tmpdir(), "xiangtai-uploads")]
    .map(dir => path.join(dir, path.basename(safeName))).find(p => existsSync(p));
  if (!filePath) return notFound();
  const buffer = await readFile(filePath);
  return new NextResponse(buffer, { headers: {
    "Content-Type": MIME[path.extname(safeName).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store", "X-File-Name": safeName,
  } });
}
