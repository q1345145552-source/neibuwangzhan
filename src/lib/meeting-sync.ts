import { getDb, logOperation } from "./db";
import { bangkokToday, bangkokNowStr } from "./time";

// 会议提醒同步：
// 1. 会议日期是今天、曼谷时间过了 16:30，参会人里还没交心得的员工 → 发系统通知提醒。
// 2. 会议日期是昨天，参会人里还没交心得的员工 → 生成一条「补交 XX 会议心得」待办。
// 在会议相关接口被访问时顺带触发；靠 meeting_reminders 去重，
// 同一员工 + 同一场会议 + 同类提醒只生成一次。

const REMINDER_TIME = "16:30";

function dateMinusOne(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function parseParticipants(s: string): string[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    const names = a.map((x: unknown) => String(x).trim()).filter(Boolean);
    return [...new Set(names)];
  } catch { return []; }
}

export function syncMeetingReminders(): { todos: number; notifications: number } {
  const db = getDb();
  const today = bangkokToday();
  const yesterday = dateMinusOne(today);
  const now = new Date().toISOString();

  const hasReflection = db.prepare("SELECT id FROM meeting_reflections WHERE meeting_id = ? AND employee_name = ?");
  const insReminder = db.prepare(
    "INSERT OR IGNORE INTO meeting_reminders (meeting_id, employee_name, kind) VALUES (?, ?, ?)"
  );

  let todos = 0;
  let notifications = 0;

  // 1. 昨天会议 → 补交待办
  const insTodo = db.prepare(
    "INSERT INTO todos (content, assignee, priority, status, created_by, created_at, updated_at) VALUES (?, ?, '紧急', '未完成', '系统', ?, ?)"
  );
  const yesterdayMeetings = db.prepare("SELECT id, title, participants FROM meetings WHERE meeting_date = ?").all(yesterday) as { id: number; title: string; participants: string }[];
  for (const m of yesterdayMeetings) {
    for (const name of parseParticipants(m.participants)) {
      if (hasReflection.get(m.id, name)) continue;
      const ins = insReminder.run(m.id, name, "todo");
      if (ins.changes === 0) continue;
      const content = `补交 ${m.title} 会议心得`;
      const r = insTodo.run(content, name, now, now);
      logOperation("系统", "生成补交会议心得待办", "todo", String(r.lastInsertRowid), `${name}：${content}`);
      todos++;
    }
  }

  // 2. 今天会议 + 下午 16:30 后 → 系统通知提醒
  const nowHHMM = bangkokNowStr().slice(11, 16);
  if (nowHHMM >= REMINDER_TIME) {
    const insNotify = db.prepare(
      "INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('会议提醒', '记得交会议心得', ?, ?, ?, 'meeting')"
    );
    const todayMeetings = db.prepare("SELECT id, title, participants FROM meetings WHERE meeting_date = ?").all(today) as { id: number; title: string; participants: string }[];
    for (const m of todayMeetings) {
      for (const name of parseParticipants(m.participants)) {
        if (hasReflection.get(m.id, name)) continue;
        const ins = insReminder.run(m.id, name, "notify");
        if (ins.changes === 0) continue;
        insNotify.run(`记得交「${m.title}」会议心得`, name, String(m.id));
        notifications++;
      }
    }
  }

  return { todos, notifications };
}
