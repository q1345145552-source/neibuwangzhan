import type Database from "better-sqlite3";
import { insertDirectMessage } from "./chat-direct-message";
import { resolveLeaveCard } from "./chat-leave-card";
import { resolveAttendanceCard } from "./chat-attendance-card";
import { resolveNoticeCard } from "./chat-notice-card";
import { resolveReportCard } from "./chat-report-card";
import { resolveMeetingCard } from "./chat-meeting-card";
import { TASK_MESSAGE_TYPES, type TaskMessageType, type TaskMessageResponse, type TaskMessageResult } from "./chat-task-message-types";

type Actor = { id: number; name: string; role: string };
type Person = Actor & { status: string };
type Card = { title: string; subtitle: string };
type Owner = { key: string; name: string; employeeId?: number };
export class TaskMessageError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const fail = (message: string, status = 400): never => { throw new TaskMessageError(message, status); };
const eligible = (person: Person) => ["admin", "employee"].includes(person.role) && ["在职", "试用期", "待离职"].includes(person.status);
function personByName(db: Database.Database, name: string): Person {
  const people = db.prepare("SELECT id,name,role,status FROM employees WHERE name=?").all(name) as Person[];
  if (!people.length) return fail(`找不到负责人「${name}」的账号`);
  if (people.length !== 1) return fail(`「${name}」存在重名账号，无法确定聊天对象，请先核对员工档案`);
  if (!eligible(people[0])) return fail(`「${name}」不具备聊天资格（仅在职、试用期或待离职的员工和管理员可聊天）`);
  return people[0];
}

function task(db: Database.Database, actor: Actor, type: TaskMessageType, id: number): { card: Card; owners: Owner[] } {
  const own = (name: string) => actor.role === "admin" || name === actor.name;
  const table = { leave: "leave_requests", attendance: "attendance_requests", report: "work_reports", meeting: "meeting_reflections" };
  if (type === "notice") {
    const row = db.prepare("SELECT employee_id,employee_name FROM notice_rule_implementations WHERE id=?").get(id) as { employee_id: number; employee_name: string } | undefined;
    const card = resolveNoticeCard(db, actor, String(id));
    if (!row || !card) return fail("落实记录不存在或无权查看", 404);
    return { card, owners: [{ key: `id:${row.employee_id}`, name: row.employee_name, employeeId: row.employee_id }] };
  }
  if (type === "leave" || type === "attendance" || type === "report" || type === "meeting") {
    const row = db.prepare(`SELECT employee_name FROM ${table[type]} WHERE id=?`).get(id) as { employee_name: string } | undefined;
    const resolver = { leave: resolveLeaveCard, attendance: resolveAttendanceCard, report: resolveReportCard, meeting: resolveMeetingCard }[type];
    const card = resolver(db, actor, String(id));
    if (!row || !card) return fail("记录不存在或无权查看", 404);
    return { card, owners: [{ key: `name:${row.employee_name}`, name: row.employee_name }] };
  }
  if (type === "todo") {
    const row = db.prepare("SELECT assignee,content FROM todos WHERE id=?").get(id) as { assignee: string; content: string } | undefined;
    if (!row || !own(row.assignee)) return fail("待办不存在或无权查看", 404);
    return { card: { title: row.content, subtitle: "" }, owners: [{ key: `name:${row.assignee}`, name: row.assignee }] };
  }
  if (type === "problem") {
    // 原问题详情对员工开放，保持原查看权限；不扩展负责人/老板的业务操作权限。
    const row = db.prepare("SELECT assignee,problem_number,company_name FROM problems WHERE id=?").get(id) as { assignee: string; problem_number: string; company_name: string } | undefined;
    if (!row) return fail("问题不存在", 404);
    return { card: { title: row.problem_number, subtitle: row.company_name || "" }, owners: [{ key: `name:${row.assignee}`, name: row.assignee }] };
  }
  const row = db.prepare("SELECT assignee,created_by,ticket_number,description,description_zh FROM issue_tickets WHERE id=?").get(id) as { assignee: string; created_by: string; ticket_number: string; description: string; description_zh: string } | undefined;
  if (!row) return fail("工单不存在", 404);
  const names = [...new Set((row.assignee || "").split(",").map(n => n.trim()).filter(Boolean))];
  if (actor.role !== "admin" && !names.includes(actor.name) && row.created_by !== actor.name) return fail("工单不存在或无权查看", 404);
  return { card: { title: row.ticket_number || `#${id}`, subtitle: row.description_zh || row.description || "" }, owners: names.map(name => ({ key: `name:${name}`, name })) };
}

