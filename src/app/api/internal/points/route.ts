import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { bangkokMonthKey, bangkokMonthBounds, bangkokDayOfWeek, bangkokToday, bangkokLastDayOfMonth, bangkokTimeToUtc, utcNowStr } from "@/lib/time";

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

  // 统计区间：points_records.created_at 存的是 UTC，边界必须由曼谷日历换算成 UTC，
  // 否则曼谷 1 号 00:00–07:00 的积分会被算进上个月（月末同理会漏到下个月）
  let dateFrom: string, dateTo: string;
  if (quarter) {
    const [qy, qq] = quarter.split("-Q");
    const q = parseInt(qq);
    const qStartMonth = (q - 1) * 3 + 1;
    const qEndMonth = qStartMonth + 2;
    dateFrom = bangkokMonthBounds(+qy, qStartMonth).from;
    dateTo = bangkokMonthBounds(+qy, qEndMonth).to;
  } else {
    const [y, m] = month.split("-");
    const bounds = bangkokMonthBounds(+y, +m);
    dateFrom = bounds.from;
    dateTo = bounds.to;
  }

  // 整个重算包在事务里：中途失败会回滚，不会出现"自动积分已清空、但只补回一半"的状态
  let refreshError: string | null = null;
  if (doRefresh) {
    try {
      db.transaction(() => computeAutoPoints(db, month))();
    } catch (e) {
      refreshError = e instanceof Error ? e.message : String(e);
      console.error("[积分引擎] 重算失败，已回滚:", e);
    }
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
    quarter: quarter || null,
    // 重算失败不再静默：把错误带回前端，避免"看起来刷新成功、其实什么都没算"
    refreshError,
  });
}

