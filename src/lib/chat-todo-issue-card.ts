import type Database from "better-sqlite3";

type Actor = { role: string; name: string };
type IssueOwner = { assignee: string | null; created_by: string | null };

/** 工单沿用逗号分隔的完整名单；按姓名精确去重，不取第一人或做子串匹配。 */
export function parseIssueAssignees(value: string | null | undefined): string[] {
  return [...new Set((value || "").split(",").map(name => name.trim()).filter(Boolean))];
}

/** 与工单原负责人/创建人范围一致；逐个姓名比较，不使用子串或SQL通配符。 */
export function canReadIssue(actor: Actor, row: IssueOwner): boolean {
  return actor.role === "admin" || (actor.role === "employee" && !!actor.name && (
    row.created_by === actor.name || (row.assignee || "").split(",").some(name => name.trim() === actor.name)
  ));
}

const validId = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));

export function resolveTodoCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (!["admin", "employee"].includes(actor.role) || !validId(id)) return null;
  const row = db.prepare("SELECT content,assignee FROM todos WHERE id=?").get(Number(id)) as { content: string; assignee: string } | undefined;
  if (!row || (actor.role !== "admin" && (!actor.name || row.assignee !== actor.name))) return null;
  return { title: row.content, subtitle: "" };
}

export function resolveIssueCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (!["admin", "employee"].includes(actor.role) || !validId(id)) return null;
  const row = db.prepare("SELECT ticket_number,description,description_zh,assignee,created_by FROM issue_tickets WHERE id=?")
    .get(Number(id)) as (IssueOwner & { ticket_number: string; description: string; description_zh: string }) | undefined;
  if (!row || !canReadIssue(actor, row)) return null;
  return { title: row.ticket_number || `#${id}`, subtitle: row.description_zh || row.description || "" };
}
