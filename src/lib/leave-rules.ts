import type Database from "better-sqlite3";

/** 硬规则标出的异常标记 */
export interface LeaveFlag {
  /** 规则名：频率异常 / 病假异常 / 日期异常 / 理由重复 */
  rule: string;
  /** 具体说明，如「一个月请假 3 次」 */
  detail: string;
  /** 严重程度：异常（红）/ 可疑（黄） */
  severity: "异常" | "可疑";
}

function dayCount(startDate: string, endDate: string): number {
  const s = new Date(startDate + "T00:00:00").getTime();
  const e = new Date(endDate + "T00:00:00").getTime();
  return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

/**
 * 用固定规则给每条请假打异常标记（不用 AI）：
 * 1. 频率异常：同一员工同一个月请假超过 2 次
 * 2. 病假异常：同一员工同一个月病假超过 1 天
 * 3. 日期异常：连续两次请假都在周一或都在周六
 * 4. 理由重复：同一个请假理由用了 2 次（可疑）
 * 返回 leave_id -> 标记列表
 */
export function computeLeaveRules(db: Database.Database): Map<number, LeaveFlag[]> {
  const leaves = db.prepare(
    "SELECT id, employee_name, leave_type, start_date, end_date, reason FROM leave_requests ORDER BY employee_name, start_date, id"
  ).all() as { id: number; employee_name: string; leave_type: string; start_date: string; end_date: string; reason: string }[];

  const flags = new Map<number, LeaveFlag[]>();
  const add = (id: number, rule: string, detail: string, severity: "异常" | "可疑") => {
    if (!flags.has(id)) flags.set(id, []);
    const arr = flags.get(id)!;
    if (!arr.some((f) => f.rule === rule)) arr.push({ rule, detail, severity });
  };

  // 规则 1：频率异常 —— 同一员工同一个月请假超过 2 次
  const monthCount = new Map<string, { count: number; ids: number[] }>();
  for (const l of leaves) {
    const month = l.start_date.slice(0, 7);
    const key = `${l.employee_name}|${month}`;
    const e = monthCount.get(key) || { count: 0, ids: [] };
    e.count++;
    e.ids.push(l.id);
    monthCount.set(key, e);
  }
  for (const e of monthCount.values()) {
    if (e.count > 2) {
      for (const id of e.ids) add(id, "频率异常", `一个月请假 ${e.count} 次`, "异常");
    }
  }

  // 规则 2：病假异常 —— 同一员工同一个月病假超过 1 天
  const sickMonth = new Map<string, { days: number; ids: number[] }>();
  for (const l of leaves) {
    if (l.leave_type !== "病假") continue;
    const month = l.start_date.slice(0, 7);
    const key = `${l.employee_name}|${month}`;
    const e = sickMonth.get(key) || { days: 0, ids: [] };
    e.days += dayCount(l.start_date, l.end_date);
    e.ids.push(l.id);
    sickMonth.set(key, e);
  }
  for (const e of sickMonth.values()) {
    if (e.days > 1) {
      for (const id of e.ids) add(id, "病假异常", `一个月病假 ${e.days} 天`, "异常");
    }
  }

  // 规则 3：日期异常 —— 连续两次请假都在周一或都在周六
  const byEmp = new Map<string, { id: number; start_date: string; day: number }[]>();
  for (const l of leaves) {
    const day = new Date(l.start_date + "T00:00:00").getDay();
    if (!byEmp.has(l.employee_name)) byEmp.set(l.employee_name, []);
    byEmp.get(l.employee_name)!.push({ id: l.id, start_date: l.start_date, day });
  }
  for (const arr of byEmp.values()) {
    arr.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : a.id - b.id));
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      if ((a.day === 1 && b.day === 1) || (a.day === 6 && b.day === 6)) {
        const label = a.day === 1 ? "周一" : "周六";
        add(a.id, "日期异常", `连续两次请假都在${label}`, "异常");
        add(b.id, "日期异常", `连续两次请假都在${label}`, "异常");
      }
    }
  }

  // 规则 4：理由重复 —— 同一个请假理由用了 2 次（可疑）
  const reasonCount = new Map<string, number>();
  for (const l of leaves) {
    const r = (l.reason || "").trim();
    if (!r) continue;
    const key = `${l.employee_name}|${r}`;
    reasonCount.set(key, (reasonCount.get(key) || 0) + 1);
  }
  for (const l of leaves) {
    const r = (l.reason || "").trim();
    if (!r) continue;
    const key = `${l.employee_name}|${r}`;
    if ((reasonCount.get(key) || 0) >= 2) {
      add(l.id, "理由重复", "同一个请假理由用了 2 次", "可疑");
    }
  }

  return flags;
}
