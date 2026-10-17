import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

export interface ReviewRecord {
  id: number; notice_id: number; employee_id: number; employee_name: string;
  printed: number; printed_at: string | null; photos: string; statement: string;
  boss_comment: string; review_status: "还没处理" | "通过" | "打回";
  submitted_at: string | null; reviewed_at: string | null;
}

export const REVIEW_COLUMNS = "id, notice_id, employee_id, employee_name, printed, printed_at, photos, statement, boss_comment, review_status, submitted_at, reviewed_at";

/** 绑定老板看到的那次提交，打回重提或已被验收后，旧页面不能误审新内容。 */
export function submissionToken(row: ReviewRecord): string {
  return createHash("sha256").update(JSON.stringify([row.id, row.submitted_at, row.photos, row.statement, row.review_status, row.reviewed_at])).digest("hex");
}

export function reviewDetails(db: Database.Database, noticeId: number) {
  const rows = db.prepare(`SELECT ${REVIEW_COLUMNS} FROM notice_rule_implementations WHERE notice_id=? ORDER BY id`).all(noticeId) as ReviewRecord[];
  const statistics = {
    total: rows.length,
    passed: rows.filter(r => r.review_status === "通过").length,
    returned: rows.filter(r => r.review_status === "打回").length,
    pending: rows.filter(r => !!r.submitted_at && r.review_status === "还没处理").length,
    not_submitted: rows.filter(r => !r.submitted_at).length,
    untouched: rows.filter(r => !r.printed && !r.submitted_at).length,
  };
  return { statistics, records: rows.map(row => {
    let photos: string[] = [];
    try { const parsed: unknown = JSON.parse(row.photos); if (Array.isArray(parsed)) photos = parsed.filter((v): v is string => typeof v === "string" && /^\/api\/files\/[a-zA-Z0-9._-]+$/.test(v)); } catch { /* 空照片仍可显示其他落实信息 */ }
    return { ...row, photos, status: row.review_status === "通过" ? "已通过" : row.review_status === "打回" ? "已打回" : row.submitted_at ? "已提交等验收" : "还没处理", submission_token: submissionToken(row) };
  }) };
}

export type ReviewDetails = ReturnType<typeof reviewDetails>;
export type AdminReviewRecord = ReviewDetails["records"][number];
