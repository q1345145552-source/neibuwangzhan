import { getDb, logOperation } from "./db";
import { bangkokToday, bangkokNowStr } from "./time";

// 工作记录提醒同步：
// 1. 昨天没交日报的员工 → 生成一条「补交 X月X日 工作记录」待办（负责人是那个员工）。
// 2. 当天下午 16:30 之后还没交今天日报的员工 → 发一条系统通知提醒。
// 在工作记录相关接口被访问时顺带触发；靠 work_report_reminders 去重，
// 同一员工 + 同一天 + 同类提醒只生成一次。

const REMINDER_TIME = "16:30";

function dateMinusOne(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

function toMonthDay(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  return `${parts[1]}月${parts[2]}日`;
}

export function syncWorkReportReminders(): { todos: number; notifications: number } {
  const db = getDb();
  const today = bangkokToday();
  const yesterday = dateMinusOne(today);
  const now = new Date().toISOString();

  const employees = db.prepare(
    "SELECT name FROM employees WHERE role = 'employee' AND status = '在职' ORDER BY name"
  ).all() as { name: string }[];

  const hasReport = db.prepare("SELECT id FROM work_reports WHERE employee_name = ? AND report_date = ?");
  const insReminder = db.prepare(
    "INSERT OR IGNORE INTO work_report_reminders (employee_name, report_date, kind) VALUES (?, ?, ?)"
  );

  let todos = 0;
  let notifications = 0;

  // 1. 昨天没交 → 补交待办
  const insTodo = db.prepare(
    "INSERT INTO todos (content, assignee, priority, status, created_by, created_at, updated_at) VALUES (?, ?, '紧急', '未完成', '系统', ?, ?)"
  );
  for (const e of employees) {
    if (hasReport.get(e.name, yesterday)) continue;
    const ins = insReminder.run(e.name, yesterday, "todo");
    if (ins.changes === 0) continue;
    const content = `补交 ${toMonthDay(yesterday)} 工作记录`;
    const r = insTodo.run(content, e.name, now, now);
    logOperation("系统", "生成补交待办", "todo", String(r.lastInsertRowid), `${e.name}：${content}`);
    todos++;
  }

  // 2. 当天下午之后还没交今天 → 系统通知提醒
  const nowHHMM = bangkokNowStr().slice(11, 16);
  if (nowHHMM >= REMINDER_TIME) {
    const insNotify = db.prepare(
      "INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('日报提醒', '记得交今日工作记录', ?, ?, '', 'work_report')"
    );
    for (const e of employees) {
      if (hasReport.get(e.name, today)) continue;
      const ins = insReminder.run(e.name, today, "notify");
      if (ins.changes === 0) continue;
      insNotify.run(`今天（${toMonthDay(today)}）的工作记录还没提交，记得提交哦`, e.name);
      notifications++;
    }
  }

  return { todos, notifications };
}
