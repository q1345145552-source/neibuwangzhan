import type Database from "better-sqlite3";
import { normalizeCompletedItems, completedItemText } from "./work-report-items";
import type { PersonalWorkspace, WorkspaceGroup } from "./workspace-types";

type Identity = { id: number; name: string; role: string };
type Row = { id: string; title: string; summary: string; time: string; order_id?: string | null; filename?: string; folder_id?: number | null; completed_items?: string; note_name?: string; original_name?: string };
// 与会议列表相同：只接受参会人数组，按完整姓名匹配，不能用子串判断权限。
const participantScope = `EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(participants) AND json_type(participants) = 'array' THEN participants ELSE '[]' END) p WHERE p.type = 'text' AND trim(p.value) = ?)`;
const contains = (columns: string[]) => `(${columns.map(c => `instr(lower(COALESCE(${c}, '')), lower(?)) > 0`).join(" OR ")})`;

export function businessGroups(db: Database.Database, user: Identity, mine: boolean, keyword = ""): WorkspaceGroup[] {
  const admin = !mine && user.role === "admin";
  const run = (select: string, scope: string, scopeArgs: string[], columns: string[], order: string): Row[] => {
    const conditions = scope ? [scope] : [];
    const args = [...scopeArgs];
    if (keyword) { conditions.push(contains(columns)); args.push(...columns.map(() => keyword)); }
    return db.prepare(`${select}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${order}`).all(...args) as Row[];
  };
  const groups: WorkspaceGroup[] = [];
  const add = (type: WorkspaceGroup["type"], label: string, rows: Row[], href: (r: Row) => string) => groups.push({type, label, items: rows.map(r => ({id: String(r.id), type, title: r.title || label, summary: r.summary || (r.completed_items ? normalizeCompletedItems(r.completed_items).map(completedItemText).join("；") : ""), time: r.time || "", href: href(r)}))});
  add("meetings", "会议", run("SELECT id, title, meeting_date AS time, agenda AS summary FROM meetings", admin ? "" : participantScope, admin ? [] : [user.name], ["title", "topics"], "meeting_date DESC, id DESC"), r => `/meetings?meeting=${encodeURIComponent(r.id)}`);
  add("reports", "日报", run("SELECT id, employee_name || ' · ' || report_date AS title, report_date AS time, completed_items, COALESCE(NULLIF(summary, ''), problems, '') AS summary FROM work_reports", admin ? "" : "employee_name = ?", admin ? [] : [user.name], ["completed_items", "summary", "tomorrow_plan", "problems", "completed_items_zh", "summary_zh", "tomorrow_plan_zh", "problems_zh"], "report_date DESC, id DESC"), r => `/work-reports?report=${encodeURIComponent(r.id)}`);
  add("todos", "待办", run("SELECT id, content AS title, created_at AS time, status || ' · ' || COALESCE(assignee, '') AS summary FROM todos", admin ? "" : "assignee = ?", admin ? [] : [user.name], ["content", "content_zh"], "created_at DESC, id DESC"), r => `/todos?todo=${encodeURIComponent(r.id)}`);
  add("orders", "订单", run("SELECT o.id, o.id || ' · ' || o.customer_name AS title, o.created_at AS time, COALESCE(bt.name, '') || ' · ' || o.status AS summary FROM orders o LEFT JOIN business_types bt ON bt.id = o.business_type_id", mine ? "o.responsible_person = ?" : "", mine ? [user.name] : [], ["o.id", "o.customer_name", "bt.name", "o.trademark_name", "o.description"], "o.created_at DESC, o.id DESC"), r => `/orders/${encodeURIComponent(r.id)}`);
  return groups;
}

