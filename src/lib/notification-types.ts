import { BOSS_SUBMISSION_TYPES, bossSubmissionHref, type BossSubmissionCategory } from "./boss-submission-types";
export { announcementFeedbackHref, isAnnouncementRetellFeedback } from "./announcement-feedback";

// 通用消息类型，老板提交提醒由独立 related_type 识别。
// 复述打回/提交沿用「老板通知」，因此列表和未读角标都由现有筛选覆盖，不增删旧类型。
export const MESSAGE_CENTER_TYPES = ["工单指派", "工单完成", "待办指派", "待办完成", "规则更新", "老板通知"] as const;

// 审批反馈复用允许的空类型，以业务关联和标题识别，不改旧类型约束。
export const LEAVE_REVIEW_TITLES = ["请假审批通过", "请假审批驳回"] as const;
export function isLeaveReviewFeedback(notice: { type: string; related_type: string; title: string }): boolean {
  return notice.type === "" && notice.related_type === "leave_review" && LEAVE_REVIEW_TITLES.some(title => title === notice.title);
}
export function leaveReviewNoticeHref(notice: { type: string; related_type: string; title: string; related_id: string }): string | undefined {
  if (!isLeaveReviewFeedback(notice)) return;
  return typeof notice.related_id === "string" && /^[1-9]\d*$/.test(notice.related_id) && Number.isSafeInteger(Number(notice.related_id))
    ? `/internal/leave?leave=${notice.related_id}` : "/internal/leave?leave=invalid";
}

export const ATTENDANCE_REVIEW_TITLES = ["补签审批通过", "补签审批驳回"] as const;
export function isAttendanceReviewFeedback(notice: { type: string; related_type: string; title: string }): boolean {
  return notice.type === "" && notice.related_type === "attendance_review" && ATTENDANCE_REVIEW_TITLES.some(title => title === notice.title);
}
export function attendanceReviewNoticeHref(notice: { type: string; related_type: string; title: string; related_id: string }): string | undefined {
  if (!isAttendanceReviewFeedback(notice)) return;
  return typeof notice.related_id === "string" && /^[1-9]\d*$/.test(notice.related_id) && Number.isSafeInteger(Number(notice.related_id))
    ? `/internal?attendance_request=${notice.related_id}#attendance-requests` : "/internal?attendance_request=invalid#attendance-requests";
}

export const MEETING_REFLECTION_REVIEW_TITLE = "会议心得退回";
export function isMeetingReflectionReview(notice: { type: string; related_type: string; title: string }): boolean {
  return notice.type === "" && notice.related_type === "meeting_reflection_review" && notice.title === MEETING_REFLECTION_REVIEW_TITLE;
}
export function meetingReflectionReviewHref(notice: { type: string; related_type: string; title: string; related_id: string }): string | undefined {
  if (!isMeetingReflectionReview(notice)) return;
  return typeof notice.related_id === "string" && /^[1-9]\d*$/.test(notice.related_id) && Number.isSafeInteger(Number(notice.related_id))
    ? `/meetings?reflection=${notice.related_id}` : "/meetings?reflection=invalid";
}

// 客户站同步来的订单提醒（src/lib/order-alerts.ts 写入）。10-03 老板定：客户站新单、待分类待领取、
// 客户交资料、客户申请取消都要提醒员工。表上类型约束里没有这几类，写入时 type 为空（不动约束），
// 所以按「related_type=order + 这几个标题」认出来，一起放进消息中心。
// 10-15 加：内部商城新单（原来对上业务线的不提醒）、回传客户站一直失败（只发管理员）。
// 10-16 加：上一步办完提醒下一步的人「轮到你了」。
// 10-16 再加：证书快到期（到期前 60、30 天）、步骤超时（超过流程设置里的预计天数）、收入未到账（老板核对为未到账，告诉录入人和负责人）。
export const CUSTOMER_SITE_ALERT_TITLES = ["客户站新订单", "待分类订单待领取", "客户提交了资料", "客户申请取消", "商城新订单", "客户站同步失败", "轮到你了", "证书快到期", "步骤超时", "收入未到账"] as const;

// 老板监督复用空类型通知，按独立 related_type + 明确标题白名单识别，不改旧类型约束。
export const SUPERVISION_ALERT_TITLES = ["监督关键逾期", "监督每日汇总"] as const;
export function isSupervisionAlert(notice: { type: string; related_type: string; title: string }): boolean {
  return notice.type === "" && notice.related_type === "boss_supervision" && SUPERVISION_ALERT_TITLES.some(title => title === notice.title);
}

export function bossSubmissionNoticeHref(notice: { type: string; related_type: string; title: string; related_id: string }): string | undefined {
  if (notice.type !== "" || notice.related_type !== "boss_submission") return;
  const [category, id] = notice.related_id.split(":");
  if (!Object.hasOwn(BOSS_SUBMISSION_TYPES, category) || !/^\d+$/.test(id || "")) return;
  const key = category as BossSubmissionCategory;
  if (notice.title !== BOSS_SUBMISSION_TYPES[key].title) return;
  return bossSubmissionHref(key, id);
}

/** 消息中心的筛选条件：列表和侧栏未读角标共用，保证两边口径一致 */
export function messageCenterFilter(includeSupervision = true): { sql: string; params: string[] } {
  const types = MESSAGE_CENTER_TYPES.map(() => "?").join(",");
  const titles = CUSTOMER_SITE_ALERT_TITLES.map(() => "?").join(",");
  return {
    sql: `(type IN (${types}) OR (type = '' AND related_type = 'order' AND title IN (${titles})) OR (type = '' AND related_type = 'leave_review' AND title IN (${LEAVE_REVIEW_TITLES.map(() => "?").join(",")})) OR (type = '' AND related_type = 'attendance_review' AND title IN (${ATTENDANCE_REVIEW_TITLES.map(() => "?").join(",")})) OR (type = '' AND related_type = 'meeting_reflection_review' AND title = ?) ${includeSupervision ? `OR (type = '' AND related_type = 'boss_supervision' AND title IN (${SUPERVISION_ALERT_TITLES.map(() => "?").join(",")})) OR (type = '' AND related_type = 'boss_submission' AND title IN (${Object.values(BOSS_SUBMISSION_TYPES).map(() => "?").join(",")}))` : ""})`,
    params: [...MESSAGE_CENTER_TYPES, ...CUSTOMER_SITE_ALERT_TITLES, ...LEAVE_REVIEW_TITLES, ...ATTENDANCE_REVIEW_TITLES, MEETING_REFLECTION_REVIEW_TITLE, ...(includeSupervision ? [...SUPERVISION_ALERT_TITLES, ...Object.values(BOSS_SUBMISSION_TYPES).map(type => type.title)] : [])],
  };
}
