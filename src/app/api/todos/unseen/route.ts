import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/todos/unseen — 当前用户未看过的待办（新增/新跟进）+ 数量（侧栏角标 & 页面信息箱）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

  const items = rows
    .filter((r) => r.seen_at < r.created_at || (!!r.latest_follow_at && r.latest_follow_at > r.seen_at))
    .map((r) => ({
      id: r.id,
      content: r.content,
      type: r.seen_at < r.created_at ? "新增" : "新跟进",
      created_at: r.created_at,
    }));

  return NextResponse.json({ count: items.length, items });
}
