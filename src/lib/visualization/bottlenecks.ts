import type { Reader, Row } from './types';
import type { DeliveryRow } from './delivery';
import { unique } from './aggregate';
// Reviewed runtime dependencies: constants + step-status only; Database is a type import.
// Reuse the exact original pure work-calendar functions, not buildHandlingReport's fallbacks.
import { parseDbTime, workDays } from '../handling-report';

export const TIMING_QUERIES = {
  steps: 'SELECT id, order_id, step_order, status, started_at, completed_at, expected_days FROM order_steps ORDER BY order_id, step_order, id',
  holidays: 'SELECT date FROM thai_holidays',
  restarts: "SELECT target_id, MAX(created_at) AS restarted_at FROM audit_logs WHERE target_type = 'step' AND action = '更新步骤:进行中' GROUP BY target_id",
} as const;
export const BOTTLENECK_FILTERS = ['all', 'blocked', 'overdue', 'timing_unknown', 'affected', 'closed_blocked'] as const;
export type BottleneckFilter = typeof BOTTLENECK_FILTERS[number];
export type StepTiming = {
  id: string; name: string; status: string; assignee: string;
  expectedDays: number | null; elapsedDays: number | null; excessDays: number | null;
  since: string | null; sinceBasis: 'restart' | 'started' | 'previous' | 'created' | null;
  overdue: boolean | null; reasons: string[];
};
export type Bottleneck = {
  eligible: boolean; eligibilityUnknown: boolean;
  blockedSteps: DeliveryRow['steps'];
  timing: StepTiming[] | null;
  timingState: 'success' | 'unknown' | 'failed' | 'no_current' | 'closed';
  problems: string[];
};
export type BottleneckRow = DeliveryRow & { bottleneck: Bottleneck };

/** Same accepted timezone convention as parseDbTime, but reject rollover dates/bad fields.
 * Empty is absent; a nonempty invalid candidate is unknown, never a silent fallback.
 */
export function checkedTime(value: unknown): { date: Date | null; invalid: boolean } {
  if (value === null || value === '') return { date: null, invalid: false };
  if (typeof value !== 'string') return { date: null, invalid: true };
  const s = value.trim();
  if (!s) return { date: null, invalid: false };
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(s);
  if (!match) return { date: null, invalid: true };
  const [, y, m, d, hour, minute, second] = match;
  const calendar = new Date(Date.UTC(+y, +m - 1, +d));
  if (calendar.getUTCFullYear() !== +y || calendar.getUTCMonth() !== +m - 1 || calendar.getUTCDate() !== +d ||
      (hour !== undefined && (+hour > 23 || +minute > 59 || +(second || 0) > 59))) return { date: null, invalid: true };
  const date = parseDbTime(s);
  return { date, invalid: !date };
}

export function withBottlenecks(rows: DeliveryRow[], reader: Reader, now: Date): BottleneckRow[] {
  let timeSteps: Row[] | null = null, holidays: Set<string> | null = null, restarts: Row[] | null = null;
  const failures: string[] = [];
  try {
    const result = unique(reader.all(TIMING_QUERIES.steps), 'id');
    if (result.conflicts) throw new Error('CONFLICT');
    timeSteps = result.rows;
  } catch { failures.push('步骤时间读取失败或记录冲突'); }
  try {
    const raw = reader.all(TIMING_QUERIES.holidays);
    if (raw.some(r => typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || checkedTime(r.date).invalid)) throw new Error('INVALID');
    holidays = new Set(raw.map(r => String(r.date))); // Successful empty table is valid.
  } catch { failures.push('泰国假日读取失败或日期无效'); }
  try {
    restarts = reader.all(TIMING_QUERIES.restarts);
    if (restarts.some(r => typeof r.target_id !== 'string' || !Object.hasOwn(r, 'restarted_at'))) throw new Error('INVALID');
  } catch { restarts = null; failures.push('重启时间读取失败'); }

  return rows.map(row => {
    const eligible = ['待处理', '进行中'].includes(row.status);
    const eligibilityUnknown = !eligible && !['已完成', '客户取消'].includes(row.status);
    const blockedSteps = row.steps?.filter(s => s.status === '阻塞') ?? null;
    const problems = [...failures];
    const result = (timing: StepTiming[] | null, timingState: Bottleneck['timingState']): BottleneckRow =>
      ({ ...row, bottleneck: { eligible, eligibilityUnknown, blockedSteps, timing, timingState, problems } });
    if (eligibilityUnknown) { problems.push('订单原状态未能判断，未计入当前催办数'); return result(null, 'unknown'); }
    if (!eligible) return result([], 'closed');
    if (!row.steps) { problems.push('当前步骤无法判断'); return result(null, 'unknown'); }
    const current = row.steps.filter(s => s.current);
    if (!row.steps.length) { problems.push('未记录步骤，不能判断步骤超时'); return result([], 'no_current'); }
    if (!current.length) return result([], 'no_current');
    const list = timeSteps?.filter(s => s.order_id === row.id)
      .sort((a, b) => Number(a.step_order) - Number(b.step_order) || Number(a.id) - Number(b.id)) ?? [];
    const timing: StepTiming[] = current.map(step => {
      const reasons: string[] = [];
      const detail = list.find(s => String(s.id) === step.id);
      let expectedDays: number | null = null;
      if (!detail || detail.status !== step.status) reasons.push('步骤时间关联缺失或状态已变化');
      else if (detail.expected_days === null) reasons.push('未记录建单时预计工作日');
      else if (typeof detail.expected_days !== 'number' || !Number.isFinite(detail.expected_days) || detail.expected_days < 0) reasons.push('预计工作日缺失或无效');
      else expectedDays = detail.expected_days; // 0 is valid, never truthiness-based.
      let since: Date | null = null, sinceBasis: StepTiming['sinceBasis'] = null;
      if (detail && timeSteps && restarts && holidays) {
        const started = checkedTime(detail.started_at);
        const restartRow = restarts.find(r => r.target_id === step.id);
        const restarted = restartRow ? checkedTime(restartRow.restarted_at) : { date: null, invalid: false };
        if (started.invalid || restarted.invalid) reasons.push('开始或重启时间无效');
        else {
          if (restarted.date && (!started.date || restarted.date > started.date)) { since = restarted.date; sinceBasis = 'restart'; }
          else if (started.date) { since = started.date; sinceBasis = 'started'; }
          else {
            const index = list.indexOf(detail);
            const previous = list.slice(0, Math.max(index, 0)).map(s => checkedTime(s.completed_at));
            if (previous.some(p => p.invalid)) reasons.push('前序完成时间无效');
            else {
              since = previous.map(p => p.date).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
              if (since) sinceBasis = 'previous';
              else {
                const created = checkedTime(row.createdAt);
                if (created.invalid || !created.date) reasons.push('建单时间无效或未记录');
                else { since = created.date; sinceBasis = 'created'; }
              }
            }
          }
        }
      }
      if (failures.length) reasons.push(...failures);
      const elapsedDays = since && holidays && !failures.length && !reasons.some(r => /时间无效|关联缺失|状态已变化/.test(r)) ? workDays(since, now, holidays) : null;
      const overdue = expectedDays !== null && elapsedDays !== null ? elapsedDays > expectedDays : null;
      return { id: step.id, name: step.name, status: step.status, assignee: step.assignee,
        expectedDays, elapsedDays, excessDays: overdue === null ? null : Math.max(0, elapsedDays! - expectedDays!),
        since: since?.toISOString() || null, sinceBasis, overdue, reasons };
    });
    return result(timing, failures.length ? 'failed' : timing.some(t => t.overdue === null) ? 'unknown' : 'success');
  });
}