export function personalWorkspace(db: Database.Database, user: Identity): PersonalWorkspace {
  const groups = businessGroups(db, user, true);
  const folders = db.prepare("SELECT id, name FROM personal_folders WHERE owner_id = ? ORDER BY id").all(user.id) as PersonalWorkspace["folders"];
  // 重新按当前权限解析引用；已删记录、转派给他人的记录不会通过收藏再次泄露。
  const visible = new Set(groups.flatMap(g => g.items.map(r => `${r.type}:${r.id}`)));
  const memberships = (db.prepare("SELECT r.* FROM personal_folder_records r JOIN personal_folders f ON f.id = r.folder_id WHERE f.owner_id = ?").all(user.id) as PersonalWorkspace["memberships"]).filter(r => visible.has(`${r.record_type}:${r.record_id}`));
  const files = (db.prepare(`SELECT f.filename AS id, f.folder_id, f.note_name, COALESCE(NULLIF(u.original_name, ''), f.filename) AS original_name, COALESCE(NULLIF(f.note_name, ''), NULLIF(u.original_name, ''), f.filename) AS title,
    f.created_at AS time, '' AS summary FROM personal_files f JOIN file_uploads u ON u.filename = f.filename WHERE f.owner_id = ? ORDER BY f.created_at DESC, f.filename`).all(user.id) as Row[]).map(r => ({id: r.id, folder_id: r.folder_id ?? null, note_name: r.note_name, original_name: r.original_name, type: "files" as const, title: r.title, summary: "上传的文件", time: r.time, href: `/api/files/${encodeURIComponent(r.id)}`}));
  return {groups, folders, memberships, files};
}

export function globalSearch(db: Database.Database, user: Identity, keyword: string): WorkspaceGroup[] {
  const groups = businessGroups(db, user, false, keyword);
  const docs = db.prepare(`SELECT id, name AS title, created_at AS time, COALESCE(order_id, '') AS summary FROM documents WHERE ${contains(["name"])} ORDER BY created_at DESC, id DESC`).all(keyword) as Row[];
  groups.push({type: "documents", label: "文档", items: docs.map(r => ({...r, id:String(r.id), type:"documents", href:`/documents?search=${encodeURIComponent(r.title)}`}))});
  const customers = db.prepare(`SELECT id, company_name AS title, status AS summary, updated_at AS time FROM customers WHERE ${contains(["company_name"])} ${user.role === "admin" ? "" : "AND (claimed_by IS NULL OR claimed_by = '' OR claimed_by = ?)"} ORDER BY updated_at DESC, id DESC`).all(keyword, ...(user.role === "admin" ? [] : [user.name])) as Row[];
  groups.push({type:"customers", label:"客户", items:customers.map(r => ({...r,id:String(r.id),type:"customers",href:`/customers/${encodeURIComponent(r.id)}`}))});
  // 原始上传名 + 历史文档/员工档案名称。员工档案和个人文件继续按所有者隔离。
  const files = db.prepare(`SELECT u.filename AS id,
      COALESCE((SELECT NULLIF(p.note_name,'') FROM personal_files p WHERE p.filename=u.filename AND p.owner_id=?), NULLIF(u.original_name,''), (SELECT d.name FROM documents d WHERE d.file_url = '/api/files/' || u.filename LIMIT 1), (SELECT e.original_name FROM employee_files e WHERE e.filename = u.filename LIMIT 1), substr(u.filename, instr(u.filename, '_') + 1)) AS title,
      u.created_at AS time, '上传的文件' AS summary
    FROM file_uploads u
    WHERE NOT EXISTS(SELECT 1 FROM personal_files p WHERE p.filename = u.filename AND p.owner_id <> ?)
      AND (? = 'admin' OR u.uploaded_by_id = ? OR EXISTS(SELECT 1 FROM documents d WHERE d.file_url = '/api/files/' || u.filename) OR EXISTS(SELECT 1 FROM employee_files e WHERE e.filename = u.filename AND e.employee_id = ?))
      AND (? = 'admin' OR NOT EXISTS(SELECT 1 FROM employee_files e WHERE e.filename = u.filename AND e.employee_id <> ?))
      AND (${contains(["u.original_name", "u.filename", "(SELECT p.note_name FROM personal_files p WHERE p.filename=u.filename)"])} OR EXISTS(SELECT 1 FROM documents d WHERE d.file_url = '/api/files/' || u.filename AND ${contains(["d.name"])}) OR EXISTS(SELECT 1 FROM employee_files e WHERE e.filename = u.filename AND ${contains(["e.original_name"])}))
    ORDER BY u.created_at DESC, u.filename`).all(user.id, user.id, user.role, user.id, user.id, user.role, user.id, keyword, keyword, keyword, keyword, keyword) as Row[];
  groups.push({type:"files",label:"文件",items:files.map(r=>({...r,id:r.id,type:"files",href:`/api/files/${encodeURIComponent(r.id)}`}))});
  const order = ["orders", "documents", "meetings", "reports", "todos", "customers", "files"];
  return groups.sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type));
}
