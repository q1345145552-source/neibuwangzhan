export const WORK_REPORT_REQUIRED_FROM = "2026-10-19";

/** 固定使用曼谷日历，17:00 起可检查当天；不会回扫启用日期之前的欠交。 */
export function workReportTodoSchedule(now = Date.now()) {
  const local = new Date(now + 7 * 3_600_000);
  const date = local.toISOString().slice(0, 10);
  return { date, due: date >= WORK_REPORT_REQUIRED_FROM && local.getUTCDay() !== 0 && local.getUTCHours() >= 17 };
}
