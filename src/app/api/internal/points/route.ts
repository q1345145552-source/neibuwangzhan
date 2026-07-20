import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { bangkokMonthKey, bangkokLastDayOfMonth, bangkokDayOfWeek, bangkokToday } from "@/lib/time";

// ── GET: 积分引擎 + 排名榜 + 记录 + 申诉 + 互评 + 季度 ──
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const employee = req.nextUrl.searchParams.get("employee") || "";
  const month = req.nextUrl.searchParams.get("month") || bangkokMonthKey();
  const doRefresh = req.nextUrl.searchParams.get("refresh") === "1";
  const quarter = req.nextUrl.searchParams.get("quarter") || "";

  // 季度模式
  let dateFrom: string, dateTo: string;
  if (quarter) {
    const [qy, qq] = quarter.split("-Q");
    const q = parseInt(qq);
    const qStart = (q - 1) * 3;
    const qEnd = qStart + 2;
    dateFrom = `${qy}-${String(qStart + 1).padStart(2, "0")}-01`;
    const lastDay = bangkokLastDayOfMonth(+qy, qEnd + 1);
    dateTo = `${qy}-${String(qEnd + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")} 23:59:59`;
  } else {
    const [y, m] = month.split("-");
    dateFrom = `${month}-01`;
    const lastDay = bangkokLastDayOfMonth(+y, +m);
    dateTo = `${month}-${String(lastDay).padStart(2, "0")} 23:59:59`;
  }

  if (doRefresh) {
    try { computeAutoPoints(db, month); } catch (e) { console.error("[积分引擎] 失败", e); }
  }

  // 排名榜（按时间范围，排除已撤销）
  const rankSql = `
    SELECT employee_name as name,
           COALESCE(SUM(CASE WHEN status != '已撤销' THEN points ELSE 0 END), 0) as total_points,
           COALESCE(SUM(CASE WHEN status != '已撤销' AND points > 0 THEN points ELSE 0 END), 0) as bonus,
           COALESCE(SUM(CASE WHEN status != '已撤销' AND points < 0 THEN points ELSE 0 END), 0) as penalty
    FROM points_records
    WHERE created_at >= ? AND created_at <= ?
      ${!isAdmin && auth.name ? "AND employee_name = ?" : ""}
    GROUP BY employee_name ORDER BY total_points DESC
  `;
  const rp: any[] = [dateFrom, dateTo];
  if (!isAdmin && auth.name) rp.push(auth.name);
  const rankData = db.prepare(rankSql).all(...rp);

  // 记录列表
  let recSql = "SELECT * FROM points_records WHERE created_at >= ? AND created_at <= ?";
  const recp: any[] = [dateFrom, dateTo];
  if (employee) { recSql += " AND employee_name = ?"; recp.push(employee); }
  else if (!isAdmin && auth.name) { recSql += " AND employee_name = ?"; recp.push(auth.name); }
  recSql += " ORDER BY created_at DESC LIMIT 200";
  const records = db.prepare(recSql).all(...recp);

  // 申诉列表
  let appeals: any[] = [];
  if (isAdmin) {
    appeals = db.prepare("SELECT * FROM points_records WHERE is_appealed = 1 AND appeal_status = '申诉中' ORDER BY created_at DESC").all();
  }

  // 互评数据
  let peerVotes: any[] = [];
  if (isAdmin) {
    peerVotes = db.prepare(
      "SELECT * FROM peer_votes WHERE month = ? ORDER BY created_at DESC"
    ).all(month);
  } else if (auth.name) {
    // 员工端只返回收到的赞，且隐藏投票人
    const raw = db.prepare(
      "SELECT id, nominee, reason, month, created_at FROM peer_votes WHERE nominee = ? AND month = ? ORDER BY created_at DESC"
    ).all(auth.name, month) as any[];
    peerVotes = raw.map((r: any) => ({ ...r, voter: "同事", anonymous: true }));
  }

  // 客户反馈
  const clientFeedback = db.prepare(
    "SELECT * FROM client_feedback ORDER BY created_at DESC LIMIT 50"
  ).all();

  // 季度列表（2026年）
  const quarters = [{ label: "2026-Q1", value: "2026-Q1" }, { label: "2026-Q2", value: "2026-Q2" }, { label: "2026-Q3", value: "2026-Q3" }, { label: "2026-Q4", value: "2026-Q4" }];

  const employees = isAdmin
    ? db.prepare("SELECT name FROM employees WHERE role = 'employee' ORDER BY name").all()
    : [];

  // 销售积分排行（仅来自 customer_* 规则）
  const salesRankSql = `
    SELECT employee_name as name,
           COALESCE(SUM(CASE WHEN status != '已撤销' THEN points ELSE 0 END), 0) as total_points
    FROM points_records
    WHERE rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal')
      AND created_at >= ? AND created_at <= ?
      AND points > 0
    GROUP BY employee_name ORDER BY total_points DESC
  `;
  const salesRanking = db.prepare(salesRankSql).all(dateFrom, dateTo);

  // 季度销售详细排行
  let quarterlySales: any[] = [];
  if (quarter) {
    quarterlySales = db.prepare(`
      SELECT employee_name as name,
        COALESCE(SUM(CASE WHEN status != '已撤销' THEN points ELSE 0 END), 0) as total_points,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_followup' AND status != '已撤销' THEN points/2 ELSE 0 END), 0) as followup_count,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_claim' AND status != '已撤销' THEN points/5 ELSE 0 END), 0) as claim_count,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_activate' AND status != '已撤销' THEN points/8 ELSE 0 END), 0) as activate_count,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_deal' AND status != '已撤销' THEN points/10 ELSE 0 END), 0) as deal_count
      FROM points_records
      WHERE rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal')
        AND created_at >= ? AND created_at <= ?
        AND points > 0
      GROUP BY employee_name ORDER BY total_points DESC
    `).all(dateFrom, dateTo);
  }

  return NextResponse.json({
    rankings: rankData, records, month, employees, appeals,
    peerVotes, clientFeedback, quarters, salesRanking, quarterlySales,
    quarter: quarter || null
  });
}

