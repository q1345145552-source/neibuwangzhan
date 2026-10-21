import type Database from "better-sqlite3";

export function getOrCreateConversation(db: Database.Database, me: string, other: string): number {
  const [a, b] = me < other ? [me, other] : [other, me];
  const existing = db.prepare("SELECT id FROM conversations WHERE user_a = ? AND user_b = ?").get(a, b) as { id: number } | undefined;
  if (existing) return existing.id;
  return Number(db.prepare("INSERT INTO conversations (user_a, user_b) VALUES (?, ?)").run(a, b).lastInsertRowid);
}

/** 原一对一发送通道；调用方负责权限，任务批量发送在事务内复用。 */
export function insertDirectMessage(db: Database.Database, input: {
  sender: string; receiver: string; content: string; imageUrl?: string; orderId?: string;
  replyTo?: number | null; replyPreview?: string; preview: string;
}) {
  const conversationId = getOrCreateConversation(db, input.sender, input.receiver);
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  const result = db.prepare(
    "INSERT INTO messages (conversation_id, sender, receiver, content, image_url, order_id, is_read, reply_to, reply_preview, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)"
  ).run(conversationId, input.sender, input.receiver, input.content, input.imageUrl || "", input.orderId || "", input.replyTo ?? null, input.replyPreview || "", now);
  db.prepare("UPDATE conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?").run(now, input.preview, conversationId);
  return db.prepare(
    "SELECT id, conversation_id, group_id, sender, receiver, content, image_url, order_id, is_read, read_at, recalled, reply_to, reply_preview, created_at FROM messages WHERE id = ?"
  ).get(Number(result.lastInsertRowid)) as { id: number; receiver: string; content: string };
}
