import type Database from "better-sqlite3";
import { acknowledgeBossSubmission } from "./boss-submissions";

type Source = "notice" | "problem";
type Todo = { id: number; content: string; assignee: string; status: string };

function assignmentNotice(db: Database.Database, todo: Todo, stamp: string) {
  db.prepare("INSERT INTO notifications(type,title,body,recipient,related_id,related_type,created_at) VALUES ('待办指派','你有新待办',?,?,?,'todo',?)")
    .run(`待办「${todo.content}」由系统派给你`, todo.assignee, String(todo.id), stamp);
}

function createTodo(db: Database.Database, source: Source, sourceId: number, assignee: string, content: string, stamp: string) {
  const saved = db.prepare(`INSERT OR IGNORE INTO todos(content,assignee,priority,status,created_by,created_at,updated_at,source_type,source_id)
    VALUES (?,?,'紧急','未完成','系统',?,?,?,?)`).run(content, assignee, stamp, stamp, source, String(sourceId));
  if (!saved.changes) return;
  const todo = { id: Number(saved.lastInsertRowid), content, assignee, status: "未完成" };
  assignmentNotice(db, todo, stamp);
  db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','生成业务紧急待办','todo',?,?,?)")
    .run(String(todo.id), `${source} #${sourceId}：${assignee} ${content}`, stamp);
}

function finishTodo(db: Database.Database, todo: Todo, stamp: string) {
  if (todo.status !== "已完成") {
    db.prepare("UPDATE todos SET status='已完成',completed_at=?,updated_at=? WHERE id=?").run(stamp, stamp, todo.id);
    db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','业务处理自动完成待办','todo',?,?,?)")
      .run(String(todo.id), todo.content, stamp);
  }
  // 通知落实/问题验收本身已进入老板待处理清单，不再额外等待一次待办确认。
  acknowledgeBossSubmission(db, "todo", todo.id, "系统");
}

function reopenTodo(db: Database.Database, todo: Todo, stamp: string) {
  if (todo.status !== "已完成") return;
  db.prepare("UPDATE todos SET status='未完成',completed_at='',updated_at=? WHERE id=?").run(stamp, todo.id);
  db.prepare("UPDATE boss_submission_state SET confirmed_at='',confirmed_by='' WHERE category='todo' AND source_id=?").run(todo.id);
  db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail,created_at) VALUES ('系统','业务重新处理恢复待办','todo',?,?,?)")
    .run(String(todo.id), todo.content, stamp);
}

/** 以下函数均在对应业务写入事务内调用；通知来源编号使用个人落实记录，而非通知编号。 */
export function assignNoticeTodo(db: Database.Database, implementationId: number, stamp = new Date().toISOString()) {
  const record = db.prepare(`SELECT r.employee_name,n.title FROM notice_rule_implementations r
    JOIN notice_rules n ON n.id=r.notice_id WHERE r.id=?`).get(implementationId) as { employee_name: string; title: string } | undefined;
  if (!record) return;
  createTodo(db, "notice", implementationId, record.employee_name, `落实通知「${record.title}」(打印并拍照)`, stamp);
}

export function syncNoticeTodo(db: Database.Database, implementationId: number, stamp = new Date().toISOString()) {
  const record = db.prepare("SELECT employee_name,printed,photos,statement,submitted_at,review_status FROM notice_rule_implementations WHERE id=?").get(implementationId) as {
    employee_name: string; printed: number; photos: string; statement: string; submitted_at: string | null; review_status: string;
  } | undefined;
  if (!record) return;
  const todo = db.prepare("SELECT id,content,assignee,status FROM todos WHERE source_type='notice' AND source_id=? AND assignee=?").get(String(implementationId), record.employee_name) as Todo | undefined;
  if (!todo) return;
  if (record.review_status === "打回") { reopenTodo(db, todo, stamp); return; }
  let hasPhoto = false;
  try { const photos: unknown = JSON.parse(record.photos); hasPhoto = Array.isArray(photos) && photos.some(photo => typeof photo === "string" && photo.trim()); } catch { /* 无有效照片不能完成 */ }
  if (record.printed && hasPhoto && record.statement.trim() && record.submitted_at) finishTodo(db, todo, stamp);
}

type Problem = { problem_number: string; description: string; assignee: string; status: string };
const problemContent = (problem: Problem) => `处理问题 #${problem.problem_number}：${problem.description}`;

export function assignProblemTodo(db: Database.Database, problemId: number, stamp = new Date().toISOString()) {
  const problem = db.prepare("SELECT problem_number,description,assignee,status FROM problems WHERE id=?").get(problemId) as Problem | undefined;
  if (!problem?.assignee) return;
  createTodo(db, "problem", problemId, problem.assignee, problemContent(problem), stamp);
  syncProblemTodo(db, problemId, stamp);
}

/** 复用同一条来源待办：编辑内容/转交负责人/打回不会另派一条，也不追补历史问题。 */
export function syncProblemTodo(db: Database.Database, problemId: number, stamp = new Date().toISOString()) {
  const problem = db.prepare("SELECT problem_number,description,assignee,status FROM problems WHERE id=?").get(problemId) as Problem | undefined;
  const todo = db.prepare("SELECT id,content,assignee,status FROM todos WHERE source_type='problem' AND source_id=?").get(String(problemId)) as Todo | undefined;
  if (!problem || !todo) return;
  const content = problemContent(problem), reassigned = todo.assignee !== problem.assignee;
  if (todo.content !== content || reassigned) {
    db.prepare("UPDATE todos SET content=?,assignee=?,seen_at=CASE WHEN assignee<>? THEN '' ELSE seen_at END,updated_at=? WHERE id=?")
      .run(content, problem.assignee, problem.assignee, stamp, todo.id);
    todo.content = content; todo.assignee = problem.assignee;
    if (reassigned && problem.status !== "老板验收" && problem.status !== "已解决") assignmentNotice(db, todo, stamp);
  }
  if (problem.status === "老板验收" || problem.status === "已解决") finishTodo(db, todo, stamp);
  else reopenTodo(db, todo, stamp);
}

/** 保留现有删除权限及记录历史；显式删除问题时关闭对应待办，避免悬空未完成任务。 */
export function retireProblemTodo(db: Database.Database, problemId: number) {
  const todo = db.prepare("SELECT id,content,assignee,status FROM todos WHERE source_type='problem' AND source_id=?").get(String(problemId)) as Todo | undefined;
  if (todo) finishTodo(db, todo, new Date().toISOString());
}
