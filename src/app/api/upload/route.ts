import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Magic number signatures
const MAGIC_SIGNATURES: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};

function verifyMagic(buffer: Buffer, mimeType: string): boolean {
  const sig = MAGIC_SIGNATURES[mimeType];
  if (!sig) return true; // doc/xlsx magic check is unreliable, skip
  if (buffer.length < sig.length) return false;
  return sig.every((b, i) => buffer[i] === b);
}

export async function POST(req: NextRequest) {
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

    // Magic number check
    if (!verifyMagic(buffer.subarray(0, 8), file.type)) {
      return NextResponse.json({ error: "文件内容与类型不匹配" }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!existsSync(uploadsDir)) await mkdir(uploadsDir, { recursive: true });

    const timestamp = Date.now();
    const safeName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, safeName);

    await writeFile(filePath, buffer);

    return NextResponse.json({ url: `/uploads/${safeName}`, name: file.name });
  } catch {
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
