import type Database from "better-sqlite3";
import { acknowledgeBossSubmission } from "./boss-submissions";

export function parseMeetingParticipants(raw: unknown): string[] {
  let values: unknown = raw;
  if (typeof raw === "string") {
    try { values = JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === "string").map(value => value.trim()).filter(Boolean))] : [];
}

export function invalidMeetingParticipants(db: Database.Database, names: string[]): string[] {
  const eligible = db.prepare("SELECT 1 FROM employees WHERE name=? AND role='employee' AND status IN ('在职','试用期','待离职')");
  return names.filter(name => !eligible.get(name));
}

/** 与会议创建/补加参会人的事务一起提交，唯一索引保证一人一会一条。 */
export function assignMeetingTodos(db: Database.Database, meetingId: number, title: string, participants: string[], stamp = new Date().toISOString()): number {
  return db.transaction(() => {
    const insert = db.prepare(`INSERT OR IGNORE INTO todos(content,assignee,priority,status,created_by,created_at,updated_at,source_type,source_id)
      VALUES (?,?,'紧急','未完成','系统',?,?,'meeting',?)`);
    const notify = db.prepare("INSERT INTO notifications(type,title,body,recipient,related_id,related_type,created_at) VALUES ('待办指派','你有新待办',?,?,?,'todo',?)");
    const audit = db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','生成会议待办','todo',?,?,?)");
    const content = `参加「${title}」并提交心得`;
    let count = 0;
    for (const name of [...new Set(participants)]) {
      if (invalidMeetingParticipants(db, [name]).length) continue;
      const saved = insert.run(content, name, stamp, stamp, String(meetingId));
      if (!saved.changes) continue;
      const id = String(saved.lastInsertRowid);
      audit.run(id, `${name}：${content}`, stamp);
      // 补加到历史会议时，若已有有效心得，直接完成，不再通知员工做已完成的事。
      if (!completeMeetingTodos(db, name, meetingId, stamp)) notify.run(`待办「${content}」由系统派给你`, name, id, stamp);
      count++;
    }
    return count;
  }).immediate();
}

/** 只完成本人、对应会议的来源待办，手工待办和其他业务均不匹配。 */
export function completeMeetingTodos(db: Database.Database, employee: string, meetingId: number, stamp = new Date().toISOString()): number {
  if (!db.prepare("SELECT 1 FROM meeting_reflections WHERE meeting_id=? AND employee_name=? AND status='已提交'").get(meetingId, employee)) return 0;
  const linked = db.prepare("SELECT id,status FROM todos WHERE source_type='meeting' AND source_id=? AND assignee=?").all(String(meetingId), employee) as { id: number; status: string }[];
  let count = 0;
  for (const todo of linked) {
    if (todo.status !== "已完成") {
      db.prepare("UPDATE todos SET status='已完成',completed_at=?,updated_at=? WHERE id=?").run(stamp, stamp, todo.id);
      db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','会议心得提交自动完成待办','todo',?,?,?)").run(String(todo.id), `${employee} 会议 #${meetingId}`, stamp);
      count++;
    }
    // 心得本身会进入老板待处理清单，自动完成的待办无需再确认一次。
    acknowledgeBossSubmission(db, "todo", todo.id, "系统");
  }
  return count;
}
