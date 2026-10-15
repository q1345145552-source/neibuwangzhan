import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { translateText } from "@/lib/deepseek";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的心得ID" }, { status: 400 });
  const db = getDb();
  const reflection = db.prepare(`
    SELECT r.id, r.meeting_id, r.employee_name, r.content, r.content_zh, m.title, m.agenda
    FROM meeting_reflections r JOIN meetings m ON m.id = r.meeting_id WHERE r.id = ?
  `).get(id) as {
    id: number; meeting_id: number; employee_name: string; content: string;
    content_zh: string; title: string; agenda: string;
  } | undefined;
  if (!reflection) return NextResponse.json({ error: "心得不存在" }, { status: 404 });
  // 与心得列表保持一致：员工只能查看、翻译自己的心得。
  if (auth.role !== "admin" && reflection.employee_name !== auth.name) {
    return NextResponse.json({ error: "只能翻译自己的心得" }, { status: 403 });
  }
  if (reflection.content_zh?.trim()) {
    return NextResponse.json({ content_zh: reflection.content_zh, cached: true });
  }
  if (!reflection.content.trim()) return NextResponse.json({ error: "心得内容为空" }, { status: 400 });

  // 最多取其他同事最近的 5 条，每条 800 字，主题和议程也限制长度。
  const colleagues = db.prepare(`
    SELECT substr(content, 1, 800) AS content FROM meeting_reflections
    WHERE meeting_id = ? AND employee_name <> ? AND status = '已提交' AND trim(content) <> ''
    ORDER BY id DESC LIMIT 5
  `).all(reflection.meeting_id, reflection.employee_name) as { content: string }[];
  const context = [
    `会议主题：${(reflection.title || "").slice(0, 300)}`,
    `会议议程：${(reflection.agenda || "").slice(0, 2000)}`,
    "其他同事已提交的心得（节选）：",
    ...colleagues.map((row, index) => `${index + 1}. ${row.content}`),
  ].join("\n");

  try {
    const zh = await translateText(reflection.content, "中文", context);
    // 翻译期间若员工改了正文，不把旧译文写到新正文上。
    const result = db.prepare("UPDATE meeting_reflections SET content_zh = ? WHERE id = ? AND content = ?")
      .run(zh, id, reflection.content);
    if (!result.changes) return NextResponse.json({ error: "心得已更新，请刷新后重试" }, { status: 409 });
    return NextResponse.json({ content_zh: zh, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败，请重试" }, { status: 502 });
  }
}
