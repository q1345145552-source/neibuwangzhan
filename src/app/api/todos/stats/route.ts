import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { bangkokDayRange, bangkokWeekRange, bangkokMonthRange, bangkokToday } from "@/lib/time";

// GET /api/todos/stats — 待办看板统计（仅管理员/老板可见）
// 返回：未完成总数（当前），今天/本周/本月三个时间范围内的新增/完成/跟进数，
// 以及每个员工的四列维度数据（未完成数 + 该时间范围的新增/完成/跟进数）。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const db = getDb();

  // 未完成：当前所有未完成待办总数（不随时间范围变化）
  const unfinished = (db.prepare("SELECT COUNT(*) AS c FROM todos WHERE status = '未完成'").get() as { c: number }).c;

  // 今天 / 本周 / 本月 的 UTC 半开区间 [start, end)
  const today = bangkokToday();
  const [y, m] = today.split("-").map(Number);
  const ranges = {
    today: bangkokDayRange(today),
    week: bangkokWeekRange(),
    month: bangkokMonthRange(y, m),
  };

  const countBetween = (table: string, col: string, range: { start: string; end: string }) => {
    const row = db.prepare(
      `SELECT COUNT(*) AS c FROM ${table} WHERE ${col} >= ? AND ${col} < ?`
    ).get(range.start, range.end) as { c: number };
    return row.c;
  };

  const statsFor = (range: { start: string; end: string }) => ({
    created: countBetween("todos", "created_at", range),
    completed: countBetween("todos", "completed_at", range),
    followups: countBetween("todo_follow_ups", "created_at", range),
  });

  // ── 员工维度表 ──
  // 在职员工（排除客户）+ 待办里出现过且非空的负责人，合并去重
  const nameSet = new Set<string>();
  (db.prepare("SELECT name FROM employees WHERE role != 'client' AND status != '离职'").all() as { name: string }[])
    .forEach((r) => nameSet.add(r.name));
  (db.prepare("SELECT DISTINCT assignee AS name FROM todos WHERE assignee != ''").all() as { name: string }[])
    .forEach((r) => nameSet.add(r.name));

  // 每员工当前未完成数（不随时间变）
  const unfinishedBy = new Map<string, number>();
  (db.prepare("SELECT assignee, COUNT(*) AS c FROM todos WHERE status = '未完成' AND assignee != '' GROUP BY assignee").all() as { assignee: string; c: number }[])
    .forEach((r) => unfinishedBy.set(r.assignee, r.c));

  const employees = [...nameSet].map((name) => {
    const row: Record<string, any> = { name, unfinished: unfinishedBy.get(name) || 0 };
    for (const [key, range] of Object.entries(ranges)) {
      row[key] = {
        created: (db.prepare("SELECT COUNT(*) AS c FROM todos WHERE assignee = ? AND created_at >= ? AND created_at < ?").get(name, range.start, range.end) as { c: number }).c,
        completed: (db.prepare("SELECT COUNT(*) AS c FROM todos WHERE assignee = ? AND completed_at >= ? AND completed_at < ?").get(name, range.start, range.end) as { c: number }).c,
        followups: (db.prepare("SELECT COUNT(*) AS c FROM todo_follow_ups f JOIN todos t ON f.todo_id = t.id WHERE t.assignee = ? AND f.created_at >= ? AND f.created_at < ?").get(name, range.start, range.end) as { c: number }).c,
      };
    }
    // 每个员工的分类明细：未完成待办按分类统计数量
    row.categories = db.prepare(
      "SELECT COALESCE(tc.name, '未分类') AS name, COUNT(*) AS count FROM todos t LEFT JOIN todo_categories tc ON tc.id = t.category_id WHERE t.assignee = ? AND t.status = '未完成' GROUP BY name ORDER BY count DESC, name ASC"
    ).all(name) as { name: string; count: number }[];
    return row;
  });

  // 未完成数降序：谁手上待办最多排最前
  employees.sort((a, b) => (b.unfinished - a.unfinished) || String(a.name).localeCompare(String(b.name), "zh"));

  // ── 积压提醒：列出所有未完成待办，附创建时间 / 上次跟进时间 / 未完成时长 ──
  const backlogRows = db.prepare(
    `SELECT t.id, t.content, t.assignee, t.created_at,
            (SELECT f.created_at FROM todo_follow_ups f WHERE f.todo_id = t.id
             ORDER BY julianday(f.created_at) DESC, f.id DESC LIMIT 1) AS last_follow_at
     FROM todos t
     WHERE t.status = '未完成'
     ORDER BY t.created_at ASC`
  ).all() as { id: number; content: string; assignee: string; created_at: string; last_follow_at: string | null }[];

  const nowMs = Date.now();
  // 新建待办存 ISO UTC，历史记录/跟进存 SQLite UTC；已有时区时不能再次追加 Z。
  const toMs = (s: string | null | undefined): number | null => {
    if (!s?.trim()) return null;
    const normalized = s.trim().replace(" ", "T");
    const timestamp = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`);
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  const backlog = backlogRows.map((r) => {
    const createdMs = toMs(r.created_at) ?? nowMs;
    const followMs = toMs(r.last_follow_at);
    const createdAgoMs = Math.max(0, nowMs - createdMs);
    const followAgoMs = followMs != null ? Math.max(0, nowMs - followMs) : null;
    // 没跟进超 24 小时预警：有跟进记录看最近跟进时间，从没跟进过看创建时间
    const warn = (followAgoMs ?? createdAgoMs) > 24 * 3600 * 1000;
    return {
      id: r.id,
      content: r.content,
      assignee: r.assignee,
      created_at: r.created_at,
      last_follow_at: r.last_follow_at || null,
      createdAgoMs,
      followAgoMs,
      warn,
    };
  });

  // 预警置顶；其余按未完成时长从长到短
  backlog.sort((a, b) => (Number(b.warn) - Number(a.warn)) || (b.createdAgoMs - a.createdAgoMs));

  // ── 趋势对比：本周 vs 上周 的新增/完成数 ──
  const lastWeekDateStr = new Date(Date.now() + 7 * 3600 * 1000 - 7 * 86400000).toISOString().split("T")[0];
  const lastWeekRange = bangkokWeekRange(lastWeekDateStr);
  const trend = {
    created: { this: countBetween("todos", "created_at", ranges.week), last: countBetween("todos", "created_at", lastWeekRange) },
    completed: { this: countBetween("todos", "completed_at", ranges.week), last: countBetween("todos", "completed_at", lastWeekRange) },
  };

  return NextResponse.json({
    unfinished,
    today: statsFor(ranges.today),
    week: statsFor(ranges.week),
    month: statsFor(ranges.month),
    employees,
    backlog,
    trend,
  });
}
