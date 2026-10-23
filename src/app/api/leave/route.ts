import { publishBossSubmission } from "@/lib/boss-submissions";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { annualLeaveTotal, annualLeaveBalance } from "@/lib/annual-leave";
import { computeLeaveRules } from "@/lib/leave-rules";
import { bangkokToday } from "@/lib/time";
import { LEAVE_REVIEW_TITLES } from "@/lib/notification-types";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const employee = searchParams.get("employee");
  const status = searchParams.get("status");
  const month = searchParams.get("month");
  let sql = "SELECT * FROM leave_requests WHERE 1=1";
  const params: any[] = [];
  // 员工只能看自己的请假记录，管理员看全部
  if (auth.role !== "admin") {
    sql += " AND employee_name = ?";
    params.push(auth.name);
  } else if (employee) {
    sql += " AND employee_name = ?";
    params.push(employee);
  }
  if (status) { sql += " AND status = ?"; params.push(status); }
  if (month && /^\d{4}-\d{2}$/.test(month)) { sql += " AND start_date LIKE ?"; params.push(month + "%"); }
  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params) as any[];

  // 硬规则：给每条请假附上异常标记（频率/病假/日期/理由重复）
  const ruleFlags = computeLeaveRules(db);
  // 病假核查状态：附上每条请假的就医凭证核查状态/原因/授权状态
  const proofMap = new Map<number, { review_status: string; review_reason: string; authorization: string }>();
  const leaveIds = rows.map((r) => r.id);
  if (leaveIds.length > 0) {
    const placeholders = leaveIds.map(() => "?").join(",");
    const proofs = db.prepare(
      `SELECT leave_id, review_status, review_reason, authorization FROM leave_medical_proofs WHERE leave_id IN (${placeholders})`
    ).all(...leaveIds) as { leave_id: number; review_status: string; review_reason: string; authorization: string }[];
    for (const p of proofs) proofMap.set(p.leave_id, p);
  }
  const withFlags = rows.map((r) => ({
    ...r,
    flags: ruleFlags.get(r.id) || [],
    review_status: proofMap.get(r.id)?.review_status || "",
    review_reason: proofMap.get(r.id)?.review_reason || "",
    authorization: proofMap.get(r.id)?.authorization || "",
  }));

  // 审批超时提醒：管理员加载时，检查是否有超过24h未审批的请假，发一次通知
  if (auth.role === "admin") {
    const overdueLeaves = db.prepare(
      "SELECT id, employee_name, leave_type, start_date, end_date FROM leave_requests WHERE status = '待审批' AND datetime(created_at, '+1 day') <= datetime('now')"
    ).all() as { id: number; employee_name: string; leave_type: string; start_date: string; end_date: string }[];
    const admins = db.prepare("SELECT name FROM employees WHERE role = 'admin'").all() as { name: string }[];
    for (const ol of overdueLeaves) {
      // 去重：同一 leave_id + leave_overdue 类型只发一次
      const alreadyNotified = db.prepare(
        "SELECT id FROM notifications WHERE related_id = ? AND type = 'leave_overdue' AND related_type = 'leave'"
      ).get(String(ol.id));
      if (alreadyNotified) continue;
      for (const admin of admins) {
        db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
          "leave_overdue", "请假审批超时",
          `${ol.employee_name} 的${ol.leave_type}申请 (${ol.start_date} ~ ${ol.end_date}) 已超过24小时未审批`,
          admin.name, String(ol.id), "leave"
        );
      }
    }
  }

  return NextResponse.json(withFlags);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { leave_type, start_date, end_date, start_time, end_time, destination, reason, images } = body;
  const _e = validateEnums({ "leave_requests.leave_type": leave_type });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  // 防冒名：普通员工只能给自己提请假，管理员可代提
  const employee_name = auth.role === "admin" && body.employee_name ? body.employee_name : auth.name;
  if (!employee_name || !start_date || !end_date) return NextResponse.json({ error: "请填写必填字段" }, { status: 400 });
  if (end_date < start_date) return NextResponse.json({ error: "结束日期不能早于开始日期" }, { status: 400 });

  // 病假额度检查：当年已通过+待审批的病假总天数超过10天则拒绝
  if (leave_type === "病假") {
    const year = start_date.slice(0, 4);
    const sickTotal = db.prepare(
      "SELECT SUM(julianday(end_date) - julianday(start_date) + 1) as total FROM leave_requests WHERE employee_name = ? AND leave_type = '病假' AND start_date LIKE ? AND status IN ('已通过','待审批')"
    ).get(employee_name, year + "%") as { total: number | null };
    const used = Math.round(sickTotal?.total || 0);
    if (used >= 10) {
      return NextResponse.json({ error: `今年的病假额度已用完（已使用${used}天，上限10天）` }, { status: 400 });
    }
    const reqDays = Math.round(
      (new Date(end_date + "T00:00:00").getTime() - new Date(start_date + "T00:00:00").getTime()) / 86400000
    ) + 1;
    if (used + reqDays > 10) {
      return NextResponse.json({ error: `病假额度不足：已用${used}天，本次申请${reqDays}天超出年度上限10天` }, { status: 400 });
    }
  }

  // 年假额度检查：工龄超过一年才 6 天，不足一年 0 天；超过剩余额度则拒绝
  if (leave_type === "年假") {
    const today = bangkokToday();
    const year = today.slice(0, 4);
    const emp = db.prepare("SELECT hire_date FROM employees WHERE name = ?").get(employee_name) as { hire_date: string | null } | undefined;
    const total = annualLeaveTotal(emp?.hire_date ?? null, today);
    if (total <= 0) {
      return NextResponse.json({ error: "工龄未满一年，暂无年假额度" }, { status: 400 });
    }
    const balance = annualLeaveBalance(db, employee_name, today);
    const occupied = db.prepare(
      "SELECT COALESCE(SUM(julianday(end_date) - julianday(start_date) + 1), 0) as total FROM leave_requests WHERE employee_name = ? AND leave_type = '年假' AND start_date LIKE ? AND status IN ('已通过','待审批')"
    ).get(employee_name, year + "%") as { total: number };
    const pending = Math.round(occupied.total || 0);
    const reqDays = Math.round(
      (new Date(end_date + "T00:00:00").getTime() - new Date(start_date + "T00:00:00").getTime()) / 86400000
    ) + 1;
    if (pending + reqDays > total) {
      return NextResponse.json({ error: `年假额度不足：总额${total}天，已用${balance.used}天，待审批${pending - balance.used}天，本次申请${reqDays}天` }, { status: 400 });
    }
  }

  const imagesJson = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
  const result = db.transaction(() => {
    const saved = db.prepare(
      "INSERT INTO leave_requests (employee_name, leave_type, start_date, end_date, start_time, end_time, destination, reason, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(employee_name, leave_type || "事假", start_date, end_date, start_time || "09:00", end_time || "17:00", destination || "", reason || "", imagesJson);
    publishBossSubmission(db, "leave", Number(saved.lastInsertRowid), employee_name, `提交了${leave_type || "事假"}申请（${start_date} 至 ${end_date}）`);
    return saved;
  })();
  logOperation(employee_name, "提交请假", "leave", String(result.lastInsertRowid), `${leave_type || "事假"} ${start_date} ~ ${end_date}`);
  return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  // 注意：请求体里的 approved_by 一律忽略，审批人取自登录态
  const { id, status, images, append_images, rejection_reason } = body;

  if (!id) return NextResponse.json({ error: "缺少参数 id" }, { status: 400 });

  // 补传附件：只追加图片，不改状态（本人或管理员）
  if (append_images !== undefined && Array.isArray(append_images)) {
    const existing = db.prepare("SELECT images, employee_name FROM leave_requests WHERE id = ?").get(id) as any;
    if (!existing) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });
    if (auth.role !== "admin" && existing.employee_name !== auth.name) {
      return NextResponse.json({ error: "只能给自己的申请补传附件" }, { status: 403 });
    }
    const oldImages: string[] = (() => { try { return JSON.parse(existing.images || "[]"); } catch { return []; } })();
    const newImages = append_images.filter((s: string) => s && s.trim());
    const merged = [...oldImages, ...newImages];
    db.prepare("UPDATE leave_requests SET images = ? WHERE id = ?").run(JSON.stringify(merged), id);
    return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
  }

  // 正常审批流程 —— 仅管理员可审批，否则员工可自批请假绕过缺勤统计
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可审批请假" }, { status: 403 });
  if (!status) return NextResponse.json({ error: "缺少参数 status" }, { status: 400 });
  const validStatuses = ["待审批", "已通过", "已驳回"];
  if (!validStatuses.includes(status)) return NextResponse.json({ error: "无效的状态值" }, { status: 400 });

  const rejectionReason = typeof rejection_reason === "string" ? rejection_reason.trim() : "";
  if (status === "已驳回" && !rejectionReason) return NextResponse.json({ error: "请填写驳回原因" }, { status: 400 });

  // 审批、原考勤回写、申请人提醒和日志同一事务；任何一步失败全部回滚。
  return db.transaction(() => {
    const target = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
    if (!target) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });
    if (target.status === status) {
      // 保留旧调用附带替换附件的能力，但不重复审批、回写考勤或发结果提醒。
      if (images !== undefined) {
        const nextImages = Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]";
        if (nextImages !== target.images) db.prepare("UPDATE leave_requests SET images = ? WHERE id = ?").run(nextImages, id);
      }
      return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
    }

    const sets = ["status = ?", "rejection_reason = ?"];
    const vals: any[] = [status, status === "已驳回" ? rejectionReason : ""];
    if (images !== undefined) { sets.push("images = ?"); vals.push(Array.isArray(images) ? JSON.stringify(images.filter((s: string) => s && s.trim())) : "[]"); }
    if (status === "已通过" || status === "已驳回") { sets.push("approved_at = datetime('now')"); sets.push("approved_by = ?"); vals.push(auth.name); }
    vals.push(id, target.status);
    const changed = db.prepare(`UPDATE leave_requests SET ${sets.join(", ")} WHERE id = ? AND status = ?`).run(...vals);
    if (changed.changes !== 1) return NextResponse.json({ error: "请假状态已变化，请刷新后重试" }, { status: 409 });

    // 请假通过：在该日期范围内自动创建/标记考勤为请假
    if (status === "已通过") {
      const leaveReq = db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id) as any;
      if (leaveReq) {
        const start = new Date(leaveReq.start_date + "T00:00:00Z");
        const end = new Date(leaveReq.end_date + "T00:00:00Z");
        for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
          const ds = d.toISOString().split("T")[0];
          const existing = db.prepare("SELECT id FROM attendance WHERE employee_name = ? AND date = ?").get(leaveReq.employee_name, ds) as any;
          if (existing) {
            db.prepare("UPDATE attendance SET type = '请假' WHERE id = ?").run(existing.id);
          } else {
            db.prepare("INSERT INTO attendance (employee_name, date, type) VALUES (?, ?, '请假')").run(leaveReq.employee_name, ds);
          }
        }
      }
    }

    if (status === "已通过" || status === "已驳回") {
      const title = LEAVE_REVIEW_TITLES[status === "已通过" ? 0 : 1];
      const range = `${target.start_date} ${target.start_time || "09:00"} 至 ${target.end_date} ${target.end_time || "17:00"}`;
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "", title, `${auth.name}${status === "已通过" ? "已通过" : "已驳回"}你的${target.leave_type}申请（${range}）。${status === "已驳回" ? `\n驳回原因：${rejectionReason}` : ""}`,
        target.employee_name, String(target.id), "leave_review"
      );
      logOperation(auth.name, title, "leave", String(target.id), target.employee_name);
    }
    return NextResponse.json(db.prepare("SELECT * FROM leave_requests WHERE id = ?").get(id));
  }).immediate();
}
