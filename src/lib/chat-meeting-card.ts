import type Database from "better-sqlite3";
import { parseMeetingParticipants } from "./meeting-todos";

type Actor = { role: string; name: string };
interface MeetingCardRow { id: number; employee_name: string; title: string; meeting_date: string; status: string; participants: string; }
const columns = "r.id,r.employee_name,r.status,m.title,m.meeting_date,m.participants";
const canShare = (row: MeetingCardRow, actor: Actor) => actor.role === "admin"
  || (row.employee_name === actor.name && parseMeetingParticipants(row.participants).includes(actor.name));
function card(row: MeetingCardRow) {
  return { id: String(row.id), title: `${row.title} · ${row.employee_name} 心得 #${row.id}`, subtitle: `${row.meeting_date} · ${row.status}`, status: row.status };
}

// 使用心得编号，同一员工同一会议的多条心得不合并；卡片不读取心得正文或图片。
export function listMeetingCards(db: Database.Database, actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "employee") return [];
  const own = actor.role !== "admin";
  const rows = db.prepare(`SELECT ${columns} FROM meeting_reflections r JOIN meetings m ON m.id=r.meeting_id
    ${own ? "WHERE r.employee_name=?" : ""} ORDER BY m.meeting_date DESC,r.id DESC`).all(...(own ? [actor.name] : [])) as MeetingCardRow[];
  return rows.filter(row => canShare(row, actor)).map(card);
}

export function resolveMeetingCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (actor.role !== "admin" && actor.role !== "employee") return null;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return null;
  const own = actor.role !== "admin";
  const row = db.prepare(`SELECT ${columns} FROM meeting_reflections r JOIN meetings m ON m.id=r.meeting_id
    WHERE r.id=?${own ? " AND r.employee_name=?" : ""}`).get(n, ...(own ? [actor.name] : [])) as MeetingCardRow | undefined;
  if (!row || !canShare(row, actor)) return null;
  const { title, subtitle } = card(row);
  return { title, subtitle };
}
