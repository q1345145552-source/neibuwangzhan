import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { getDb, logOperation, notifyAdmins } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const MAX_SIZE = 10 * 1024 * 1024;

const FIELDS = "id, employee_id, employee_name, content, file_name, original_name, size, mime_type, created_by, created_at";

// GET /api/employees/demerits?employee_id=X — 记过（严重处分）记录 + 记过次数（管理员看任意员工；普通员工只看自己）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const employeeId = Number(new URL(req.url).searchParams.get("employee_id"));
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  if (auth.role !== "admin" && employeeId !== auth.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  const rows = db.prepare(`SELECT ${FIELDS} FROM demerits WHERE employee_id = ? ORDER BY created_at DESC, id DESC`).all(employeeId) as any[];
  return NextResponse.json({
    count: rows.length,
    records: rows.map((r) => ({ ...r, file_url: r.file_name ? `/api/files/${r.file_name}` : "" })),
  });
}

// POST /api/employees/demerits — 记过（仅管理员），multipart: employee_id, content, file(警告函，可空)
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  try {
    const formData = await req.formData();
    const employeeId = Number(formData.get("employee_id"));
    const content = String(formData.get("content") || "").trim();
    const file = formData.get("file") as File | null;

    if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
    const emp = db.prepare("SELECT id, name, status FROM employees WHERE id = ?").get(employeeId) as { id: number; name: string; status: string } | undefined;
    if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    if (!content) return NextResponse.json({ error: "请填写记过内容" }, { status: 400 });
    if (file) {
      if (!ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
      if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件不能超过 10MB" }, { status: 400 });
    }

    let fileName = "";
    let originalName = "";
    let size = 0;
    let mimeType = "";
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

    let result: any;
    try {
      result = db.prepare(
        "INSERT INTO demerits (employee_id, employee_name, content, file_name, original_name, size, mime_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(employeeId, emp.name, content, fileName, originalName, size, mimeType, auth.name);

      // 记过次数
      const cnt = (db.prepare("SELECT COUNT(*) as c FROM demerits WHERE employee_id = ?").get(employeeId) as { c: number }).c;

      // 记过两次（及以上）提醒管理员：可标记离职，但必须管理员手动判决，系统不自动离职
      if (cnt >= 2) {
        notifyAdmins(
          "demerit_resign",
          "员工记过提醒",
          `${emp.name} 已累计记过 ${cnt} 次，可在员工档案中标记离职（需手动判决，系统不会自动离职）`,
          String(employeeId),
          "demerit"
        );
      }

      logOperation(auth.name, "记过（严重处分）", "employee", String(employeeId), `${emp.name} ${content}（第${cnt}次）`);
    } catch (error) {
      if (filePath) await unlink(filePath).catch(() => {});
      throw error;
    }

    const row = db.prepare(`SELECT ${FIELDS} FROM demerits WHERE id = ?`).get(result.lastInsertRowid) as any;
    return NextResponse.json({ ...row, file_url: row.file_name ? `/api/files/${row.file_name}` : "" }, { status: 201 });
  } catch (err) {
    console.error("[员工档案] 记过失败:", err);
    return NextResponse.json({ error: "记过失败" }, { status: 500 });
  }
}
