import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { summarizeChatTranscript } from "@/lib/deepseek";

// 消息内容 → 给大模型看的纯文本（图片/卡片只留占位）
function formatContent(m: { content: string; image_url: string; order_id: string }): string {
  if (m.image_url) return "[图片]";
  if (m.order_id) {
    try {
      const c = JSON.parse(m.content || "{}");
      const title = typeof c.title === "string" ? c.title : "";
      const subtitle = typeof c.subtitle === "string" ? c.subtitle : "";
      if (title) return `[卡片] ${title}${subtitle ? `（${subtitle}）` : ""}`;
    } catch { /* 旧数据容错 */ }
    return `[卡片] ${m.order_id}${m.content ? ` ${m.content}` : ""}`;
  }
  return m.content || "";
}

// POST /api/chat/summary/employee — 老板一键总结某个员工最近的整体沟通情况
// body: { employee, from, to }；返回四块：topics / conclusions / todos / commitments。
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅老板/管理员可操作" }, { status: 403 });

  const body = await readJson(req);
  const employee = String(body?.employee || "").trim();
  const from = String(body?.from || "").trim();
  const to = String(body?.to || "").trim();
  if (!employee) return NextResponse.json({ error: "请选择员工" }, { status: 400 });
  if (!from || !to) return NextResponse.json({ error: "请提供 from 和 to 时间段" }, { status: 400 });

  const db = getDb();
  const emp = db.prepare("SELECT id FROM employees WHERE name = ?").get(employee);
  if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 404 });

  const scopeKey = `employee:${employee}`;

  // 缓存：同一员工 + 同一时间段直接返回
  const cached = db.prepare(
    "SELECT topics, conclusions, todos, commitments, created_at FROM chat_summaries WHERE scope_key = ? AND from_at = ? AND to_at = ?"
  ).get(scopeKey, from, to) as
    { topics: string; conclusions: string; todos: string; commitments: string; created_at: string } | undefined;
  if (cached) {
    return NextResponse.json({
      topics: cached.topics, conclusions: cached.conclusions,
      todos: cached.todos, commitments: cached.commitments,
      cached: true, created_at: cached.created_at,
    });
  }

  // 1:1：该员工参与的所有私聊消息（含对方发来的和员工自己发的）
  const directRows = db.prepare(`
    SELECT m.sender, m.receiver, m.content, m.image_url, m.order_id, m.created_at
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id IS NOT NULL AND m.recalled = 0
      AND (c.user_a = ? OR c.user_b = ?)
      AND m.created_at >= ? AND m.created_at <= ?
    ORDER BY m.created_at ASC, m.id ASC
  `).all(employee, employee, from, to) as any[];

  // 群聊：该员工发出的消息
  const groupRows = db.prepare(`
    SELECT m.sender, m.content, m.image_url, m.order_id, m.created_at, g.name AS group_name
    FROM messages m
    JOIN chat_groups g ON g.id = m.group_id
    WHERE m.group_id IS NOT NULL AND m.recalled = 0
      AND m.sender = ?
      AND m.created_at >= ? AND m.created_at <= ?
    ORDER BY m.created_at ASC, m.id ASC
  `).all(employee, from, to) as any[];

  // 合并成带上下文的纯文本，按时间排序
  type Line = { t: string; s: string };
  const lines: Line[] = [];
  for (const m of directRows) {
    const other = m.sender === employee ? m.receiver : m.sender;
    const time = (m.created_at || "").slice(11, 16);
    lines.push({ t: m.created_at, s: `[私聊·${other}] ${m.sender}${time ? ` ${time}` : ""}: ${formatContent(m)}` });
  }
  for (const m of groupRows) {
    const time = (m.created_at || "").slice(11, 16);
    lines.push({ t: m.created_at, s: `[群·${m.group_name || "群聊"}] ${m.sender}${time ? ` ${time}` : ""}: ${formatContent(m)}` });
  }
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  if (lines.length === 0) {
    return NextResponse.json({ error: "该员工这段时间没有聊天记录" }, { status: 400 });
  }

  const transcript = `员工「${employee}」最近与所有人的沟通记录（含私聊和群聊）：\n\n${lines.map((l) => l.s).join("\n")}`;

  let summary;
  try {
    summary = await summarizeChatTranscript(transcript);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "总结失败" }, { status: 502 });
  }

  db.prepare(
    "INSERT OR IGNORE INTO chat_summaries (scope_key, from_at, to_at, topics, conclusions, todos, commitments) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(scopeKey, from, to, summary.topics, summary.conclusions, summary.todos, summary.commitments);

  return NextResponse.json({ ...summary, cached: false });
}
