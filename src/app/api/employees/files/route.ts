import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 10 * 1024 * 1024;
const CATEGORIES = ["合同", "错误承认书", "其他"];

const FIELDS = "id, employee_id, category, filename, original_name, size, mime_type, created_by, created_at";

// GET /api/employees/files?employee_id=X — 员工档案文件（管理员看任意员工；普通员工只看自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  if (auth.role !== "admin" && employeeId !== auth.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  const rows = db.prepare(`SELECT ${FIELDS} FROM employee_files WHERE employee_id = ? ORDER BY created_at DESC, id DESC`).all(employeeId) as any[];
  return NextResponse.json(rows.map((r) => ({ ...r, url: `/api/files/${r.filename}` })));
}

// POST /api/employees/files — 上传员工档案文件（仅管理员），multipart: employee_id, category, file
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  try {
    const formData = await req.formData();
    const employeeId = Number(formData.get("employee_id"));
    const category = String(formData.get("category") || "其他").trim();
    const file = formData.get("file") as File | null;

    if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
    const emp = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId) as { id: number; name: string } | undefined;
    if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    if (!CATEGORIES.includes(category)) return NextResponse.json({ error: "分类不正确" }, { status: 400 });
    if (!file) return NextResponse.json({ error: "请选择文件" }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });

    await mkdir(uploadsDir, { recursive: true });
    const safeName = `${randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, safeName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer, { flag: "wx" });

    try {
      db.prepare("INSERT INTO file_uploads (filename, uploaded_by_id, uploaded_by_role, mime_type, size) VALUES (?, ?, ?, ?, ?)")
        .run(safeName, auth.id, auth.role, file.type, file.size);
      const result = db.prepare("INSERT INTO employee_files (employee_id, category, filename, original_name, size, mime_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(employeeId, category, safeName, file.name, file.size, file.type, auth.name);
      logOperation(auth.name, "上传员工档案文件", "employee", String(employeeId), `${emp.name} ${category}：${file.name}`);
      const row = db.prepare(`SELECT ${FIELDS} FROM employee_files WHERE id = ?`).get(result.lastInsertRowid) as any;
      return NextResponse.json({ ...row, url: `/api/files/${row.filename}` }, { status: 201 });
    } catch (error) {
      await unlink(filePath).catch(() => {});
      throw error;
    }
  } catch (err) {
    console.error("[员工档案] 上传文件失败:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}

// DELETE /api/employees/files — 删除员工档案文件（仅管理员），body: { id }
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少文件ID" }, { status: 400 });

  const row = db.prepare(`SELECT ${FIELDS} FROM employee_files WHERE id = ?`).get(id) as any;
  if (!row) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  db.prepare("DELETE FROM employee_files WHERE id = ?").run(id);
  const fp = path.join(uploadsDir, path.basename(row.filename));
  if (existsSync(fp)) await unlink(fp).catch(() => {});
  logOperation(auth.name, "删除员工档案文件", "employee", String(row.employee_id), `${row.category}：${row.original_name || row.filename}`);
  return NextResponse.json({ success: true, id });
}
