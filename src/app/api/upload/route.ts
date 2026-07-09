import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import path from "path";
import os from "os";

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
    console.log("[上传] 使用项目目录:", PROJECT_UPLOADS);
    return PROJECT_UPLOADS;
  } catch {
    console.log("[上传] 项目目录不可写，改用临时目录:", TMP_UPLOADS);
    return TMP_UPLOADS;
  }
}

async function ensureDir(dir: string): Promise<void> {
  console.log("[上传] 检查目录:", dir);
  if (!existsSync(dir)) {
    console.log("[上传] 创建目录:", dir);
    await mkdir(dir, { recursive: true });
    console.log("[上传] 目录创建完成");
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
  try {
    console.log("[上传] === 开始上传 ===");

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    console.log("[上传] 收到文件:", file?.name, file?.size, file?.type);

    if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      console.log("[上传] 类型不支持:", file.type);
      return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      console.log("[上传] 文件过大:", file.size);
      return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    console.log("[上传] buffer 大小:", buffer.length);

    if (!verifyMagic(buffer.subarray(0, 8), file.type)) {
      console.log("[上传] 魔数不匹配:", [...buffer.subarray(0, 4)]);
      return NextResponse.json({ error: "文件内容与类型不匹配" }, { status: 400 });
    }

    const uploadsDir = getUploadsDir();
    await ensureDir(uploadsDir);

    const timestamp = Date.now();
    const safeName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, safeName);

    console.log("[上传] 写入:", filePath);
    await writeFile(filePath, buffer);
    console.log("[上传] 成功:", safeName);

    return NextResponse.json({ url: `/api/files/${safeName}`, name: file.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[上传] 失败:", msg);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
