import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  // 默认只返回在职员工（供选人下拉框用，避免给离职员工派活）；?include_left=1 时返回全部（含离职）。
  const includeLeft = new URL(req.url).searchParams.get("include_left") === "1";
  const sql = includeLeft
    ? "SELECT id, name, email, role, status FROM employees"
    : "SELECT id, name, email, role, status FROM employees WHERE status != '离职'";
  const rows = db.prepare(sql).all() as
    { id: number; name: string; email: string; role: string; status: string }[];

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
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await readJson(req);
  const { name, email, role, password } = body;
  if (!name || !email) return NextResponse.json({ error: "请填写姓名和邮箱" }, { status: 400 });

  // 管理员没指定密码时用 123456 兜底，但一律标记 must_change_password：
  // 新员工首次登录会被要求先设自己的密码，不会一直挂着一个人人皆知的初始密码。
  const hashedPassword = await bcrypt.hash(password || "123456", 10);
  const result = db.transaction(() => {
    const created = db.prepare(
      "INSERT INTO employees (name, email, role, password, must_change_password) VALUES (?, ?, ?, ?, 1)"
    ).run(name, email, role || "employee", hashedPassword);
    if (role === 'client') db.prepare("INSERT INTO client_scope_settings (employee_id, mode) VALUES (?, 'explicit')").run(created.lastInsertRowid);
    return created;
  })();
  const emp = db.prepare("SELECT id, name, email, role, status FROM employees WHERE id = ?").get(result.lastInsertRowid) as { id: number; name: string; email: string; role: string; status: string };
  logOperation(auth.name, "添加员工", "employee", String(emp.id));
    return NextResponse.json(emp, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();

  const body = await readJson(req);
  const { id, name, email, role, password, status, customer_names } = body;
  if (!id) return NextResponse.json({ error: "请提供员工ID" }, { status: 400 });

  const enumErr = validateEnums({ "employees.role": role, "employees.status": status });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  const currentEmployee = db.prepare("SELECT role FROM employees WHERE id = ?").get(id) as { role: string } | undefined;
  if (!currentEmployee) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  const sets: string[] = [];
  const params: unknown[] = [];
  if (name) { sets.push("name = ?"); params.push(name); }
  if (email) { sets.push("email = ?"); params.push(email); }
  if (role) { sets.push("role = ?"); params.push(role); }
  // 标记离职 / 恢复在职
  if (status) {
    if (status === "离职") {
      if (Number(id) === auth.id) return NextResponse.json({ error: "不能标记自己离职" }, { status: 400 });
      const target = db.prepare("SELECT role FROM employees WHERE id = ?").get(id) as { role: string } | undefined;
      if (!target) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
      if (target.role === "admin") {
        const adminCount = (db.prepare("SELECT COUNT(*) as c FROM employees WHERE role = 'admin' AND status = '在职'").get() as { c: number }).c;
        if (adminCount <= 1) return NextResponse.json({ error: "不能标记最后一个在职管理员离职" }, { status: 400 });
      }
    }
    sets.push("status = ?"); params.push(status);
  }
  // 保留当前管理员重置后免强改政策，并撤销旧会话。
  if (password) {
    sets.push("password = ?"); params.push(await bcrypt.hash(password, 10));
    sets.push("auth_version = auth_version + 1");
    // 管理员重置密码后不再强制对方改密：强制改密会叠加短 token，
    // 造成「重置 → 登录 → 被踢 → 再重置」的死循环。改密入口仍保留，需要的人可自行改。
    sets.push("must_change_password = 0");
  }

  // customer_names：客户账号能在外部端口看到哪些公司的订单（整表替换）
  const updatingScope = Array.isArray(customer_names);
  if (sets.length === 0 && !updatingScope) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  db.transaction(() => {
    // A newly converted customer is not a legacy customer account. Keep explicit existing mappings,
    // but do not manufacture new access by falling back to their old employee display name.
    if (role === 'client' && currentEmployee.role !== 'client') {
      db.prepare("INSERT OR IGNORE INTO client_scope_settings (employee_id, mode) VALUES (?, 'explicit')").run(id);
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    }
    if (updatingScope) {
      db.prepare("INSERT INTO client_scope_settings (employee_id, mode) VALUES (?, 'explicit') ON CONFLICT(employee_id) DO UPDATE SET mode='explicit', updated_at=datetime('now')").run(id);
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

  const emp = db.prepare("SELECT id, name, email, role, status FROM employees WHERE id = ?").get(id) as
    { id: number; role: string; status: string } | undefined;
  const scope = db.prepare(
    "SELECT customer_name FROM client_account_customers WHERE employee_id = ? ORDER BY customer_name"
  ).all(id) as { customer_name: string }[];
  return NextResponse.json({ ...emp, customer_names: scope.map((s) => s.customer_name) });
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
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
  const hasCommerce = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commerce_sales'").get();
  if (hasCommerce && (db.prepare("SELECT 1 FROM commerce_sales WHERE buyer_account_id=? LIMIT 1").get(id) ||
      db.prepare("SELECT 1 FROM commerce_invoices WHERE paid_by=? LIMIT 1").get(id))) {
    return NextResponse.json({ error: "账号已关联商城历史订单或收款，请停用账号以保留归属记录" }, { status: 409 });
  }
  db.transaction(() => {
    // 一并清掉客户可见范围映射，避免员工 id 被复用后新账号继承旧权限
    db.prepare("DELETE FROM client_account_customers WHERE employee_id = ?").run(id);
    db.prepare("DELETE FROM client_scope_settings WHERE employee_id = ?").run(id);
    db.prepare("DELETE FROM employees WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除员工", "employee", String(id));
  return NextResponse.json({ success: true });
}
