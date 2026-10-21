import type Database from "better-sqlite3";

type Actor = { role: string; name: string };
interface AttendanceCardRow { id: number; employee_name: string; date: string; time: string; status: string; }
const columns = "id,employee_name,date,time,status";
function card(row: AttendanceCardRow) {
  return { id: String(row.id), title: `${row.employee_name}的补签申请 #${row.id}`, subtitle: `${row.date} ${row.time} · ${row.status}`, status: row.status };
}

// 编号始终来自申请表，不查询打卡表；分享摘要不携带原因或照片。
export function listAttendanceCards(db: Database.Database, actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "employee") return [];
  const own = actor.role !== "admin";
  const rows = db.prepare(`SELECT ${columns} FROM attendance_requests${own ? " WHERE employee_name=?" : ""} ORDER BY created_at DESC,id DESC`)
    .all(...(own ? [actor.name] : [])) as AttendanceCardRow[];
  return rows.map(card);
}

export function resolveAttendanceCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (actor.role !== "admin" && actor.role !== "employee") return null;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return null;
  const own = actor.role !== "admin";
  const row = db.prepare(`SELECT ${columns} FROM attendance_requests WHERE id=?${own ? " AND employee_name=?" : ""}`)
    .get(n, ...(own ? [actor.name] : [])) as AttendanceCardRow | undefined;
  if (!row) return null;
  const { title, subtitle } = card(row);
  return { title, subtitle };
}
