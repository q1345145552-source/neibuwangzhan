import type Database from "better-sqlite3";

type Actor = { role: string; name: string };
interface LeaveCardRow {
  id: number; employee_name: string; start_date: string; end_date: string;
  start_time: string; end_time: string; status: string;
}
const columns = "id,employee_name,start_date,end_date,start_time,end_time,status";
function card(row: LeaveCardRow) {
  return {
    id: String(row.id),
    title: `${row.employee_name}的请假申请 #${row.id}`,
    subtitle: `${row.start_date} ${row.start_time || "09:00"} 至 ${row.end_date} ${row.end_time || "17:00"} · ${row.status}`,
    status: row.status,
  };
}

// 分享只带识别所需信息，不读取或快照请假原因、病假凭证等敏感内容。
export function listLeaveCards(db: Database.Database, actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "employee") return [];
  const own = actor.role !== "admin";
  const rows = db.prepare(`SELECT ${columns} FROM leave_requests${own ? " WHERE employee_name=?" : ""} ORDER BY created_at DESC,id DESC`)
    .all(...(own ? [actor.name] : [])) as LeaveCardRow[];
  return rows.map(card);
}

export function resolveLeaveCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (actor.role !== "admin" && actor.role !== "employee") return null;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return null;
  const own = actor.role !== "admin";
  const row = db.prepare(`SELECT ${columns} FROM leave_requests WHERE id=?${own ? " AND employee_name=?" : ""}`)
    .get(n, ...(own ? [actor.name] : [])) as LeaveCardRow | undefined;
  if (!row) return null;
  const { title, subtitle } = card(row);
  return { title, subtitle };
}