// ── POST: 手动奖惩 / 互评点赞 ──
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await readJson(req);
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
  const body = await readJson(req);
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
    // 同上：按曼谷日历换算成 UTC 边界
    const { from: dateFrom, to: dateTo } = bangkokMonthBounds(+y, +m);

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
  const lastDay = bangkokLastDayOfMonth(+y, +m);
  const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
  const ym = +y, mm = +m - 1;

  // 按曼谷日历换算出的 UTC 区间，用于和 created_at（UTC）比较
  const { from: utcFrom, to: utcTo } = bangkokMonthBounds(+y, +m);

  db.prepare("DELETE FROM points_records WHERE is_manual = 0 AND rule_key != '' AND is_appealed = 0 AND created_at >= ? AND created_at <= ?").run(utcFrom, utcTo);

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];
  const startDate = new Date(ym, mm, 1);
  const endDate = new Date(ym, mm, lastDay);
  let workDays = 0;
  // 注意：这里要拼 1-based 月份的日期字符串。原来用的是 0-based 的 mm，
  // 导致 7 月算成 "2026-06-xx"（整月错一位），1 月更是拼出非法的 "2026-00-xx"
  // → bangkokDayOfWeek 返回 NaN、NaN !== 0 恒真、整月每天都算工作日 → 缺勤天数全错
  for (let d2 = 1; d2 <= lastDay; d2++) {
    const ds = `${ym}-${String(+m).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
    if (bangkokDayOfWeek(ds) !== 0) workDays++;
  }

  const now = bangkokToday();
  // 重算历史月份时，记录的 created_at 必须落在被重算的那个月里，
  // 否则（用默认的 datetime('now')）历史月份永远算不回来，还会污染当月排行
  const stampUtc = month === bangkokMonthKey() ? utcNowStr() : utcTo;
  const insertAuto = db.prepare(
    "INSERT INTO points_records (employee_name, points, reason, rule_key, status, created_at) VALUES (?, ?, ?, ?, '有效', ?)"
  );
  const addPoints = (name: string, pts: number, reason: string, rule: string) =>
    insertAuto.run(name, pts, reason, rule, stampUtc);

  for (const emp of employees) {
    const en = emp.name;
    // 迟到判定：正常打卡的 check_in 存 UTC，必须和「曼谷 09:00 对应的 UTC 时刻」比，
    // 直接拿 substr(check_in,12,8) 和 '09:00:00' 比等于要求曼谷下午 4 点后才算迟到（几乎永不触发）。
    // 补签记录存的是本地时间字符串，按本地 09:00 比。
    const monthAtt = db.prepare(
      "SELECT date, check_in, type FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ? AND type != '请假' ORDER BY date"
    ).all(en, monthStart, monthEnd) as { date: string; check_in: string; type: string }[];
    const isLate = (a: { date: string; check_in: string; type: string }) => {
      if (!a.check_in) return false;
      const threshold = a.type === "补签" ? `${a.date} 09:00:00` : bangkokTimeToUtc(a.date, "09:00");
      return a.check_in > threshold;
    };
    const lateDates = monthAtt.filter(isLate).map(a => a.date);
    const lateCount = lateDates.length;
    if (lateCount > 0) addPoints(en, lateCount * -3, `${month} 迟到${lateCount}次，扣${lateCount * 3}分`, "late");

    const attendedDays = (db.prepare("SELECT COUNT(DISTINCT date) as c FROM attendance WHERE employee_name = ? AND date >= ? AND date <= ?").get(en, monthStart, monthEnd) as { c: number }).c;
    const leaveRows = db.prepare("SELECT start_date, end_date FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND end_date >= ? AND start_date <= ?").all(en, monthStart, monthEnd) as { start_date: string; end_date: string }[];
    let leaveDays = 0;
    for (const lr of leaveRows) {
      const ls = new Date(Math.max(new Date(lr.start_date).getTime(), startDate.getTime()));
      const le = new Date(Math.min(new Date(lr.end_date).getTime(), endDate.getTime()));
      for (let d = new Date(ls); d <= le; d.setDate(d.getDate() + 1)) { if (d.getDay() !== 0) leaveDays++; }
    }
    const absentDays = Math.max(0, workDays - attendedDays - leaveDays);
    if (absentDays > 0) addPoints(en, absentDays * -10, `${month} 缺勤${absentDays}天，扣${absentDays * 10}分`, "absent");
    if (leaveDays > 0) addPoints(en, leaveDays * -1, `${month} 请假${leaveDays}天，扣${leaveDays}分`, "leave");
    if (lateCount === 0 && absentDays === 0) addPoints(en, 5, `${month} 全勤奖励 +5分`, "full_attendance");

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
    if (consecWeekBonus > 0) addPoints(en, consecWeekBonus, `${month} 连续整周正常打卡 ${Math.floor(consecWeekBonus/3)} 周，加${consecWeekBonus}分`, "consec_week");
    if (lateCount === 0 && absentDays === 0 && leaveDays === 0) addPoints(en, 10, `${month} 连续整月正常打卡 +10分`, "consec_month");

    // 救回机制：迟到那天之后到本周六，若每个工作日都出勤且不迟到，救回一半扣分
    //
    // 原实现从 points_records 里 `SELECT id, date, points`，但该表**根本没有 date 列**
    // （只有 created_at），而且 'late' 是按月汇总成一条记录、本来也没有单日信息。
    // 结果：每次刷新积分都在这里抛 "no such column: date"，被 GET 里的 try/catch 静默吞掉，
    // 后面的「步骤逾期/提前」「工单」「A级评估」全部规则从来没被执行过，
    // 而前面的 DELETE 已经把当月自动积分清空了 —— 每刷新一次就留下半套数据。
    // 现在直接基于考勤数据按天判定，不再依赖不存在的字段。
    const attByDate = new Map(monthAtt.map(a => [a.date, a]));
    let recoveredDays = 0;
    for (const ld of lateDates) {
      const lateDate = new Date(ld + "T00:00:00Z");
      const dow = lateDate.getUTCDay();
      // 本周一 → 本周六（周日休息）
      const weekEnd = new Date(lateDate);
      weekEnd.setUTCDate(lateDate.getUTCDate() + (dow === 0 ? 0 : 6 - dow));
      let allOk = true, checkedDays = 0;
      for (let d = new Date(lateDate.getTime() + 86400000); d <= weekEnd; d = new Date(d.getTime() + 86400000)) {
        if (d.getUTCDay() === 0) continue;
        const ds = d.toISOString().slice(0, 10);
        if (ds > monthEnd) break; // 不跨月判定
        const rec = attByDate.get(ds);
        checkedDays++;
        if (!rec || isLate(rec)) { allOk = false; break; }
      }
      if (allOk && checkedDays > 0) recoveredDays++;
    }
    if (recoveredDays > 0) {
      const rec = recoveredDays * 2; // 单次迟到扣 3 分，救回一半（向上取整）= 2 分
      addPoints(en, rec, `${month} 迟到后当周全勤 ${recoveredDays} 次，救回${rec}分`, "recovery");
    }

    // 步骤逾期/提前
    const od = (db.prepare(`SELECT COUNT(*) as c FROM order_steps WHERE assignee = ? AND deadline != '' AND deadline < ? AND status NOT IN ('已完成','已停止')`).get(en, now) as { c: number }).c;
    if (od > 0) addPoints(en, od * -5, `订单步骤逾期${od}个，扣${od * 5}分`, "step_overdue");
    const es = (db.prepare(`SELECT COUNT(*) as c FROM order_steps WHERE assignee = ? AND completed_at >= ? AND completed_at <= ? AND status = '已完成' AND deadline != '' AND completed_at < deadline`).get(en, utcFrom, utcTo) as { c: number }).c;
    if (es > 0) addPoints(en, es * 2, `提前完成步骤${es}个，加${es * 2}分`, "step_early");

    // 工单
    // 这几条原来都没有月份范围，统计的是"有史以来"的总数：
    // 每个月都会把同一批已解决工单/A级评估重新加一遍分，越积越多。
    // 现在按被计算的那个月过滤（用曼谷日历换算出的 UTC 区间）。
    const oi = (db.prepare(
      `SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status != '已解决'
       AND created_at >= ? AND created_at <= ? AND created_at < datetime('now', '-2 days')`
    ).get(en, utcFrom, utcTo) as { c: number }).c;
    if (oi > 0) addPoints(en, oi * -3, `${month} 工单超时${oi}个，扣${oi * 3}分`, "issue_overdue");
    const ri = (db.prepare(
      "SELECT COUNT(*) as c FROM issue_tickets WHERE assignee = ? AND status = '已解决' AND resolved_at >= ? AND resolved_at <= ?"
    ).get(en, utcFrom, utcTo) as { c: number }).c;
    if (ri > 0) addPoints(en, ri * 3, `${month} 解决工单${ri}个，加${ri * 3}分`, "issue_resolved");

    // A级评估
    // LIKE 'A%' 而不是 = 'A'：直播占比≥50% 的 A 级会被打成 'A+'，
    // 用等号会把最好的那批全漏掉（改之前这条规则从来没发过分）
    const ag = (db.prepare(
      "SELECT COUNT(*) as c FROM influencer_evaluations WHERE evaluated_by = ? AND final_rating LIKE 'A%' AND created_at >= ? AND created_at <= ?"
    ).get(en, utcFrom, utcTo) as { c: number }).c;
    if (ag > 0) addPoints(en, ag * 5, `${month} A级达人评估${ag}个，加${ag * 5}分`, "influencer_a_grade");
  }

  // 互评点赞积分（已由 POST 实时写入，这里只做已有记录的核查）
  // 客户反馈积分（已由 POST 实时写入，这里不重复处理）
}