/** 同一动作的成功项在原消息JSON中留服务端标记；SQLite立即事务覆盖查重和发送，无需建表。 */
export function sendTaskMessages(db: Database.Database, actor: Actor, body: Record<string, unknown>): TaskMessageResponse {
  if (actor.role !== "admin" && actor.role !== "employee") return fail("仅员工和管理员可用", 403);
  const type = body.type as TaskMessageType, id = Number(body.id), action = body.action;
  if (!TASK_MESSAGE_TYPES.includes(type) || !/^[1-9]\d*$/.test(String(body.id)) || !Number.isSafeInteger(id)) return fail("任务类型或编号无效");
  if (typeof action !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(action)) return fail("发送动作编号无效");
  const marker = `${actor.id}:${action.toLowerCase()}`;
  return db.transaction(() => {
    let sender: Person;
    try { sender = personByName(db, actor.name); }
    catch (error) { if (error instanceof TaskMessageError) return fail(error.message, 403); throw error; }
    if (sender.id !== actor.id || sender.role !== actor.role) return fail("当前账号信息已变化，请重新登录", 403);
    const current = task(db, actor, type, id);
    // 只排除已核对过的自己；通知以账号ID判断，其他原业务仍沿用姓名归属。
    const owners = current.owners.filter(o => o.employeeId !== undefined ? o.employeeId !== actor.id : o.name !== actor.name);
    if (!owners.length) return fail(current.owners.length ? "负责人是自己，无需发送消息" : "这条任务没有负责人，无法发送消息");
    const signature = JSON.stringify(owners.map(o => o.key).sort());
    const previous = db.prepare("SELECT id,receiver,content,order_id FROM messages WHERE sender=? AND content LIKE ? AND conversation_id IS NOT NULL")
      .all(actor.name, `%"task_action_id":"${marker}"%`) as { id: number; receiver: string; content: string; order_id: string }[];
    const sent = new Map<string, TaskMessageResult>();
    let card = current.card;
    for (const message of previous) {
      let value;
      try { value = JSON.parse(message.content); } catch { continue; }
      if (value.task_action_id !== marker) continue;
      if (message.order_id !== `${type}:${id}` || value.task_owners !== signature) return fail("任务或负责人已变化，请关闭本次结果后重新发送", 409);
      sent.set(value.task_recipient, { key: value.task_recipient, name: message.receiver, status: "sent", messageId: message.id });
      card = { title: value.title, subtitle: value.subtitle };
    }
    const results = owners.map((owner): TaskMessageResult => {
      if (sent.has(owner.key)) return sent.get(owner.key)!;
      try {
        if (!owner.name?.trim()) return fail("这条任务没有负责人，无法发送消息");
        let target: Person;
        if (owner.employeeId !== undefined) {
          const byId = db.prepare("SELECT id,name,role,status FROM employees WHERE id=?").get(owner.employeeId) as Person | undefined;
          if (!byId) return fail(`落实记录的员工账号已不存在（#${owner.employeeId}）`);
          target = personByName(db, byId.name);
          if (target.id !== owner.employeeId) return fail("落实记录的员工账号不匹配");
        } else target = personByName(db, owner.name);
        if (target.id === actor.id) return fail("不能给自己发送消息");
        // 子事务回滚失败项（含会话预览），成功项继续保留；下次同动作只重试失败项。
        const message = db.transaction(() => insertDirectMessage(db, {
          sender: actor.name, receiver: target.name, orderId: `${type}:${id}`,
          content: JSON.stringify({ ...card, task_action_id: marker, task_owners: signature, task_recipient: owner.key }),
          preview: { leave: "[请假]", attendance: "[补签]", notice: "[通知落实]", report: "[日报]", meeting: "[会议心得]", todo: "[待办]", problem: "[问题]", issue: "[工单]" }[type],
        }))();
        return { key: owner.key, name: target.name, status: "sent", messageId: message.id };
      } catch (error) {
        return { key: owner.key, name: owner.name || "未分配", status: "failed", error: error instanceof TaskMessageError ? error.message : "发送失败，请重试；已成功的消息不会重复发送" };
      }
    });
    return { results, multiple: owners.length > 1 };
  }).immediate();
}
