import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isSyncRequest, syncRateLimited, recordSyncAuthFailure } from "@/lib/sync-auth";
import { kitFilePath } from "@/lib/order-kit";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** 资料包里的一份文件（2026-10-20）：只给属于这张客户单资料包的文件，其余一律 404。 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  if (syncRateLimited(req)) return NextResponse.json({ error: "尝试过于频繁，请稍后再试" }, { status: 429 });
  if (!isSyncRequest(req)) {
    recordSyncAuthFailure(req);
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const { fileId } = await params;
  const sourceOrderNo = req.nextUrl.searchParams.get("source_order_no") || "";
  const found = /^\d{1,12}$/.test(fileId) && sourceOrderNo ? kitFilePath(getDb(), sourceOrderNo, Number(fileId)) : null;
  if (!found) return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  const buffer = await readFile(found.abs);
  return new NextResponse(buffer, { headers: {
    "Content-Type": MIME[path.extname(found.abs).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store", "X-File-Name": encodeURIComponent(found.file.name),
  } });
}
