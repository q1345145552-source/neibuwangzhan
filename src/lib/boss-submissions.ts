import type Database from "better-sqlite3";
import { BOSS_SUBMISSION_TYPES, bossSubmissionHref, reportSubmissionRevision, reflectionSubmissionRevision, type BossSubmissionCategory } from "./boss-submission-types";

export function ensureBossSubmissionSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS boss_submission_state (
    category TEXT NOT NULL, source_id INTEGER NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0, submitted_at TEXT NOT NULL DEFAULT '',
    viewed_revision TEXT NOT NULL DEFAULT '', viewed_at TEXT NOT NULL DEFAULT '', viewed_by TEXT NOT NULL DEFAULT '',
    confirmed_at TEXT NOT NULL DEFAULT '', confirmed_by TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(category, source_id)
  )`);
}

/** 在业务提交事务内调用；每次真实提交一轮，退回重提会重置已阅/确认并重新通知。 */
export function publishBossSubmission(db: Database.Database, category: BossSubmissionCategory, sourceId: number, employee: string, summary: string) {
  if (!db.prepare("SELECT 1 FROM employees WHERE name=? AND role='employee'").get(employee)) return;
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO boss_submission_state(category,source_id,generation,submitted_at) VALUES (?,?,1,?)
    ON CONFLICT(category,source_id) DO UPDATE SET generation=generation+1,submitted_at=excluded.submitted_at,
    viewed_revision='',viewed_at='',viewed_by='',confirmed_at='',confirmed_by=''`).run(category, sourceId, stamp);
  const bosses = db.prepare("SELECT DISTINCT name FROM employees WHERE role='admin' AND status IN ('在职','试用期','待离职') AND name<>''").all() as { name: string }[];
  const insert = db.prepare("INSERT INTO notifications(type,title,body,recipient,related_type,related_id,created_at) VALUES ('',?,?,?,'boss_submission',?,?)");
  for (const boss of bosses) insert.run(BOSS_SUBMISSION_TYPES[category].title, `${employee}：${summary.slice(0, 600)}`, boss.name, `${category}:${sourceId}`, stamp);
}

export function acknowledgeBossSubmission(db: Database.Database, category: "report" | "meeting" | "todo", id: number, actor: string, revision = "") {
  const stamp = new Date().toISOString();
  if (category === "todo") {
    db.prepare(`INSERT INTO boss_submission_state(category,source_id,confirmed_at,confirmed_by) VALUES ('todo',?,?,?)
      ON CONFLICT(category,source_id) DO UPDATE SET confirmed_at=CASE WHEN confirmed_at='' THEN excluded.confirmed_at ELSE confirmed_at END,
      confirmed_by=CASE WHEN confirmed_at='' THEN excluded.confirmed_by ELSE confirmed_by END`).run(id, stamp, actor);
  } else {
    db.prepare(`INSERT INTO boss_submission_state(category,source_id,viewed_revision,viewed_at,viewed_by) VALUES (?,?,?,?,?)
      ON CONFLICT(category,source_id) DO UPDATE SET viewed_revision=excluded.viewed_revision,viewed_at=excluded.viewed_at,viewed_by=excluded.viewed_by`).run(category, id, revision, stamp, actor);
  }
}

export interface BossPendingItem {
  id: string; category: BossSubmissionCategory; category_label: string; source_id: number;
  employee_id: number; employee_name: string; summary: string; submitted_at: string; href: string;
}
type Candidate = { id: number; employee_name: string; submitted_at: string; summary: string };
const utc = (raw: string) => {
  const value = raw && !/Z$|[+-]\d\d:\d\d$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : "";
};

