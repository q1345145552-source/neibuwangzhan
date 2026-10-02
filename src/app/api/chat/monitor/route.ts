import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { SENSITIVE_WORDS } from "@/lib/sensitive-words";

// GET /api/chat/monitor — 聊天监控（仅管理员）
// ?conversation_id=X：查看该会话的完整聊天记录（管理员无需参与）
// ?from=&to=：时间范围（消息 created_at 落在范围内）
// ?employee=姓名：只看该员工参与的会话（不传显示全部）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const conversationId = Number(searchParams.get("conversation_id")) || 0;

  // 查看某个会话的完整聊天记录
  if (conversationId) {
    const conv = db.prepare("SELECT id, user_a, user_b FROM conversations WHERE id = ?").get(conversationId) as
      { id: number; user_a: string; user_b: string } | undefined;
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

    const messages = db.prepare(
      "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC"
    ).all(conversationId);
    return NextResponse.json({ conversation: conv, messages });
  }

  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const employee = (searchParams.get("employee") || "").trim();

  const timeJoin = from && to ? "AND m.created_at >= ? AND m.created_at <= ?" : "";
  const empWhere = employee ? "WHERE (c.user_a = ? OR c.user_b = ?)" : "";

  const sensitiveConds = SENSITIVE_WORDS.map(() => "m.content LIKE ?").join(" OR ");

  const params: unknown[] = [];
  // SELECT 里敏感词 LIKE 参数
  for (const w of SENSITIVE_WORDS) params.push(`%${w}%`);
  // JOIN 时间范围
  if (from && to) params.push(from, to);
  // WHERE 员工
  if (employee) params.push(employee, employee);

  // 看板：每个 1:1 会话在该时间段内的消息数 + 最后一条消息 id + 是否含敏感词
  const rows = db.prepare(`
    SELECT c.id, c.user_a, c.user_b,
      COUNT(m.id) AS message_count,
      MAX(m.id) AS last_id,
      MAX(CASE WHEN (${sensitiveConds}) THEN 1 ELSE 0 END) AS has_sensitive
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id AND m.recalled = 0 ${timeJoin}
    ${empWhere}
    GROUP BY c.id
    HAVING COUNT(m.id) > 0
    ORDER BY MAX(m.created_at) DESC
  `).all(...params) as {
    id: number; user_a: string; user_b: string; message_count: number; last_id: number; has_sensitive: number;
  }[];

  const lastStmt = db.prepare(
    "SELECT sender, content, image_url, order_id, created_at FROM messages WHERE id = ?"
  );

  return NextResponse.json(rows.map((r) => {
    const last = lastStmt.get(r.last_id) as { sender: string; content: string; image_url: string; order_id: string; created_at: string };
    return {
      id: r.id,
      user_a: r.user_a,
      user_b: r.user_b,
      message_count: r.message_count,
      last_sender: last.sender || "",
      last_at: last.created_at,
      last_preview: last.image_url ? "[图片]" : last.order_id ? "[卡片]" : (last.content || "").slice(0, 50),
      has_sensitive: r.has_sensitive === 1,
    };
  }));
}