// ── POST: 手动奖惩 / 互评点赞 ──
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const db = getDb();

  // 互评点赞
  if (body.action === "peer_vote") {
    const { nominee, reason } = body;
    const voter = auth.name || "";
    const month = bangkokMonthKey();

    if (voter === nominee) return NextResponse.json({ error: "不能给自己投票" }, { status: 400 });

    if (!reason || !reason.trim()) return NextResponse.json({ error: "请填写点赞理由" }, { status: 400 });
    db.prepare("INSERT INTO peer_votes (voter, nominee, reason, month) VALUES (?, ?, ?, ?)").run(voter, nominee, reason.trim(), month);
    db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, status) VALUES (?, 2, ?, 'peer_vote', '有效')").run(nominee, `${voter} 点赞: ${reason.trim()}`);

    return NextResponse.json({ success: true });
  }

  // 手动奖惩（管理员）
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
  const { employee_name, points, reason } = body;
  if (!employee_name || !points || !reason) return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });

  db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, is_manual, created_by) VALUES (?, ?, ?, 'manual', 1, ?)").run(employee_name, Number(points), reason, auth.name || "");
  return NextResponse.json({ success: true });
}

// ── PATCH: 撤销 / 恢复 / 申诉 / 客户反馈 ──
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const body = await req.json();
  const db = getDb();

  // 管理员撤销积分记录
  if (body.action === "undo" && auth.role === "admin") {
    const record = db.prepare("SELECT * FROM points_records WHERE id = ? AND status != '已撤销'").get(body.id);
    if (!record) return NextResponse.json({ error: "记录不存在或已撤销" }, { status: 404 });
    db.prepare("UPDATE points_records SET status = '已撤销', undone_by = ?, undone_at = datetime('now') WHERE id = ?").run(auth.name || "", body.id);
    return NextResponse.json({ success: true });
  }
  // 管理员恢复已撤销的记录
  if (body.action === "restore" && auth.role === "admin") {
    const record = db.prepare("SELECT * FROM points_records WHERE id = ? AND status = '已撤销'").get(body.id);
    if (!record) return NextResponse.json({ error: "记录不存在或未被撤销" }, { status: 404 });
    db.prepare("UPDATE points_records SET status = '有效', undone_by = '', undone_at = '' WHERE id = ?").run(body.id);
    return NextResponse.json({ success: true });
  }
  if (body.action === "appeal") {
    db.prepare("UPDATE points_records SET is_appealed = 1, appeal_reason = ?, appeal_status = '申诉中' WHERE id = ? AND employee_name = ?").run(body.reason || "", body.id, auth.name || "");
    return NextResponse.json({ success: true });
  }
  if (body.action === "approve_appeal" && auth.role === "admin") {
    db.prepare("UPDATE points_records SET appeal_status = '已通过', status = '已撤销' WHERE id = ?").run(body.id);
    return NextResponse.json({ success: true });
  }
  if (body.action === "reject_appeal" && auth.role === "admin") {
    db.prepare("UPDATE points_records SET appeal_status = '已驳回', is_appealed = 0 WHERE id = ?").run(body.id);
    return NextResponse.json({ success: true });
  }

  
  // Admin: export sales summary
  if (body.action === "export_sales") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });
    const month = body.month || bangkokMonthKey();
    const [y, m] = month.split("-");
    const dateFrom = `${month}-01`;
    const lastDay = bangkokLastDayOfMonth(+y, +m);
    const dateTo = `${month}-${String(lastDay).padStart(2, "0")} 23:59:59`;

    const rows = db.prepare(`
      SELECT employee_name as name,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_followup' AND status != '已撤销' THEN points ELSE 0 END), 0) as followup_points,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_claim' AND status != '已撤销' THEN points ELSE 0 END), 0) as claim_points,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_activate' AND status != '已撤销' THEN points ELSE 0 END), 0) as activate_points,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_upgrade' AND status != '已撤销' THEN points ELSE 0 END), 0) as upgrade_points,
        COALESCE(SUM(CASE WHEN rule_key = 'customer_deal' AND status != '已撤销' THEN points ELSE 0 END), 0) as deal_points,
        COALESCE(SUM(CASE WHEN rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal') AND status != '已撤销' THEN points ELSE 0 END), 0) as total_sales
      FROM points_records
      WHERE rule_key IN ('customer_followup','customer_claim','customer_activate','customer_upgrade','customer_deal')
        AND created_at >= ? AND created_at <= ?
        AND points > 0
      GROUP BY employee_name HAVING total_sales > 0 ORDER BY total_sales DESC
    `).all(dateFrom, dateTo);

    return NextResponse.json({ month, rows });
  }
