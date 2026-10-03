import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { refreshPayslipAutoFields } from "@/lib/payslips";
import { bangkokMonthKey } from "@/lib/time";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const COLS = "id, name, email, role, status, avatar, base_salary, diligence_bonus, skill_allowance, hire_date, gender, birth_date, phone, address, id_number, department, position, contract_term, bank_name, bank_account, emergency_name, emergency_phone, emergency_relation, education, skills, notes, bazi, fortune";
  type EmpRow = { id: number; name: string; email: string; role: string; status: string; avatar: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null; hire_date: string; gender: string; birth_date: string; phone: string; address: string; id_number: string; department: string; position: string; contract_term: string; bank_name: string; bank_account: string; emergency_name: string; emergency_phone: string; emergency_relation: string; education: string; skills: string; notes: string; bazi: string; fortune: string };

  const url = new URL(req.url);
  // 员工档案权限：?self=1 只返回当前登录员工自己的档案（普通员工只能看自己）
  if (url.searchParams.get("self") === "1") {
    const row = db.prepare(`SELECT ${COLS} FROM employees WHERE id = ?`).get(auth.id) as EmpRow | undefined;
    return NextResponse.json(row ? [row] : []);
  }

  // 默认只返回在职员工（供选人下拉框用，避免给离职员工派活）；?include_left=1 时返回全部（含离职）。
  const includeLeft = url.searchParams.get("include_left") === "1";
  const sql = includeLeft ? `SELECT ${COLS} FROM employees` : `SELECT ${COLS} FROM employees WHERE status != '离职'`;
  const rows = db.prepare(sql).all() as EmpRow[];

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
  const { name, email, role, password, hire_date } = body;
  if (!name || !email) return NextResponse.json({ error: "请填写姓名和邮箱" }, { status: 400 });

  // 管理员没指定密码时用 123456 兜底，但一律标记 must_change_password：
  // 新员工首次登录会被要求先设自己的密码，不会一直挂着一个人人皆知的初始密码。
  const hashedPassword = await bcrypt.hash(password || "123456", 10);
  const result = db.transaction(() => {
    const created = db.prepare(
      "INSERT INTO employees (name, email, role, password, must_change_password, hire_date) VALUES (?, ?, ?, ?, 1, ?)"
    ).run(name, email, role || "employee", hashedPassword, hire_date || "");
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
  const { id, name, email, role, password, status, customer_names, base_salary, diligence_bonus, skill_allowance, hire_date, gender, birth_date, phone, address, id_number } = body;
  if (!id) return NextResponse.json({ error: "请提供员工ID" }, { status: 400 });

  const enumErr = validateEnums({ "employees.role": role, "employees.status": status });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  const currentEmployee = db.prepare("SELECT role FROM employees WHERE id = ?").get(id) as { role: string } | undefined;
  if (!currentEmployee) return NextResponse.json({ error: "员工不存在" }, { status: 404 });
  // 改名时记录旧名字，用于同步考勤/补签/请假三张表里的历史记录
  const oldName = name
    ? (db.prepare("SELECT name FROM employees WHERE id = ?").get(id) as { name: string } | undefined)?.name
    : undefined;

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

  // 工资字段：底薪/技能津贴为数字（>=0），勤奋奖可空（不是人人都有）
  let salaryChanged = false;
  if (base_salary !== undefined && base_salary !== "") {
    const v = Number(base_salary);
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "底薪格式不正确" }, { status: 400 });
    sets.push("base_salary = ?"); params.push(v);
    salaryChanged = true;
  }
  if (diligence_bonus !== undefined) {
    if (diligence_bonus === "" || diligence_bonus === null) {
      sets.push("diligence_bonus = NULL");
    } else {
      const v = Number(diligence_bonus);
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "勤奋奖格式不正确" }, { status: 400 });
      sets.push("diligence_bonus = ?"); params.push(v);
    }
    salaryChanged = true;
  }
  if (skill_allowance !== undefined && skill_allowance !== "") {
    const v = Number(skill_allowance);
    if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "技能津贴格式不正确" }, { status: 400 });
    sets.push("skill_allowance = ?"); params.push(v);
    salaryChanged = true;
  }
  // 入职日期（YYYY-MM-DD，可空 = 未填写，按最早入职处理）
  if (hire_date !== undefined) {
    sets.push("hire_date = ?"); params.push(hire_date === null ? "" : String(hire_date));
  }
  // 员工档案字段：基本信息 + 工作信息 + 银行信息 + 紧急联系人 + 其他（均可空）
  for (const key of ["gender", "birth_date", "phone", "address", "id_number", "department", "position", "contract_term", "bank_name", "bank_account", "emergency_name", "emergency_phone", "emergency_relation", "education", "skills", "notes", "bazi", "fortune"] as const) {
    const v = body?.[key];
    if (v !== undefined) {
      sets.push(`${key} = ?`); params.push(v === null ? "" : String(v));
    }
  }

  // customer_names：客户账号能在外部端口看到哪些公司的订单（整表替换）
  const updatingScope = Array.isArray(customer_names);
  if (sets.length === 0 && !updatingScope) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  const refreshMonth = bangkokMonthKey();
  let refreshedDraft = false;
  db.transaction(() => {
    // A newly converted customer is not a legacy customer account. Keep explicit existing mappings,
    // but do not manufacture new access by falling back to their old employee display name.
    if (role === 'client' && currentEmployee.role !== 'client') {
      db.prepare("INSERT OR IGNORE INTO client_scope_settings (employee_id, mode) VALUES (?, 'explicit')").run(id);
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE employees SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    }
    // 改名同步：考勤表、补签表、请假表里的 employee_name 一起改成新名字
    if (name && oldName && name !== oldName) {
      db.prepare("UPDATE attendance SET employee_name = ? WHERE employee_name = ?").run(name, oldName);
      db.prepare("UPDATE attendance_requests SET employee_name = ? WHERE employee_name = ?").run(name, oldName);
      db.prepare("UPDATE leave_requests SET employee_name = ? WHERE employee_name = ?").run(name, oldName);
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
    // 工资档案变了 → 自动重算当月「草稿/打回」状态的工资单自动项（底薪/勤奋奖/技能津贴 + 社保/迟到/请假）。
    // 待确认/已确认/已发放的工资单一律不动。
    if (salaryChanged) {
      refreshedDraft = refreshPayslipAutoFields(db, Number(id), refreshMonth);
    }
  })();

  if (refreshedDraft) {
    logOperation(auth.name, "自动刷新草稿工资单", "payslip", `${id}/${refreshMonth}`, "工资档案变更，自动重算自动项");
  }

  if (updatingScope) {
    logOperation(auth.name, "配置客户可见范围", "employee", String(id),
      `可见公司: ${(customer_names as unknown[]).join("、") || "（清空）"}`);
  }

  const emp = db.prepare("SELECT id, name, email, role, status, base_salary, diligence_bonus, skill_allowance, hire_date, gender, birth_date, phone, address, id_number, department, position, contract_term, bank_name, bank_account, emergency_name, emergency_phone, emergency_relation, education, skills, notes, bazi, fortune FROM employees WHERE id = ?").get(id) as
    { id: number; role: string; status: string; base_salary: number | null; diligence_bonus: number | null; skill_allowance: number | null; hire_date: string; gender: string; birth_date: string; phone: string; address: string; id_number: string; department: string; position: string; contract_term: string; bank_name: string; bank_account: string; emergency_name: string; emergency_phone: string; emergency_relation: string; education: string; skills: string; notes: string; bazi: string; fortune: string } | undefined;
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
