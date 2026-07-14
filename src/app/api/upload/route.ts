import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import path from "path";
import os from "os";
import { verifyAuth } from "@/lib/auth";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 10 * 1024 * 1024;

const PROJECT_UPLOADS = path.join(process.cwd(), "uploads");
const TMP_UPLOADS = path.join(os.tmpdir(), "xiangtai-uploads");

function getUploadsDir(): string {
  try {
    if (!existsSync(PROJECT_UPLOADS)) {
      mkdirSync(PROJECT_UPLOADS, { recursive: true });
    }
    const testFile = path.join(PROJECT_UPLOADS, ".write-test");
    writeFileSync(testFile, "ok");
    unlinkSync(testFile);
    return PROJECT_UPLOADS;
  } catch {
    return TMP_UPLOADS;
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

const MAGIC_SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

function verifyMagic(buffer: Buffer, mimeType: string): boolean {
  const sig = MAGIC_SIGNATURES[mimeType];
  if (!sig) return true;
  if (buffer.length < sig.length) return false;
  return sig.every((b, i) => buffer[i] === b);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!verifyMagic(buffer.subarray(0, 8), file.type)) {
      return NextResponse.json({ error: "文件内容与类型不匹配" }, { status: 400 });
    }

    const uploadsDir = getUploadsDir();
    await ensureDir(uploadsDir);

    const timestamp = Date.now();
    const safeName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, safeName);

    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/api/files/${safeName}`, name: file.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[上传] 失败:", msg);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
