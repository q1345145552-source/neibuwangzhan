/**
 * 全系统时间工具：业务时区统一为泰国曼谷 (UTC+7)。
 *
 * 原则：
 * 1. 数据库时间戳统一存 UTC（"YYYY-MM-DD HH:MM:SS"）
 * 2. 后端所有"今天/本周/本月"的日期边界调本文件函数，不直接 new Date()
 * 3. 前端所有 UTC→显示 调 toThaiTime() / toThaiDate()
 * 4. 考勤日期、周报周期、导出的文件名一律以曼谷日历为准
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

// ── 内部辅助 ──
function toBangkokDate(ms?: number): Date {
  return new Date((ms ?? Date.now()) + BANGKOK_OFFSET_MS);
}

function utcFromBangkok(y: number, m: number, d: number, h = 0, min = 0, s = 0): Date {
  return new Date(Date.UTC(y, m, d, h - 7, min, s));
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ── 对外 API ──

/** 当前曼谷日期，格式 YYYY-MM-DD */
export function bangkokToday(): string {
  return toBangkokDate().toISOString().split("T")[0];
}

/** 当前 UTC 时间戳，格式 "YYYY-MM-DD HH:MM:SS"（与 sqlite datetime('now') 一致） */
export function utcNowStr(): string {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

/** 曼谷本地 HH:MM 对应的 UTC 时刻字符串 */
export function bangkokTimeToUtc(bangkokDate: string, hhmm: string): string {
  const d = new Date(`${bangkokDate}T${hhmm}:00+07:00`);
  return d.toISOString().replace("T", " ").split(".")[0];
}

// ── 日期范围（用于 SQL WHERE created_at BETWEEN ? AND ?）──

/** 曼谷日期对应的一整天 UTC 范围 [start, end) */
export function bangkokDayRange(dateStr: string): { start: string; end: string } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return {
    start: utcFromBangkok(y, m - 1, d).toISOString().replace("T", " ").split(".")[0],
    end: utcFromBangkok(y, m - 1, d + 1).toISOString().replace("T", " ").split(".")[0],
  };
}

/** 曼谷日期对应的月份 UTC 范围 [start, end) */
export function bangkokMonthRange(year: number, month: number): { start: string; end: string } {
  return {
    start: utcFromBangkok(year, month - 1, 1).toISOString().replace("T", " ").split(".")[0],
    end: utcFromBangkok(year, month, 1).toISOString().replace("T", " ").split(".")[0],
  };
}

/** 曼谷日期对应的周范围（周一开始）UTC [start, end) */
export function bangkokWeekRange(dateStr?: string): { start: string; end: string } {
  const bkk = dateStr
    ? toBangkokDate(new Date(dateStr + "T00:00:00+07:00").getTime())
    : toBangkokDate();
  const dow = bkk.getUTCDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(bkk);
  mon.setUTCDate(bkk.getUTCDate() + monOffset);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 7);
  return {
    start: utcFromBangkok(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())
      .toISOString().replace("T", " ").split(".")[0],
    end: utcFromBangkok(sun.getUTCFullYear(), sun.getUTCMonth(), sun.getUTCDate())
      .toISOString().replace("T", " ").split(".")[0],
  };
}

/** 曼谷当月 YYYY-MM */
export function bangkokMonthKey(): string {
  return bangkokToday().slice(0, 7);
}

/** 曼谷现在完整格式化 YYYY-MM-DD HH:mm:ss */
export function bangkokNowStr(): string {
  const bkk = toBangkokDate();
  return `${bkk.getUTCFullYear()}-${pad(bkk.getUTCMonth() + 1)}-${pad(bkk.getUTCDate())} ${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}:${pad(bkk.getUTCSeconds())}`;
}

// ── 前端显示（UTC 字符串 → 曼谷本地字符串）──

/** UTC 字符串 → 曼谷完整时间 "YYYY-MM-DD HH:mm" */
export function toThaiTime(utcStr: string | null | undefined): string {
  if (!utcStr) return "";
  const str =
    utcStr.includes("Z") || utcStr.includes("+") || (utcStr.match(/-/g) || []).length > 2
      ? utcStr
      : utcStr.replace(" ", "T") + "Z";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  const bkk = toBangkokDate(d.getTime());
  return `${bkk.getUTCFullYear()}-${pad(bkk.getUTCMonth() + 1)}-${pad(bkk.getUTCDate())} ${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}`;
}

/** UTC 字符串 → 曼谷日期 "YYYY-MM-DD" */
export function toThaiDate(utcStr: string | null | undefined): string {
  const full = toThaiTime(utcStr);
  return full ? full.slice(0, 10) : "";
}

/** UTC 字符串 → 曼谷时间 "HH:mm" */
export function toThaiTimeOnly(utcStr: string | null | undefined): string {
  const full = toThaiTime(utcStr);
  return full ? full.slice(11, 16) : "";
}

/** 曼谷 YYYY-MM 转当月最后一天 */
export function bangkokLastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getDate();
}

/** 曼谷某一天是周几（0=周日） */
export function bangkokDayOfWeek(dateStr: string): number {
  return toBangkokDate(new Date(dateStr + "T00:00:00+07:00").getTime()).getUTCDay();
}

/** 曼谷日期字符串（用于 export 文件名等前端场景） */
export function bangkokDateStr(): string {
  return bangkokToday();
}
