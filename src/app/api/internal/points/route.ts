import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// ── GET: 积分引擎 + 排名榜 + 记录列表 ──
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const employee = req.nextUrl.searchParams.get("employee") || "";
  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);
  const doRefresh = req.nextUrl.searchParams.get("refresh") === "1";

  if (doRefresh) {
    try { computeAutoPoints(db, month); } catch (e) { console.error("[积分引擎] 计算失败", e); }
  }

  const [y, m] = month.split("-");
  const monthStart = `${month}-01`;
  const lastDay = new Date(+y, +m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  // 排名榜
  let rankSql = `
    SELECT employee_name as name,
           COALESCE(SUM(points), 0) as total_points,
           COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 0 END), 0) as bonus,
           COALESCE(SUM(CASE WHEN points < 0 THEN points ELSE 0 END), 0) as penalty
    FROM points_records WHERE 1=1
  `;
  const rankParams: any[] = [];

  if (!isAdmin && auth.name) {
    rankSql += " AND employee_name = ?";
    rankParams.push(auth.name);
  }
  rankSql += " GROUP BY employee_name ORDER BY total_points DESC";
  const rankData = db.prepare(rankSql).all(...rankParams);

  // 记录列表
  let recSql = "SELECT * FROM points_records WHERE 1=1";
  const recParams: any[] = [];

  if (employee) {
    recSql += " AND employee_name = ?";
    recParams.push(employee);
  } else if (!isAdmin && auth.name) {
    recSql += " AND employee_name = ?";
    recParams.push(auth.name);
  }
  recSql += " ORDER BY created_at DESC LIMIT 200";
  const records = db.prepare(recSql).all(...recParams);

  const employees = isAdmin
    ? db.prepare("SELECT name FROM employees WHERE role = 'employee' ORDER BY name").all()
    : [];

  return NextResponse.json({ rankings: rankData, records, month, employees });
}

// ── POST: 老板手动奖惩 ──
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const body = await req.json();
  const { employee_name, points, reason } = body;
  if (!employee_name || !points || !reason) {
    return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, is_manual, created_by) VALUES (?, ?, ?, 'manual', 1, ?)"
  ).run(employee_name, Number(points), reason, auth.name || "");

  return NextResponse.json({ success: true });
}

// ── PATCH: 删除积分记录 ──
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  const body = await req.json();
  getDb().prepare("DELETE FROM points_records WHERE id = ? AND is_manual = 1").run(body.id);
  return NextResponse.json({ success: true });
}

// ── 自动积分引擎 ──
function computeAutoPoints(db: any, month: string) {
  const [y, m] = month.split("-");
  const monthStart = `${month}-01`;
  const lastDay = new Date(+y, +m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;

  // 删除本月已有自动积分
  db.prepare(
    "DELETE FROM points_records WHERE is_manual = 0 AND rule_key != '' AND created_at >= ? AND created_at <= ?"
  ).run(monthStart, monthEnd + " 23:59:59");

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];

  // 工作日 (Mon-Sat)
  let workDays = 0;
  const startDate = new Date(+y, +m - 1, 1);
  const endDate = new Date(+y, +m - 1, lastDay);
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) workDays++;
  }

  const now = new Date().toISOString().slice(0, 10);

  const insertAuto = db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key) VALUES (?, ?, ?, ?)"
  );

  for (const emp of employees) {
    const en = emp.name;

    // 1. 迟到 (check_in 是 datetime，提取时间部分比较)
    const lateCount = (db.prepare(`
      SELECT COUNT(*) as c FROM attendance 
      WHERE employee_name = ? AND date >= ? AND date <= ? 
      AND type != '请假' AND check_in != '' AND substr(check_in, 12, 8) > '09:00:00'
    `).get(en, monthStart, monthEnd) as { c: number }).c;

    if (lateCount > 0) {
      insertAuto.run(en, lateCount * -3, `${month} 迟到${lateCount}次，扣${lateCount * 3}分`, "late");
    }

    // 2. 出勤天数
    const attendedDays = (db.prepare(
      "SELECT COUNT(DISTINCT date) as c FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).get(en, monthStart, monthEnd) as { c: number }).c;

    // 请假天数
    const leaveRows = db.prepare(
      "SELECT start_date, end_date FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND end_date >= ? AND start_date <= ?"
    ).all(en, monthStart, monthEnd) as { start_date: string; end_date: string }[];

    let leaveDays = 0;
    for (const lr of leaveRows) {
      const ls = new Date(Math.max(new Date(lr.start_date).getTime(), startDate.getTime()));
      const le = new Date(Math.min(new Date(lr.end_date).getTime(), endDate.getTime()));
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0) leaveDays++;
      }
    }

    const absentDays = Math.max(0, workDays - attendedDays - leaveDays);
    if (absentDays > 0) {
      insertAuto.run(en, absentDays * -10, `${month} 缺勤${absentDays}天，扣${absentDays * 10}分`, "absent");
    }

    // 3. 请假扣分
    if (leaveDays > 0) {
      insertAuto.run(en, leaveDays * -1, `${month} 请假${leaveDays}天，扣${leaveDays}分`, "leave");
    }

    // 4. 全勤奖励
    if (lateCount === 0 && absentDays === 0) {
      insertAuto.run(en, 5, `${month} 全勤奖励 +5分`, "full_attendance");
    }

    // 5. 步骤逾期
    const overdueSteps = (db.prepare(`
      SELECT COUNT(*) as c FROM order_steps 
      WHERE assignee = ? AND deadline != '' AND deadline < ? AND status NOT IN ('已完成','已停止')
    `).get(en, now) as { c: number }).c;
    if (overdueSteps > 0) {
      insertAuto.run(en, overdueSteps * -5, `${month} 订单步骤逾期${overdueSteps}个，扣${overdueSteps * 5}分`, "step_overdue");
    }

    // 6. 步骤提前完成
    const earlySteps = (db.prepare(`
      SELECT COUNT(*) as c FROM order_steps 
      WHERE assignee = ? AND completed_at >= ? AND completed_at <= ? 
      AND status = '已完成' AND deadline != '' AND completed_at < deadline
    `).get(en, monthStart, monthEnd + " 23:59:59") as { c: number }).c;
    if (earlySteps > 0) {
      insertAuto.run(en, earlySteps * 2, `提前完成步骤${earlySteps}个，加${earlySteps * 2}分`, "step_early");
    }

    // 7. 工单超时
    const overdueIssues = (db.prepare(`
      SELECT COUNT(*) as c FROM issue_tickets 
      WHERE assignee = ? AND status != '已解决' AND created_at < datetime('now', '-2 days')
    `).get(en) as { c: number }).c;
    if (overdueIssues > 0) {
      insertAuto.run(en, overdueIssues * -3, `工单超时${overdueIssues}个，扣${overdueIssues * 3}分`, "issue_overdue");
    }

    // 8. 工单解决
    const resolvedIssues = (db.prepare(
      "SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status = '已解决'"
    ).get(en) as { c: number }).c;
    if (resolvedIssues > 0) {
      insertAuto.run(en, resolvedIssues * 3, `解决工单${resolvedIssues}个，加${resolvedIssues * 3}分`, "issue_resolved");
    }

    // 9. A级评估
    const aGrade = (db.prepare(
      "SELECT COUNT(*) as c FROM influencer_evaluations WHERE evaluated_by = ? AND final_rating = 'A'"
    ).get(en) as { c: number }).c;
    if (aGrade > 0) {
      insertAuto.run(en, aGrade * 5, `A级达人评估${aGrade}个，加${aGrade * 5}分`, "influencer_a_grade");
    }
  }
}
