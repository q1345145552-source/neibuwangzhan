/** 沿用现有「老板通知」类型，以独立关联区分复述反馈，不变更数据库类型约束。 */
export const ANNOUNCEMENT_RETELL_REJECTED = "announcement_retell_rejected";
export const ANNOUNCEMENT_RETELL_SUBMITTED = "announcement_retell_submitted";

export function isPositiveRecordId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

export function parseAnnouncementFeedbackTarget(value: unknown): { announcementId: string; recipientId: string } | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 2 || !parts.every(isPositiveRecordId)) return null;
  return { announcementId: parts[0], recipientId: parts[1] };
}

export function isAnnouncementRetellFeedback(notice: { type: string; related_type: string }): boolean {
  return notice.type === "老板通知" && [ANNOUNCEMENT_RETELL_REJECTED, ANNOUNCEMENT_RETELL_SUBMITTED].includes(notice.related_type);
}

export function announcementFeedbackHref(notice: { type: string; related_type: string; related_id: string }): string | undefined {
  if (!isAnnouncementRetellFeedback(notice)) return;
  const target = parseAnnouncementFeedbackTarget(notice.related_id);
  return target
    ? `/announcements?open=${target.announcementId}&recipient=${target.recipientId}`
    : "/announcements?feedback=invalid";
}
