import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const rows = db.prepare("SELECT id, name, email, role FROM employees").all() as
    { id: number; name: string; email: string; role: string }[];

  // 客户账号带上它能看到哪些公司的订单（外部客户端口的可见范围）
  const scoped = rows.map((r) => {
    if (r.role !== "client") return r;
    const names = db.prepare(
      "SELECT customer_name FROM client_account_customers WHERE employee_id = ? ORDER BY customer_name"
    ).all(r.id) as { customer_name: string }[];
    return { ...r, customer_names: names.map((n) => n.customer_name) };
  });
  return NextResponse.json(scoped);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await readJson(req);
  const { name, email, role, password } = body;
  if (!name || !email) return NextResponse.json({ error: "请填写姓名和邮箱" }, { status: 400 });

  // 管理员没指定密码时用 123456 兜底，但一律标记 must_change_password：
  // 新员工首次登录会被要求先设自己的密码，不会一直挂着一个人人皆知的初始密码。
  const hashedPassword = await bcrypt.hash(password || "123456", 10);
  const result = db.prepare(
    "INSERT INTO employees (name, email, role, password, must_change_password) VALUES (?, ?, ?, ?, 1)"
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

  const body = await readJson(req);
  const { id, name, email, role, password, customer_names } = body;
  if (!id) return NextResponse.json({ error: "请提供员工ID" }, { status: 400 });

  const enumErr = validateEnums({ "employees.role": role });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  const sets: string[] = [];
  const params: unknown[] = [];
  if (name) { sets.push("name = ?"); params.push(name); }
  if (email) { sets.push("email = ?"); params.push(email); }
  if (role) { sets.push("role = ?"); params.push(role); }
  // 管理员重置了别人的密码 → 强制对方下次登录改成自己的。
  // 否则重置出来的临时密码会长期留在管理员和员工两边手上。
  if (password) {
    sets.push("password = ?"); params.push(await bcrypt.hash(password, 10));
    sets.push("auth_version = auth_version + 1");
    if (Number(id) !== auth.id) sets.push("must_change_password = 1");
  }

  // customer_names：客户账号能在外部端口看到哪些公司的订单（整表替换）
  const updatingScope = Array.isArray(customer_names);
  if (sets.length === 0 && !updatingScope) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  db.transaction(() => {
    if (sets.length > 0) {
      db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    }
    if (updatingScope) {
      db.prepare("DELETE FROM client_account_customers WHERE employee_id = ?").run(id);
      const ins = db.prepare("INSERT OR IGNORE INTO client_account_customers (employee_id, customer_name) VALUES (?, ?)");
      for (const raw of customer_names as unknown[]) {
        const cn = String(raw || "").trim();
        if (cn) ins.run(id, cn);
      }
    }
  })();

  if (updatingScope) {
    logOperation(auth.name, "配置客户可见范围", "employee", String(id),
      `可见公司: ${(customer_names as unknown[]).join("、") || "（清空）"}`);
  }

  const emp = db.prepare("SELECT id, name, email, role FROM employees WHERE id = ?").get(id) as
    { id: number; role: string } | undefined;
  const scope = db.prepare(
    "SELECT customer_name FROM client_account_customers WHERE employee_id = ? ORDER BY customer_name"
  ).all(id) as { customer_name: string }[];
  return NextResponse.json({ ...emp, customer_names: scope.map((s) => s.customer_name) });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await readJson(req);
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
  db.transaction(() => {
    // 一并清掉客户可见范围映射，避免员工 id 被复用后新账号继承旧权限
    db.prepare("DELETE FROM client_account_customers WHERE employee_id = ?").run(id);
    db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除员工", "employee", String(id));
  return NextResponse.json({ success: true });
}
