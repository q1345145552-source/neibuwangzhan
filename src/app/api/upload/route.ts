import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Validate file type by magic bytes
    const header = buffer.slice(0, 4);
    const allowedHeaders: Record<string, number[]> = {
      jpg: [0xff, 0xd8, 0xff],
      png: [0x89, 0x50, 0x4e, 0x47],
      pdf: [0x25, 0x50, 0x44, 0x46],
      gif: [0x47, 0x49, 0x46, 0x38],
    };
    const matched = Object.entries(allowedHeaders).find(([, sig]) =>
      sig.every((b, i) => header[i] === b)
    );
    if (!matched && file.type && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }

    // Safe filename: remove special chars
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${Date.now()}-${safeName}`;
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const filePath = path.join(uploadsDir, uniqueName);

    await writeFile(filePath, buffer);
    const url = `/uploads/${uniqueName}`;

    return NextResponse.json({ url, name: safeName, size: file.size });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
