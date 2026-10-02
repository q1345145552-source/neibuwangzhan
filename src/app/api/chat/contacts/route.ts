import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/contacts — 可聊天的在职员工（不含自己），带最后一条消息预览和未读数，按最新消息倒序
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const me = auth.name;
  const rows = db.prepare(`
    SELECT e.name, e.role,
      c.last_message_at AS last_at,
      c.last_message_preview AS last_preview,
      (SELECT m.sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.receiver = ? AND m.is_read = 0) AS unread
    FROM employees e
    LEFT JOIN conversations c ON (c.user_a = e.name AND c.user_b = ?) OR (c.user_b = e.name AND c.user_a = ?)
    WHERE e.status = '在职' AND e.role IN ('admin','employee') AND e.name != ?
    ORDER BY COALESCE(c.last_message_at, '') DESC, e.name ASC
  `).all(me, me, me, me) as {
    name: string;
    role: string;
    last_at: string;
    last_preview: string;
    last_sender: string | null;
    unread: number;
  }[];

  return NextResponse.json(rows.map((r) => ({
    name: r.name,
    role: r.role,
    last_at: r.last_at || null,
    last_preview: r.last_preview || null,
    last_sender: r.last_sender || null,
    unread: r.unread || 0,
  })));
}