export function matchesBottleneck(row: BottleneckRow, filter: BottleneckFilter): boolean {
  const b = row.bottleneck;
  switch (filter) {
    case 'all': return true;
    case 'blocked': return b.eligible && !!b.blockedSteps?.length;
    case 'overdue': return b.eligible && !!b.timing?.some(t => t.overdue === true);
    case 'closed_blocked': return !b.eligible && !b.eligibilityUnknown && !!b.blockedSteps?.length;
    case 'timing_unknown': return (b.eligible || b.eligibilityUnknown) && (b.timingState === 'unknown' || b.timingState === 'failed' || (row.steps?.length === 0));
    case 'affected': return b.eligible && (!!b.blockedSteps?.length || !!b.timing?.some(t => t.overdue === true) || !!row.counts && (row.counts.step_pending + row.counts.unsubmitted + row.counts.returned > 0));
  }
}
export function bottleneckSummary(rows: BottleneckRow[]) {
  const live = rows.filter(r => r.bottleneck.eligible);
  const blockedKnown = live.filter(r => r.bottleneck.blockedSteps !== null);
  const timingKnown = live.filter(r => r.bottleneck.timingState === 'success' || (r.bottleneck.timingState === 'no_current' && !!r.steps?.length));
  const blockedUnknownOrders = live.length - blockedKnown.length + rows.filter(r => r.bottleneck.eligibilityUnknown).length;
  const scopeUnknownOrders = rows.filter(r => r.bottleneck.eligibilityUnknown).length;
  const timingUnknownOrders = live.length - timingKnown.length + scopeUnknownOrders;
  return {
    blocked: { orders: blockedKnown.filter(r => !!r.bottleneck.blockedSteps?.length).length, steps: blockedKnown.reduce((n, r) => n + (r.bottleneck.blockedSteps?.length || 0), 0), unknownOrders: blockedUnknownOrders },
    overdue: { orders: live.filter(r => r.bottleneck.timing?.some(t => t.overdue === true)).length, steps: live.reduce((n, r) => n + (r.bottleneck.timing?.filter(t => t.overdue === true).length || 0), 0), unknownOrders: timingUnknownOrders },
    unknown: { orders: rows.filter(r => matchesBottleneck(r, 'timing_unknown')).length, steps: live.reduce((n, r) => n + (r.bottleneck.timing?.filter(t => t.overdue === null).length || 0), 0) },
    affectedOrders: live.filter(r => matchesBottleneck(r, 'affected')).length,
    closedBlocked: { orders: rows.filter(r => matchesBottleneck(r, 'closed_blocked')).length, steps: rows.filter(r => !r.bottleneck.eligible && !r.bottleneck.eligibilityUnknown).reduce((n, r) => n + (r.bottleneck.blockedSteps?.length || 0), 0) },
    liveOrders: live.length + scopeUnknownOrders,
    timingFailed: live.some(r => r.bottleneck.timingState === 'failed'),
  };
}
