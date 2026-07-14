import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const rows = db.prepare("SELECT id, name, email, role FROM employees").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await req.json();
  const { name, email, role, password } = body;
  if (!name || !email) return NextResponse.json({ error: "请填写姓名和邮箱" }, { status: 400 });

  const hashedPassword = await bcrypt.hash(password || "123456", 10);
  const result = db.prepare(
    "INSERT INTO employees (name, email, role, password) VALUES (?, ?, ?, ?)"
  ).run(name, email, role || "employee", hashedPassword);
  const emp = db.prepare("SELECT id, name, email, role FROM employees WHERE id = ?").get(result.lastInsertRowid) as { id: number; name: string; email: string; role: string };
  logOperation(auth.name, "添加员工", "employee", String(emp.id));
    return NextResponse.json(emp, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await req.json();
  const { id, name, email, role, password } = body;
  if (!id) return NextResponse.json({ error: "请提供员工ID" }, { status: 400 });

  const sets: string[] = [];
  const params: unknown[] = [];
  if (name) { sets.push("name = ?"); params.push(name); }
  if (email) { sets.push("email = ?"); params.push(email); }
  if (role) { sets.push("role = ?"); params.push(role); }
  if (password) { sets.push("password = ?"); params.push(await bcrypt.hash(password, 10)); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  params.push(id);
  db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const emp = db.prepare("SELECT id, name, email, role FROM employees WHERE id = ?").get(id);
  return NextResponse.json(emp);
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await req.json();
  const { id } = body;
  if (!id) return NextResponse.json({ error: "请提供员工ID" }, { status: 400 });
  if (Number(id) === auth.id) return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
  // 保护最后一个管理员，避免系统失去管理入口
  const target = db.prepare("SELECT role FROM employees WHERE id = ?").get(id) as { role: string } | undefined;
  if (!target) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  if (target.role === "admin") {
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM employees WHERE role = 'admin'").get() as { c: number }).c;
    if (adminCount <= 1) return NextResponse.json({ error: "不能删除最后一个管理员" }, { status: 400 });
  }
  db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  logOperation(auth.name, "删除员工", "employee", String(id));
  return NextResponse.json({ success: true });
}
