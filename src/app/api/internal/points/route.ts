import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// ── GET: 积分引擎 + 排名榜 + 记录列表 + 申诉列表 ──
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
  const lastDay = new Date(+y, +m, 0).getDate();

  // 排名榜（只统计 status != '已撤销' 的记录）
  let rankSql = `
    SELECT employee_name as name,
           COALESCE(SUM(CASE WHEN status != '已撤销' THEN points ELSE 0 END), 0) as total_points,
           COALESCE(SUM(CASE WHEN status != '已撤销' AND points > 0 THEN points ELSE 0 END), 0) as bonus,
           COALESCE(SUM(CASE WHEN status != '已撤销' AND points < 0 THEN points ELSE 0 END), 0) as penalty
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

  // 申诉列表（管理员看所有待处理的申诉）
  let appeals: any[] = [];
  if (isAdmin) {
    appeals = db.prepare(
      "SELECT * FROM points_records WHERE is_appealed = 1 AND appeal_status = '申诉中' ORDER BY created_at DESC"
    ).all();
  }

  const employees = isAdmin
    ? db.prepare("SELECT name FROM employees WHERE role = 'employee' ORDER BY name").all()
    : [];

  return NextResponse.json({ rankings: rankData, records, month, employees, appeals });
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

  getDb().prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, is_manual, created_by) VALUES (?, ?, ?, 'manual', 1, ?)"
  ).run(employee_name, Number(points), reason, auth.name || "");

  return NextResponse.json({ success: true });
}

// ── PATCH: 删除记录 / 申诉提交 / 申诉审批 ──
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const db = getDb();

  // 删除（管理员）
  if (body.action === "delete") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    db.prepare("DELETE FROM points_records WHERE id = ? AND is_manual = 1").run(body.id);
    return NextResponse.json({ success: true });
  }

  // 申诉提交（员工）
  if (body.action === "appeal") {
    db.prepare(
      "UPDATE points_records SET is_appealed = 1, appeal_reason = ?, appeal_status = '申诉中' WHERE id = ? AND employee_name = ?"
    ).run(body.reason || "", body.id, auth.name || "");
    return NextResponse.json({ success: true });
  }

  // 申诉审批（管理员）
  if (body.action === "approve_appeal") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    // 通过：撤销扣分
    db.prepare(
      "UPDATE points_records SET appeal_status = '已通过', status = '已撤销' WHERE id = ?"
    ).run(body.id);
    return NextResponse.json({ success: true });
  }

  if (body.action === "reject_appeal") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    // 驳回：恢复原状态
    db.prepare(
      "UPDATE points_records SET appeal_status = '已驳回', is_appealed = 0 WHERE id = ?"
    ).run(body.id);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}

// ── 自动积分引擎 ──
function computeAutoPoints(db: any, month: string) {
  const [y, m] = month.split("-");
  const monthStart = `${month}-01`;
  const lastDay = new Date(+y, +m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const ym = +y;
  const mm = +m - 1;

  // 删除本月已有自动积分（保留申诉过的）
  db.prepare(
    "DELETE FROM points_records WHERE is_manual = 0 AND rule_key != '' AND is_appealed = 0 AND created_at >= ? AND created_at <= ?"
  ).run(monthStart, monthEnd + " 23:59:59");

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];
  const startDate = new Date(ym, mm, 1);
  const endDate = new Date(ym, mm, lastDay);

  // 工作日 (Mon-Sat)
  let workDays = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) workDays++;
  }

  const now = new Date().toISOString().slice(0, 10);

  const insertAuto = db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, status) VALUES (?, ?, ?, ?, '有效')"
  );

  for (const emp of employees) {
    const en = emp.name;

    // ── 1. 基础迟到 ──
    const lateCount = (db.prepare(`
      SELECT COUNT(*) as c FROM attendance 
      WHERE employee_name = ? AND date >= ? AND date <= ? 
      AND type != '请假' AND check_in != '' AND substr(check_in, 12, 8) > '09:00:00'
    `).get(en, monthStart, monthEnd) as { c: number }).c;

    if (lateCount > 0) {
      insertAuto.run(en, lateCount * -3, `${month} 迟到${lateCount}次，扣${lateCount * 3}分`, "late");
    }

    // ── 2. 出勤天数 + 缺勤 ──
    const attendedDays = (db.prepare(
      "SELECT COUNT(DISTINCT date) as c FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?"
    ).get(en, monthStart, monthEnd) as { c: number }).c;

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

    // ── 3. 请假扣分 ──
    if (leaveDays > 0) {
      insertAuto.run(en, leaveDays * -1, `${month} 请假${leaveDays}天，扣${leaveDays}分`, "leave");
    }

    // ── 4. 全勤奖励 ──
    if (lateCount === 0 && absentDays === 0) {
      insertAuto.run(en, 5, `${month} 全勤奖励 +5分`, "full_attendance");
    }

    // ── 5. 连续打卡奖励 ──
    const allAttDays = db.prepare(`
      SELECT date, coalesce(substr(check_in,12,8),'') as ci 
      FROM attendance 
      WHERE employee_name = ? AND date >= ? AND date <= ? AND type != '请假'
      ORDER BY date
    `).all(en, monthStart, monthEnd) as { date: string; ci: string }[];

    // 连续周奖励：每周 Mon-Sat 连续 6 天正常打卡
    let consecutiveWeekBonus = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    let prevDate: Date | null = null;

    for (const row of allAttDays) {
      const d = new Date(row.date + "T00:00:00");
      const isOnTime = row.ci === "" || row.ci <= "09:00:00";
      
      if (!prevDate) {
        currentStreak = isOnTime ? 1 : 0;
      } else {
        const diff = Math.round((d.getTime() - prevDate.getTime()) / 86400000);
        // 连续日期（跳过周日）
        const expectedDiff = prevDate.getDay() === 6 ? 2 : 1;
        if (diff === expectedDiff && isOnTime) {
          currentStreak++;
        } else {
          currentStreak = isOnTime ? 1 : 0;
        }
      }

      if (currentStreak >= 6) {
        consecutiveWeekBonus += 3;
        currentStreak = 0; // reset after rewarding to allow multiple week bonuses
      }
      maxStreak = Math.max(maxStreak, currentStreak);
      prevDate = d;
    }

    if (consecutiveWeekBonus > 0) {
      insertAuto.run(en, consecutiveWeekBonus, `${month} 连续整周正常打卡 ${Math.floor(consecutiveWeekBonus/3)} 周，加${consecutiveWeekBonus}分`, "consec_week");
    }

    // 连续月奖励：整月无迟到无缺勤
    if (lateCount === 0 && absentDays === 0 && leaveDays === 0) {
      insertAuto.run(en, 10, `${month} 连续整月正常打卡 +10分`, "consec_month");
    }

    // ── 6. 救回机制：迟到后当周剩余工作日全部正常打卡，退回一半扣分 ──
    const lateRecords = db.prepare(`
      SELECT id, date, points FROM points_records 
      WHERE employee_name = ? AND rule_key = 'late' AND status = '有效'
    `).all(en) as { id: number; date: string; points: number }[];

    for (const lr of lateRecords) {
      const lateDate = new Date(lr.date + "T00:00:00");
      // 找到这一周的起始（周一）和结束（周六）
      const dayOfWeek = lateDate.getDay();
      const daysToMonday = dayOfWeek === 0 ? 1 : -(dayOfWeek - 1);
      const weekStart = new Date(lateDate);
      weekStart.setDate(lateDate.getDate() + daysToMonday);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 5); // Saturday

      // 检查当周从迟到日之后到周六的所有工作日是否全部正常打卡
      const afterLate = new Date(Math.max(lateDate.getTime() + 86400000, weekStart.getTime()));
      let allOk = true;
      let checkedDays = 0;
      for (let d = new Date(afterLate); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue; // skip Sunday
        checkedDays++;
        const ds = d.toISOString().slice(0, 10);
        const dayRecord = db.prepare(
          "SELECT check_in FROM attendance WHERE employee_name = ? AND date = ? AND type != '请假'"
        ).get(en, ds) as { check_in: string } | undefined;
        if (!dayRecord || (dayRecord.check_in && dayRecord.check_in.slice(11, 19) > "09:00:00")) {
          allOk = false;
          break;
        }
      }

      if (allOk && checkedDays > 0) {
        const recovered = Math.ceil(Math.abs(lr.points) / 2);
        // 标记原记录为已救回
        db.prepare("UPDATE points_records SET status = '已救回' WHERE id = ?").run(lr.id);
        // 插入救回记录
        insertAuto.run(en, recovered, `${month} 迟到后当周全勤，救回${recovered}分`, "recovery");
      }
    }

    // ── 7. 步骤逾期/提前 ──
    const overdueSteps = (db.prepare(`
      SELECT COUNT(*) as c FROM order_steps 
      WHERE assignee = ? AND deadline != '' AND deadline < ? AND status NOT IN ('已完成','已停止')
    `).get(en, now) as { c: number }).c;
    if (overdueSteps > 0) {
      insertAuto.run(en, overdueSteps * -5, `订单步骤逾期${overdueSteps}个，扣${overdueSteps * 5}分`, "step_overdue");
    }

    const earlySteps = (db.prepare(`
      SELECT COUNT(*) as c FROM order_steps 
      WHERE assignee = ? AND completed_at >= ? AND completed_at <= ? 
      AND status = '已完成' AND deadline != '' AND completed_at < deadline
    `).get(en, monthStart, monthEnd + " 23:59:59") as { c: number }).c;
    if (earlySteps > 0) {
      insertAuto.run(en, earlySteps * 2, `提前完成步骤${earlySteps}个，加${earlySteps * 2}分`, "step_early");
    }

    // ── 8. 工单 ──
    const overdueIssues = (db.prepare(`
      SELECT COUNT(*) as c FROM issue_tickets 
      WHERE assignee = ? AND status != '已解决' AND created_at < datetime('now', '-2 days')
    `).get(en) as { c: number }).c;
    if (overdueIssues > 0) {
      insertAuto.run(en, overdueIssues * -3, `工单超时${overdueIssues}个，扣${overdueIssues * 3}分`, "issue_overdue");
    }

    const resolvedIssues = (db.prepare(
      "SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status = '已解决'"
    ).get(en) as { c: number }).c;
    if (resolvedIssues > 0) {
      insertAuto.run(en, resolvedIssues * 3, `解决工单${resolvedIssues}个，加${resolvedIssues * 3}分`, "issue_resolved");
    }

    // ── 9. A级评估 ──
    const aGrade = (db.prepare(
      "SELECT COUNT(*) as c FROM influencer_evaluations WHERE evaluated_by = ? AND final_rating = 'A'"
    ).get(en) as { c: number }).c;
    if (aGrade > 0) {
      insertAuto.run(en, aGrade * 5, `A级达人评估${aGrade}个，加${aGrade * 5}分`, "influencer_a_grade");
    }
  }
}
