import type Database from "better-sqlite3";
import { acknowledgeBossSubmission } from "./boss-submissions";
import { WORK_REPORT_REQUIRED_FROM, workReportTodoSchedule } from "./work-report-policy";

/** 同一员工+日报日期是业务键：日报尚未提交时还没有 work_reports.id。 */
export function runDailyWorkReportTodos(db: Database.Database, now = Date.now()): { todos: number; notifications: number } {
  const schedule = workReportTodoSchedule(now);
  if (!schedule.due) return { todos: 0, notifications: 0 };
  const date = schedule.date;
  const stamp = new Date(now).toISOString();
  return db.transaction(() => {
    const employees = db.prepare(`SELECT DISTINCT e.name FROM employees e
      WHERE e.role='employee' AND e.status IN ('在职','试用期','待离职') AND e.name<>''
        AND (COALESCE(e.hire_date,'')='' OR e.hire_date<=?)
        AND NOT EXISTS (SELECT 1 FROM work_reports r WHERE r.employee_name=e.name AND r.report_date=? AND r.status='已提交')
        AND NOT EXISTS (SELECT 1 FROM leave_requests l WHERE l.employee_name=e.name AND l.status IN ('待审批','已通过') AND l.start_date<=? AND l.end_date>=?)
      ORDER BY e.name`).all(date, date, date, date) as { name: string }[];
    const insertTodo = db.prepare(`INSERT OR IGNORE INTO todos(content,assignee,priority,status,created_by,created_at,updated_at,source_type,source_id)
      VALUES (?,?,'紧急','未完成','系统',?,?,'work_report',?)`);
    const notify = db.prepare("INSERT INTO notifications(type,title,body,recipient,related_id,related_type,created_at) VALUES ('待办指派','你有新待办',?,?,?,'todo',?)");
    const audit = db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','生成日报补交待办','todo',?,?,?)");
    let todos = 0;
    for (const employee of employees) {
      const [, month, day] = date.split('-').map(Number);
      const content = `补交 ${month}月${day}日 的日报`;
      const saved = insertTodo.run(content, employee.name, stamp, stamp, date);
      if (!saved.changes) continue;
      const id = String(saved.lastInsertRowid);
      notify.run(`待办「${content}」由系统派给你`, employee.name, id, stamp);
      audit.run(id, `${employee.name}：${content}`, stamp);
      todos++;
    }
    return { todos, notifications: todos };
  }).immediate();
}

/** 在日报提交事务内回写；只完成精确来源匹配的待办，不按文字猜测或触碰手工待办。 */
export function completeWorkReportTodos(db: Database.Database, employee: string, date: string, stamp = new Date().toISOString()): number {
  if (date < WORK_REPORT_REQUIRED_FROM || !db.prepare("SELECT 1 FROM work_reports WHERE employee_name=? AND report_date=? AND status='已提交'").get(employee, date)) return 0;
  const linked = db.prepare("SELECT id,status FROM todos WHERE source_type='work_report' AND source_id=? AND assignee=?").all(date, employee) as { id: number; status: string }[];
  let completed = 0;
  for (const todo of linked) {
    if (todo.status !== '已完成') {
      db.prepare("UPDATE todos SET status='已完成',completed_at=?,updated_at=? WHERE id=?").run(stamp, stamp, todo.id);
      db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail) VALUES ('系统','日报提交自动完成待办','todo',?,?)").run(String(todo.id), `${employee} ${date}`);
      completed++;
    }
    // 业务已提交即自动处理，不再产生一条额外的“待办完成等待老板确认”。
    acknowledgeBossSubmission(db, 'todo', todo.id, '系统');
  }
  return completed;
}

/** 放开已派出补交任务对应的历史日期，仍不允许冒用他人的待办或任意回填历史。 */
export function pendingWorkReportDates(db: Database.Database, employee: string, today: string): string[] {
  const rows = db.prepare(`SELECT DISTINCT t.source_id date FROM todos t WHERE t.source_type='work_report'
    AND t.assignee=? AND t.status='未完成' AND t.source_id>=? AND t.source_id<?
    AND NOT EXISTS (SELECT 1 FROM work_reports r WHERE r.employee_name=t.assignee AND r.report_date=t.source_id AND r.status='已提交')
    ORDER BY t.source_id DESC`).all(employee, WORK_REPORT_REQUIRED_FROM, today) as { date: string }[];
  return rows.map(row => row.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date));
}
