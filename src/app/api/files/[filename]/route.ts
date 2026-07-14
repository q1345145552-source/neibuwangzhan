import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import os from "os";
import { existsSync } from "fs";
import { verifyToken } from "@/lib/auth";

const PROJECT_UPLOADS = path.join(process.cwd(), "uploads");
const TMP_UPLOADS = path.join(os.tmpdir(), "xiangtai-uploads");

function findFile(safeName: string): string | null {
  for (const dir of [PROJECT_UPLOADS, TMP_UPLOADS]) {
    const fp = path.join(dir, safeName);
    if (existsSync(fp)) return fp;
  }
  return null;
}

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  // 浏览器直接导航（<img>/<a target=_blank>）无法带 Authorization header，
  // 所以除了 header 之外也接受 ?token= 查询参数
  const authHeader = req.headers.get("Authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get("token");
  const token = headerToken || queryToken;
  if (!token || !(await verifyToken(token))) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { filename } = await params;
  const safeName = path.basename(filename);
  const filePath = findFile(safeName);

  if (!filePath) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  try {
    const buffer = await readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "读取文件失败" }, { status: 500 });
  }
}
