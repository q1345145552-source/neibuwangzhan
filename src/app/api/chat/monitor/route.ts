import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// GET /api/chat/monitor — 聊天监控（仅管理员）
// 不带参数：列出所有员工之间的 1:1 会话（谁跟谁、多少条、最后聊了什么）
// ?conversation_id=X：查看该会话的完整聊天记录（管理员无需参与）
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

  // 会话列表：只列有消息的 1:1 会话，按最后一条消息时间倒序
  const rows = db.prepare(`
    SELECT c.id, c.user_a, c.user_b,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT m.sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_content,
      (SELECT m.image_url FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_image_url,
      (SELECT m.order_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_order_id,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at
    FROM conversations c
    WHERE (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) > 0
    ORDER BY last_at DESC
  `).all() as {
    id: number; user_a: string; user_b: string; message_count: number;
    last_sender: string | null; last_content: string | null; last_image_url: string | null;
    last_order_id: string | null; last_at: string | null;
  }[];

  return NextResponse.json(rows.map((r) => ({
    id: r.id,
    user_a: r.user_a,
    user_b: r.user_b,
    message_count: r.message_count,
    last_sender: r.last_sender || "",
    last_at: r.last_at,
    last_preview: r.last_image_url ? "[图片]" : r.last_order_id ? "[卡片]" : (r.last_content || "").slice(0, 50),
  })));
}