/** 只读聚合当前业务状态，审批/验收后自然移除；不依赖消息已读、不扫逾期。 */
export function bossPendingSubmissions(db: Database.Database) {
  const people = new Map((db.prepare("SELECT MIN(id) id,name FROM employees WHERE role='employee' GROUP BY name").all() as { id: number; name: string }[]).map(e => [e.name, e.id]));
  const items: BossPendingItem[] = [];
  function add(category: BossSubmissionCategory, rows: Candidate[]) {
    for (const row of rows) {
      const employeeId = people.get(row.employee_name); if (!employeeId) continue;
      items.push({ id: `${category}:${row.id}`, category, category_label: BOSS_SUBMISSION_TYPES[category].label, source_id: row.id,
        employee_id: employeeId, employee_name: row.employee_name, summary: row.summary.slice(0, 600), submitted_at: utc(row.submitted_at), href: bossSubmissionHref(category, row.id) });
    }
  }
  add("leave", db.prepare("SELECT id,employee_name,created_at submitted_at,leave_type||' '||start_date||' '||start_time||' 至 '||end_date||' '||end_time summary FROM leave_requests WHERE status='待审批'").all() as Candidate[]);
  add("attendance", db.prepare("SELECT id,employee_name,created_at submitted_at,date||' '||time||' 补签：'||COALESCE(reason,'') summary FROM attendance_requests WHERE status='待审批'").all() as Candidate[]);
  add("notice", db.prepare(`SELECT r.id,r.employee_name,r.submitted_at,n.title||'：'||r.statement summary
    FROM notice_rule_implementations r JOIN notice_rules n ON n.id=r.notice_id
    WHERE r.review_status='还没处理' AND r.submitted_at IS NOT NULL AND r.submitted_at<>'' AND r.printed=1 AND r.statement<>'' AND r.photos<>'[]'`).all() as Candidate[]);
  type Report = Candidate & { submitted_at: string; created_at: string; viewed_revision: string | null; boss_rating: number; boss_comment: string; generation: number | null };
  const reports = db.prepare(`SELECT r.*,r.report_date||' 的日报' summary,s.viewed_revision,s.generation FROM work_reports r
    LEFT JOIN boss_submission_state s ON s.category='report' AND s.source_id=r.id WHERE r.status='已提交'`).all() as Report[];
  add("report", reports.filter(r => r.viewed_revision !== reportSubmissionRevision(r) && !(r.generation == null && (r.boss_rating > 0 || r.boss_comment?.trim())))
    .map(r => ({ ...r, submitted_at: r.submitted_at || r.created_at })));
  type Reflection = Candidate & { created_at: string; updated_at: string; content: string; images: string; viewed_revision: string | null; last_submitted_at: string | null };
  const reflections = db.prepare(`SELECT r.*,m.title||'：'||r.content summary,s.viewed_revision,s.submitted_at last_submitted_at
    FROM meeting_reflections r JOIN meetings m ON m.id=r.meeting_id
    LEFT JOIN boss_submission_state s ON s.category='meeting' AND s.source_id=r.id WHERE r.status='已提交'`).all() as Reflection[];
  add("meeting", reflections.filter(r => r.viewed_revision !== reflectionSubmissionRevision(r)).map(r => ({ ...r, submitted_at: r.last_submitted_at || r.updated_at || r.created_at })));
  add("todo", db.prepare(`SELECT t.id,t.assignee employee_name,t.created_at submitted_at,t.content summary
    FROM todos t WHERE t.status='未完成'`).all() as Candidate[]);
  add("problem", db.prepare(`SELECT p.id,p.assignee employee_name,COALESCE(NULLIF(s.submitted_at,''),p.updated_at) submitted_at,
    p.problem_number||' '||p.company_name||'：'||p.resolve_note summary FROM problems p
    LEFT JOIN boss_submission_state s ON s.category='problem' AND s.source_id=p.id WHERE p.status='老板验收'`).all() as Candidate[]);
  add("withdrawal", db.prepare("SELECT id,employee_name,created_at submitted_at,'申请提现 '||amount||' 积分' summary FROM point_withdrawals WHERE status='待审核'").all() as Candidate[]);
  items.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || a.id.localeCompare(b.id));
  const counts = Object.fromEntries(Object.keys(BOSS_SUBMISSION_TYPES).map(key => [key, items.filter(item => item.category === key).length]));
  return { generated_at: new Date().toISOString(), total: items.length, counts, items };
}