return NextResponse.json({ error: "未知操作" }, { status: 400 });
}

// ── 自动积分引擎 ──
function computeAutoPoints(db: any, month: string) {
  const [y, m] = month.split("-");
  const monthStart = `${month}-01`;
  const lastDay = new Date(+y, +m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const ym = +y, mm = +m - 1;

  db.prepare("DELETE FROM points_records WHERE is_manual = 0 AND rule_key != '' AND is_appealed = 0 AND created_at >= ? AND created_at <= ?").run(monthStart, monthEnd + " 23:59:59");

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];
  const startDate = new Date(ym, mm, 1);
  const endDate = new Date(ym, mm, lastDay);
  let workDays = 0;
  for (let d2 = 1; d2 <= lastDay; d2++) { const ds = `${ym}-${String(mm).padStart(2,"0")}-${String(d2).padStart(2,"0")}`; if (bangkokDayOfWeek(ds) !== 0) workDays++; }

  const now = bangkokToday();
  const insertAuto = db.prepare("INSERT INTO points_records (employee_name, points, reason, rule_key, status) VALUES (?, ?, ?, ?, '有效')");

  for (const emp of employees) {
    const en = emp.name;
    const lateCount = (db.prepare(`SELECT COUNT(*) as c FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ? AND type != '请假' AND check_in != '' AND substr(check_in, 12, 8) > '09:00:00'`).get(en, monthStart, monthEnd) as { c: number }).c;
    if (lateCount > 0) insertAuto.run(en, lateCount * -3, `${month} 迟到${lateCount}次，扣${lateCount * 3}分`, "late");

    const attendedDays = (db.prepare("SELECT COUNT(DISTINCT date) as c FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?").get(en, monthStart, monthEnd) as { c: number }).c;
    const leaveRows = db.prepare("SELECT start_date, end_date FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND end_date >= ? AND start_date <= ?").all(en, monthStart, monthEnd) as { start_date: string; end_date: string }[];
    let leaveDays = 0;
    for (const lr of leaveRows) {
      const ls = new Date(Math.max(new Date(lr.start_date).getTime(), startDate.getTime()));
      const le = new Date(Math.min(new Date(lr.end_date).getTime(), endDate.getTime()));
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0) leaveDays++; }
    }
    const absentDays = Math.max(0, workDays - attendedDays - leaveDays);
    if (absentDays > 0) insertAuto.run(en, absentDays * -10, `${month} 缺勤${absentDays}天，扣${absentDays * 10}分`, "absent");
    if (leaveDays > 0) insertAuto.run(en, leaveDays * -1, `${month} 请假${leaveDays}天，扣${leaveDays}分`, "leave");
    if (lateCount === 0 && absentDays === 0) insertAuto.run(en, 5, `${month} 全勤奖励 +5分`, "full_attendance");

    // 连续打卡奖励
    const allAttDays = db.prepare(`SELECT date, coalesce(substr(check_in,12,8),'') as ci FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ? AND type != '请假' ORDER BY date`).all(en, monthStart, monthEnd) as { date: string; ci: string }[];
    let consecWeekBonus = 0, currentStreak = 0, prevDate: Date | null = null;
    for (const row of allAttDays) {
      const d = new Date(row.date + "T00:00:00");
      const isOnTime = row.ci === "" || row.ci <= "09:00:00";
      if (!prevDate) { currentStreak = isOnTime ? 1 : 0; }
      else {
        const diff = Math.round((d.getTime() - prevDate.getTime()) / 86400000);
        const expectedDiff = prevDate.getDay() === 6 ? 2 : 1;
        currentStreak = (diff === expectedDiff && isOnTime) ? currentStreak + 1 : (isOnTime ? 1 : 0);
      }
      if (currentStreak >= 6) { consecWeekBonus += 3; currentStreak = 0; }
      prevDate = d;
    }
    if (consecWeekBonus > 0) insertAuto.run(en, consecWeekBonus, `${month} 连续整周正常打卡 ${Math.floor(consecWeekBonus/3)} 周，加${consecWeekBonus}分`, "consec_week");
    if (lateCount === 0 && absentDays === 0 && leaveDays === 0) insertAuto.run(en, 10, `${month} 连续整月正常打卡 +10分`, "consec_month");

    // 救回机制
    const lateRecs = db.prepare("SELECT id, date, points FROM points_records WHERE employee_name = ? AND rule_key = 'late' AND status = '有效'").all(en) as { id: number; date: string; points: number }[];
    for (const lr of lateRecs) {
      const lateDate = new Date(lr.date + "T00:00:00");
      const dow = lateDate.getDay();
      const weekStart = new Date(lateDate); weekStart.setDate(lateDate.getDate() - (dow === 0 ? 6 : dow - 1));
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 5);
      const afterLate = new Date(Math.max(lateDate.getTime() + 86400000, weekStart.getTime()));
      let allOk = true, checkedDays = 0;
      for (let d = new Date(afterLate); d <= weekEnd; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue; checkedDays++;
        const dr = db.prepare("SELECT check_in FROM attendance WHERE employee_name = ? AND date = ? AND type != '请假'").get(en, d.toISOString().slice(0,10)) as { check_in: string } | undefined;
        if (!dr || (dr.check_in && dr.check_in.slice(11,19) > "09:00:00")) { allOk = false; break; }
      }
      if (allOk && checkedDays > 0) {
        const rec = Math.ceil(Math.abs(lr.points) / 2);
        db.prepare("UPDATE points_records SET status = '已救回' WHERE id = ?").run(lr.id);
        insertAuto.run(en, rec, `${month} 迟到后当周全勤，救回${rec}分`, "recovery");
      }
    }

    // 步骤逾期/提前
    const od = (db.prepare(`SELECT COUNT(*) as c FROM order_steps WHERE assignee = ? AND deadline != '' AND deadline < ? AND status NOT IN ('已完成','已停止')`).get(en, now) as { c: number }).c;
    if (od > 0) insertAuto.run(en, od * -5, `订单步骤逾期${od}个，扣${od * 5}分`, "step_overdue");
    const es = (db.prepare(`SELECT COUNT(*) as c FROM order_steps WHERE assignee = ? AND completed_at >= ? AND completed_at <= ? AND status = '已完成' AND deadline != '' AND completed_at < deadline`).get(en, monthStart, monthEnd + " 23:59:59") as { c: number }).c;
    if (es > 0) insertAuto.run(en, es * 2, `提前完成步骤${es}个，加${es * 2}分`, "step_early");

    // 工单
    const oi = (db.prepare(`SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status != '已解决' AND created_at < datetime('now', '-2 days')`).get(en) as { c: number }).c;
    if (oi > 0) insertAuto.run(en, oi * -3, `工单超时${oi}个，扣${oi * 3}分`, "issue_overdue");
    const ri = (db.prepare("SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status = '已解决'").get(en) as { c: number }).c;
    if (ri > 0) insertAuto.run(en, ri * 3, `解决工单${ri}个，加${ri * 3}分`, "issue_resolved");

    // A级评估
    const ag = (db.prepare("SELECT COUNT(*) as c FROM influencer_evaluations WHERE evaluated_by = ? AND final_rating = 'A'").get(en) as { c: number }).c;
    if (ag > 0) insertAuto.run(en, ag * 5, `A级达人评估${ag}个，加${ag * 5}分`, "influencer_a_grade");
  }

  // 互评点赞积分（已由 POST 实时写入，这里只做已有记录的核查）
  // 客户反馈积分（已由 POST 实时写入，这里不重复处理）
}
