import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { summarizeMeetingStory } from "@/lib/deepseek";
import { parseMeetingTopics } from "@/lib/meeting-topics";

// 合并同一进程内同一场会议的并发请求，避免重复调用 AI。
const generating = new Map<number, Promise<string>>();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可生成会议故事线" }, { status: 403 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的会议ID" }, { status: 400 });
  const db = getDb();
  const meeting = db.prepare("SELECT id, title, meeting_date, meeting_time, agenda, topics, participants, story FROM meetings WHERE id = ?").get(id) as {
    id: number; title: string; meeting_date: string; meeting_time: string;
    agenda: string; topics: string; participants: string; story: string;
  } | undefined;
  if (!meeting) return NextResponse.json({ error: "会议不存在" }, { status: 404 });
  if (meeting.story?.trim()) return NextResponse.json({ story: meeting.story, cached: true });

  try {
    let task = generating.get(id);
    if (!task) {
      let participants: string[] = [];
      try {
        const names: unknown = JSON.parse(meeting.participants);
        if (Array.isArray(names)) participants = names.filter((name): name is string => typeof name === "string").map((name) => name.trim());
      } catch {}
      const participantNames = new Set(participants);
      const reflections = (db.prepare(`
        SELECT employee_name, content, created_at FROM meeting_reflections
        WHERE meeting_id = ? AND status = '已提交' ORDER BY created_at ASC, id ASC
      `).all(id) as { employee_name: string; content: string; created_at: string }[])
        .filter((reflection) => participantNames.has(reflection.employee_name));
      task = (async () => {
        const story = await summarizeMeetingStory({
          title: meeting.title,
          meetingDate: meeting.meeting_date,
          meetingTime: meeting.meeting_time,
          agenda: meeting.agenda,
          topics: parseMeetingTopics(meeting.topics),
          reflections: reflections.map((reflection) => ({
            employeeName: reflection.employee_name, content: reflection.content, createdAt: reflection.created_at,
          })),
        });
        const result = db.prepare("UPDATE meetings SET story = ? WHERE id = ?").run(story, id);
        if (!result.changes) throw new Error("会议已不存在，请刷新后重试");
        return story;
      })();
      generating.set(id, task);
      // 成功或失败都清理，失败后允许重试。
      void task.then(() => generating.delete(id), () => generating.delete(id));
    }
    return NextResponse.json({ story: await task, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成失败，请重试" }, { status: 502 });
  }
}
