/**
 * 订单步骤状态（2026-10-16 加「已跳过」）：用不上的步骤（如「如需补资料」「未通过重新注册」）不再假装点完成。
 * 已跳过算「这一步不用办了」：整单是否办完、前一步是否做完都把它当成已完成；耗时统计不算它。
 */
export const STEP_STATUSES = ["待处理", "进行中", "已完成", "阻塞", "已跳过"] as const;
export const STEP_SKIPPED = "已跳过";
/** 这一步不用再办了：已完成或已跳过 */
export const isStepClosed = (status: string | null | undefined) => status === "已完成" || status === STEP_SKIPPED;
/** 按步骤算整单状态（取消状态由调用方另外处理） */
export function orderStatusFromSteps(statuses: string[]): string | null {
  if (!statuses.length) return null;
  if (statuses.every(isStepClosed)) return "已完成";
  return statuses.some((s) => s === "进行中" || s === "阻塞" || isStepClosed(s)) ? "进行中" : "待处理";
}
