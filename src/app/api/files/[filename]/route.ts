import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import os from "os";
import { existsSync } from "fs";

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
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
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
