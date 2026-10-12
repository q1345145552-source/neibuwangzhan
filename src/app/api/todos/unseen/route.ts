import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/todos/unseen — 当前用户未看过的待办（新增/新跟进）+ 数量（侧栏角标 & 页面信息箱）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(`
    SELECT t.id, t.content, t.created_at, t.seen_at,
      (SELECT MAX(f.created_at) FROM todo_follow_ups f WHERE f.todo_id = t.id) AS latest_follow_at
    FROM todos t
    WHERE t.assignee = ? AND t.status = '未完成'
    ORDER BY t.created_at DESC, t.id DESC
  `).all(auth.name) as {
    id: number;
    content: string;
    created_at: string;
    seen_at: string;
    latest_follow_at: string | null;
  }[];

  // 时间字符串转时间戳：兼容老格式（空格分隔）+ 新格式（ISO），非法返回 0
  function toTs(s: string | null): number {
    if (!s) return 0;
    const str = s.includes("Z") || s.includes("+") || (s.match(/-/g) || []).length > 2 ? s : s.replace(" ", "T") + "Z";
    const t = new Date(str).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  const items = rows
    .filter((r) => toTs(r.seen_at) < toTs(r.created_at) || (!!r.latest_follow_at && toTs(r.latest_follow_at) > toTs(r.seen_at)))
    .map((r) => ({
      id: r.id,
      content: r.content,
      type: toTs(r.seen_at) < toTs(r.created_at) ? "新增" : "新跟进",
      created_at: r.created_at,
    }));

  return NextResponse.json({ count: items.length, items });
}
