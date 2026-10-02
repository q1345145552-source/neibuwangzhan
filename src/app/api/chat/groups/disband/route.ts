import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/chat/groups/disband — 群主解散群：删除群、成员、聊天记录及相关数据
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const groupId = Number(body?.group_id);
  if (!Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: "缺少群" }, { status: 400 });

  const group = db.prepare("SELECT id, owner FROM chat_groups WHERE id = ?").get(groupId) as
    { id: number; owner: string } | undefined;
  if (!group) return NextResponse.json({ error: "群不存在" }, { status: 404 });
  if (group.owner !== auth.name) return NextResponse.json({ error: "只有群主能解散群" }, { status: 403 });

  db.transaction(() => {
    // 先删消息维度的关联数据（已读回执 / @提醒 / 表情反应 / 翻译缓存）
    db.prepare("DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(groupId);
    db.prepare("DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(groupId);
    db.prepare("DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(groupId);
    db.prepare("DELETE FROM message_translations WHERE message_id IN (SELECT id FROM messages WHERE group_id = ?)").run(groupId);
    // 删聊天记录
    db.prepare("DELETE FROM messages WHERE group_id = ?").run(groupId);
    // 删会话维度数据（置顶 / 输入状态 / AI 总结缓存）
    db.prepare("DELETE FROM pinned_conversations WHERE scope_key = ?").run(`group:${groupId}`);
    db.prepare("DELETE FROM typing_status WHERE scope_key = ?").run(`group:${groupId}`);
    db.prepare("DELETE FROM chat_summaries WHERE scope_key = ?").run(`group:${groupId}`);
    // 删成员和群本身
    db.prepare("DELETE FROM group_members WHERE group_id = ?").run(groupId);
    db.prepare("DELETE FROM chat_groups WHERE id = ?").run(groupId);
  })();

  return NextResponse.json({ success: true });
}
