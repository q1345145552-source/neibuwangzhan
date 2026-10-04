import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads";
import { utcNowStr } from "@/lib/time";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf",
];
const MAX_SIZE = 10 * 1024 * 1024;
const RESULTS = ["合格", "不合格", "待复查"];

const FIELDS = "employee_id, exam_date, result, file_name, original_name, size, mime_type, created_by, updated_by, updated_at, created_at";

// GET /api/employees/medical?employee_id=X — 体检记录（仅管理员，员工不可见）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });

  const row = db.prepare(`SELECT ${FIELDS} FROM employee_medical_exams WHERE employee_id = ?`).get(employeeId) as any;
  return NextResponse.json(row ? { ...row, file_url: row.file_name ? `/api/files/${row.file_name}` : "" } : null);
}

// PUT /api/employees/medical — 保存体检记录（仅管理员），multipart: employee_id, exam_date, result, file(可空)
export async function PUT(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  try {
    const formData = await req.formData();
    const employeeId = Number(formData.get("employee_id"));
    const exam_date = String(formData.get("exam_date") || "").trim();
    const result = String(formData.get("result") || "").trim();
    const file = formData.get("file") as File | null;

    if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
    const emp = db.prepare("SELECT id, name FROM employees WHERE id = ?").get(employeeId);
    if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    if (!RESULTS.includes(result)) return NextResponse.json({ error: "体检结果不正确" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exam_date)) return NextResponse.json({ error: "请填写体检日期（YYYY-MM-DD）" }, { status: 400 });
    if (file) {
      if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "体检报告仅支持图片或 PDF" }, { status: 400 });
      if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    const existing = db.prepare(`SELECT ${FIELDS} FROM employee_medical_exams WHERE employee_id = ?`).get(employeeId) as any;

    let fileName = existing?.file_name || "";
    let originalName = existing?.original_name || "";
    let size = existing?.size || 0;
    let mimeType = existing?.mime_type || "";
    let filePath = "";

    if (file) {
      await mkdir(uploadsDir, { recursive: true });
      fileName = `${randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      originalName = file.name;
      size = file.size;
      mimeType = file.type;
      filePath = path.join(uploadsDir, fileName);
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(filePath, buffer, { flag: "wx" });
    }

    try {
      db.prepare(
        `INSERT INTO employee_medical_exams (employee_id, exam_date, result, file_name, original_name, size, mime_type, created_by, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(employee_id) DO UPDATE SET exam_date = excluded.exam_date, result = excluded.result, file_name = excluded.file_name, original_name = excluded.original_name, size = excluded.size, mime_type = excluded.mime_type, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(employeeId, exam_date, result, fileName, originalName, size, mimeType, auth.name, auth.name, utcNowStr());

      // 替换了报告文件：删除旧文件
      if (file && existing?.file_name && existing.file_name !== fileName) {
        const oldFp = path.join(uploadsDir, path.basename(existing.file_name));
        if (existsSync(oldFp)) await unlink(oldFp).catch(() => {});
      }

      logOperation(auth.name, "保存体检记录", "employee", String(employeeId), `${exam_date} ${result}`);
    } catch (error) {
      if (filePath) await unlink(filePath).catch(() => {});
      throw error;
    }

    const row = db.prepare(`SELECT ${FIELDS} FROM employee_medical_exams WHERE employee_id = ?`).get(employeeId) as any;
    return NextResponse.json({ ...row, file_url: row.file_name ? `/api/files/${row.file_name}` : "" });
  } catch (err) {
    console.error("[员工档案] 保存体检记录失败:", err);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
