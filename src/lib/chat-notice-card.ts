import type Database from "better-sqlite3";

type Actor = { id: number; role: string };
interface NoticeCardRow { id: number; employee_name: string; title: string; review_status: string; submitted_at: string | null; }
const columns = "r.id,r.employee_name,n.title,r.review_status,r.submitted_at";
function card(row: NoticeCardRow) {
  const status = row.review_status === "通过" ? "已通过" : row.review_status === "打回" ? "已打回" : row.submitted_at ? "已提交等验收" : "还没处理";
  return { id: String(row.id), title: `${row.title} · ${row.employee_name} #${row.id}`, subtitle: status, status };
}

// 按个人落实记录编号分享；归属使用员工账号ID，不按姓名猜，也不在卡片中带照片/说明/评论。
export function listNoticeCards(db: Database.Database, actor: Actor) {
  if (actor.role !== "admin" && actor.role !== "employee") return [];
  const own = actor.role !== "admin";
  const rows = db.prepare(`SELECT ${columns} FROM notice_rule_implementations r JOIN notice_rules n ON n.id=r.notice_id
    ${own ? "WHERE r.employee_id=?" : ""} ORDER BY n.published_at DESC,r.id DESC`).all(...(own ? [actor.id] : [])) as NoticeCardRow[];
  return rows.map(card);
}

export function resolveNoticeCard(db: Database.Database, actor: Actor, id: string): { title: string; subtitle: string } | null {
  if (actor.role !== "admin" && actor.role !== "employee") return null;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return null;
  const own = actor.role !== "admin";
  const row = db.prepare(`SELECT ${columns} FROM notice_rule_implementations r JOIN notice_rules n ON n.id=r.notice_id
    WHERE r.id=?${own ? " AND r.employee_id=?" : ""}`).get(n, ...(own ? [actor.id] : [])) as NoticeCardRow | undefined;
  if (!row) return null;
  const { title, subtitle } = card(row);
  return { title, subtitle };
}
