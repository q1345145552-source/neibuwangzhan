import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/search?q=关键词 — 搜索我参与的一对一和群聊历史消息（文字/订单客户名），不含已撤回
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });

  const db = getDb();
  const me = auth.name;
  const rows = db.prepare(`
    SELECT m.id, m.sender, m.content, m.created_at, m.group_id,
      c.user_a, c.user_b, g.name AS group_name
    FROM messages m
    LEFT JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN chat_groups g ON g.id = m.group_id
    WHERE m.recalled = 0 AND m.content LIKE ?
      AND (
        (m.conversation_id IS NOT NULL AND (c.user_a = ? OR c.user_b = ?))
        OR (m.group_id IS NOT NULL AND EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = m.group_id AND gm.member = ?))
      )
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all(`%${q}%`, me, me, me) as {
    id: number;
    sender: string;
    content: string;
    created_at: string;
    group_id: number | null;
    user_a: string | null;
    user_b: string | null;
    group_name: string | null;
  }[];

  const results = rows.map((r) => {
    if (r.group_id != null) {
      return {
        id: r.id,
        kind: "group" as const,
        title: r.group_name || "群聊",
        target_id: String(r.group_id),
        sender: r.sender,
        content: r.content,
        created_at: r.created_at,
      };
    }
    const other = (r.user_a === me ? r.user_b : r.user_a) || "";
    return {
      id: r.id,
      kind: "direct" as const,
      title: other || "会话",
      target_id: other,
      sender: r.sender,
      content: r.content,
      created_at: r.created_at,
    };
  });

  return NextResponse.json({ results });
}
