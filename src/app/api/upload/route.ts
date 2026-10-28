import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import path from "path";
import os from "os";
import { verifyAuth, isStaff } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads";
import { HEIC_TYPES, hasHeicSignature } from "@/lib/heic-upload";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  ...HEIC_TYPES,
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 10 * 1024 * 1024;

const PROJECT_UPLOADS = uploadsDir;
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
  if (HEIC_TYPES.includes(mimeType)) return hasHeicSignature(buffer);
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
    const personal = formData.has("personal_folder_id");
    const rawNote = personal ? formData.get("note_name") : null;
    if (rawNote !== null && (typeof rawNote !== "string" || rawNote.trim().length > 200)) return NextResponse.json({error:"备注名最多200个字"},{status:400});
    const noteName = typeof rawNote === "string" ? rawNote.trim() : "";
    const rawFolder = formData.get("personal_folder_id");
    const folderId = rawFolder === "" ? null : Number(rawFolder);
    if (personal) {
      if (!isStaff(auth)) return NextResponse.json({error:"仅员工可用"},{status:403});
      if (folderId !== null && (!Number.isSafeInteger(folderId) || folderId <= 0 || !getDb().prepare("SELECT 1 FROM personal_folders WHERE id=? AND owner_id=?").get(folderId,auth.id))) {
        return NextResponse.json({error:"文件夹不存在或无权操作"},{status:403});
      }
    }

    if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (!verifyMagic(buffer.subarray(0, 128), file.type)) {
      return NextResponse.json({ error: "文件内容与类型不匹配" }, { status: 400 });
    }

    const uploadsDir = getUploadsDir();
    await ensureDir(uploadsDir);

    const timestamp = randomUUID();
    const safeName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, safeName);

    await writeFile(filePath, buffer, { flag: "wx" });
    try {
      const db = getDb();
      db.transaction(() => {
        db.prepare("INSERT INTO file_uploads (filename, uploaded_by_id, uploaded_by_role, mime_type, size, original_name) VALUES (?, ?, ?, ?, ?, ?)")
          .run(safeName, auth.id, auth.role, file.type, buffer.length, file.name);
        if (personal) {
          db.prepare("INSERT INTO personal_files(filename,owner_id,folder_id,note_name) VALUES (?,?,?,?)").run(safeName,auth.id,folderId,noteName);
          if (noteName) db.prepare("INSERT INTO personal_file_note_history(filename,old_note,new_note,changed_by_id,changed_by) VALUES(?,?,?,?,?)").run(safeName,"",noteName,auth.id,auth.name);
        }
      })();
    } catch (error) {
      // An unregistered write is not exposed as an uploaded file.
      await unlink(filePath);
      throw error;
    }

    return NextResponse.json({ url: `/api/files/${safeName}`, name: file.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[上传] 失败:", msg);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
