/**
 * 工作时间工具：曼谷时区 (UTC+7)，周一至周六 08:00-17:00。
 * 计算两个时间点之间的实际工作小时数。
 */

const WORK_START = 8;  // 08:00
const WORK_END = 17;   // 17:00

function toBangkok(d: Date): Date {
  // UTC+7
  return new Date(d.getTime() + 7 * 60 * 60 * 1000);
}

/** 判断某一天是不是工作日（周一至周六） */
function isWorkDay(d: Date): boolean {
  const bangkok = toBangkok(d);
  const dow = bangkok.getUTCDay();
  return dow !== 0; // 周日休息
}

/** 给定 UTC 时间，计算当天 08:00-17:00 之间的有效小时数 */
function workHoursOnDay(utcDate: Date): number {
  const bkk = toBangkok(utcDate);
  const hour = bkk.getUTCHours();
  const min = bkk.getUTCMinutes();

  if (!isWorkDay(utcDate)) return 0;

  const startOfWork = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), WORK_START - 7, 0, 0));
  const endOfWork = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), WORK_END - 7, 0, 0));

  if (utcDate < startOfWork) return WORK_END - WORK_START; // before 8AM, full day
  if (utcDate >= endOfWork) return 0; // after 5PM, no hours

  // Between 8AM-5PM
  const elapsedMs = utcDate.getTime() - startOfWork.getTime();
  return elapsedMs / (60 * 60 * 1000);
}

/**
 * 计算两个 UTC 时间之间的工作小时数
 */
function parseUtcDate(raw: Date | string): Date {
  if (raw instanceof Date) return raw;
  let s = raw;
  // DB stores UTC: "2026-07-15 01:48:00" or "2026-07-15" or ISO "2026-07-15T01:48:00Z"
  // Normalize to ISO UTC
  if (s.includes(" ")) s = s.replace(" ", "T") + "Z";
  else if (!s.includes("T")) s += "T00:00:00Z";
  else if (!s.match(/[Z+-]/)) s += "Z";
  return new Date(s);
}

export function calcWorkHours(fromUtc: Date | string, toUtc: Date | string): number {
  const from = parseUtcDate(fromUtc);
  const to = parseUtcDate(toUtc);

  if (from >= to) return 0;

  // 判断是否跨天
  const fromDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const toDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  let totalHours = 0;

  if (fromDay.getTime() === toDay.getTime()) {
    // 同一天
    if (!isWorkDay(from)) return 0;
    const bkkFrom = toBangkok(from);
    const bkkTo = toBangkok(to);
    const fromH = Math.max(bkkFrom.getUTCHours() + bkkFrom.getUTCMinutes() / 60, WORK_START);
    const toH = Math.min(bkkTo.getUTCHours() + bkkTo.getUTCMinutes() / 60, WORK_END);
    if (fromH < toH) totalHours += toH - fromH;
  } else {
    // 跨天：第一天
    if (isWorkDay(from)) {
      totalHours += workHoursOnDay(from);
    }

    // 中间完整的每一天
    let d = new Date(fromDay);
    d.setDate(d.getDate() + 1);
    while (d.getTime() < toDay.getTime()) {
      if (isWorkDay(d)) totalHours += WORK_END - WORK_START;
      d.setDate(d.getDate() + 1);
    }

    // 最后一天
    if (isWorkDay(to)) {
      const bkkTo = toBangkok(to);
      const toH = Math.min(bkkTo.getUTCHours() + bkkTo.getUTCMinutes() / 60, WORK_END);
      if (toH > WORK_START) {
        totalHours += toH - WORK_START;
      }
    }
  }

  return Math.max(0, Math.round(totalHours * 10) / 10);
}

/**
 * 计算从创建时间到现在的已用工作小时数（进行中步骤用）
 */
export function calcElapsedWorkHours(createdAt: string): number {
  return calcWorkHours(createdAt, new Date().toISOString());
}

/**
 * 格式化小时数为显示文本（用于汇总等）
 */
export function formatWorkHours(hours: number): string {
  if (!isFinite(hours) || hours <= 0) return "0h";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * 计算两个时间之间的工作秒数（直接算秒，不经过 calcWorkHours 的舍入）
 * 与 calcWorkHours 同算法，但精度到秒
 */
export function calcWorkSeconds(fromUtc: Date | string, toUtc: Date | string): number {
  const from = parseUtcDate(fromUtc);
  const to = parseUtcDate(toUtc);
  if (from >= to) return 0;

  let totalMs = 0;
  const cursor = new Date(from);

  // 逐个工作日、逐秒累加
  while (cursor < to) {
    const bkk = toBangkok(cursor);
    const dow = bkk.getUTCDay();
    const hour = bkk.getUTCHours() + bkk.getUTCMinutes() / 60 + bkk.getUTCSeconds() / 3600;

    if (dow !== 0 && hour >= WORK_START && hour < WORK_END) {
      // 跳到本小时结束或 to，取较小者
      const hourEnd = new Date(cursor);
      hourEnd.setUTCMinutes(0, 0, 0);
      hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);
      const end = hourEnd < to ? hourEnd : to;
      totalMs += end.getTime() - cursor.getTime();
    }

    // 跳到下一个边界：整点 或 工作日 8am 或 to
    if (dow === 0 || hour >= WORK_END) {
      // 跳到下一天 8am BKK
      const nextDay = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() + 1, WORK_START - 7, 0, 0));
      cursor.setTime(nextDay.getTime());
    } else if (hour < WORK_START) {
      // 今天 8am BKK
      const startToday = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), WORK_START - 7, 0, 0));
      cursor.setTime(startToday.getTime());
    } else {
      // 在 8-17 之间，已经跳过本小时，继续
      const hourEnd = new Date(cursor);
      hourEnd.setUTCMinutes(0, 0, 0);
      hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);
      cursor.setTime(hourEnd.getTime());
    }
  }

  return Math.floor(totalMs / 1000);
}

/**
 * 格式化为 HH:MM:SS（秒表格式，用于计时器显示）
 */
export function formatWorkSeconds(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds <= 0) return "00:00:00";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * 判断是否在工作时间内（用于计时器是否应该走）
 */
export function isWorkingHours(): boolean {
  const now = new Date();
  const bkk = toBangkok(now);
  const dow = bkk.getUTCDay();
  if (dow === 0) return false; // Sunday
  const hour = bkk.getUTCHours();
  return hour >= WORK_START && hour < WORK_END;
}
