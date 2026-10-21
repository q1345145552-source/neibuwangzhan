import type Database from "better-sqlite3";

type Actor = { role: string; name: string };
interface ReportCardRow { id: number; employee_name: string; report_date: string; status: string; }
const columns = "id,employee_name,report_date,status";
function card(row: ReportCardRow) {
  return { id: String(row.id), title: `${row.employee_name} ${row.report_date} 日报 #${row.id}`, subtitle: row.status, status: row.status };
}

// 沿用日报原有的姓名归属规则；不按在岗员工过滤历史记录，也不读取正文/点评用于分享。
export function listReportCards(db: Database.Database, actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "employee") return [];
  const own = actor.role !== "admin";
  const rows = db.prepare(`SELECT ${columns} FROM work_reports${own ? " WHERE employee_name=?" : ""} ORDER BY report_date DESC,id DESC`)
    .all(...(own ? [actor.name] : [])) as ReportCardRow[];
  return rows.map(card);
}

export function resolveReportCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (actor.role !== "admin" && actor.role !== "employee") return null;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return null;
  const own = actor.role !== "admin";
  const row = db.prepare(`SELECT ${columns} FROM work_reports WHERE id=?${own ? " AND employee_name=?" : ""}`)
    .get(n, ...(own ? [actor.name] : [])) as ReportCardRow | undefined;
  if (!row) return null;
  const { title, subtitle } = card(row);
  return { title, subtitle };
}
