export const BOSS_SUBMISSION_TYPES = {
  leave: { label: "请假申请", title: "员工提交了请假申请" },
  attendance: { label: "考勤补签", title: "员工提交了补签申请" },
  notice: { label: "通知/规则落实", title: "员工提交了通知落实" },
  report: { label: "日报", title: "员工提交了日报" },
  meeting: { label: "会议心得", title: "员工提交了会议心得" },
  todo: { label: "未完成待办", title: "员工完成了待办" },
  problem: { label: "问题跟踪", title: "员工提交了问题验收" },
  withdrawal: { label: "积分提现", title: "员工提交了积分提现" },
} as const;
export type BossSubmissionCategory = keyof typeof BOSS_SUBMISSION_TYPES;

export function bossSubmissionHref(category: BossSubmissionCategory, id: string | number): string {
  const links = { leave: `/internal/leave?leave=${encodeURIComponent(id)}`, attendance: `/internal?attendance_request=${encodeURIComponent(id)}#attendance-requests`, notice: `/notice-rules?implementation=${encodeURIComponent(id)}`,
    report: `/work-reports?report=${encodeURIComponent(id)}`, meeting: `/meetings?reflection=${encodeURIComponent(id)}`, todo: `/todos?todo=${encodeURIComponent(id)}`,
    problem: `/problems/${encodeURIComponent(id)}`, withdrawal: `/customers?withdrawals=1&withdrawal=${encodeURIComponent(id)}` };
  return links[category];
}

// 看板分类独立于提交通知：提现通知继续保留，工单只进入看板。
export const BOSS_PENDING_TYPES = {
  leave: BOSS_SUBMISSION_TYPES.leave,
  attendance: BOSS_SUBMISSION_TYPES.attendance,
  notice: BOSS_SUBMISSION_TYPES.notice,
  report: BOSS_SUBMISSION_TYPES.report,
  meeting: BOSS_SUBMISSION_TYPES.meeting,
  todo: BOSS_SUBMISSION_TYPES.todo,
  problem: BOSS_SUBMISSION_TYPES.problem,
  issue: { label: "工单" },
} as const;
export type BossPendingCategory = keyof typeof BOSS_PENDING_TYPES;

export function bossPendingHref(category: BossPendingCategory, id: string | number): string {
  return category === "issue" ? `/issues?open=${encodeURIComponent(id)}` : bossSubmissionHref(category, id);
}

// 不使用 AI/老板点评/翻译更新时间作版本：只有员工本次提交的正文才参与已阅匹配。
export function reportSubmissionRevision(row: { submitted_at?: string; created_at?: string }): string {
  return row.submitted_at || row.created_at || "";
}
export function reflectionSubmissionRevision(row: { updated_at: string; content: string; images: string }): string {
  return JSON.stringify([row.updated_at, row.content, row.images]);
}
