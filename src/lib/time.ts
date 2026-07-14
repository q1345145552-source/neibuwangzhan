/**
 * 服务端时间工具：业务时区为泰国曼谷 (UTC+7)。
 * 数据库中的时间戳统一存 UTC（"YYYY-MM-DD HH:MM:SS"），
 * 但"哪一天"（考勤日期、今天的待办等）必须按曼谷本地日历计算，
 * 否则曼谷早上 7 点前的操作会被记到前一天。
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 当前曼谷日期，格式 YYYY-MM-DD */
export function bangkokToday(): string {
  return new Date(Date.now() + BANGKOK_OFFSET_MS).toISOString().split("T")[0];
}

/** 当前 UTC 时间戳，格式 "YYYY-MM-DD HH:MM:SS"（与 sqlite datetime('now') 一致） */
export function utcNowStr(): string {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

/**
 * 曼谷本地 HH:MM 对应的 UTC 时刻字符串（同一个曼谷日期下），
 * 用于和存储为 UTC 的打卡时间做比较。
 * 例：bangkokTimeToUtc("2026-07-15", "09:00") => "2026-07-15 02:00:00"
 */
export function bangkokTimeToUtc(bangkokDate: string, hhmm: string): string {
  const d = new Date(`${bangkokDate}T${hhmm}:00+07:00`);
  return d.toISOString().replace("T", " ").split(".")[0];
}
