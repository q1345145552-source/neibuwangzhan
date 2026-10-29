import type Database from "better-sqlite3";
import { reportSubmissionRevision } from "./boss-submission-types";

type Report = { id: number; submitted_at?: string; created_at?: string; boss_rating?: number };
type SeenState = { source_id: number; generation: number; viewed_revision: string; viewed_by: string; viewed_at: string };
/** 与监督清单共用当前提交版本；重交后的旧打分不能把新版自动算已看。 */
export function withWorkReportSeen<T extends Report>(db: Database.Database, reports: T[]) {
  const states = new Map((db.prepare("SELECT source_id,generation,viewed_revision,viewed_by,viewed_at FROM boss_submission_state WHERE category='report'").all() as SeenState[]).map(state=>[state.source_id,state]));
  return reports.map(report=>{
    const state = states.get(report.id);
    const seen = !!state?.viewed_revision && state.viewed_revision === reportSubmissionRevision(report);
    return {...report, boss_seen: seen || (!state && (report.boss_rating || 0) > 0), boss_seen_by: seen ? state.viewed_by : "", boss_seen_at: seen ? state.viewed_at : ""};
  });
}
