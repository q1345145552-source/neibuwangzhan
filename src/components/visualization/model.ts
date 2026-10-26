import type { TrendDay } from './trend-model';
import type { Gap, ModuleResult, Money, Row } from '@/lib/visualization/types';
export type DetailSpec = { title: string; from?: string; end?: string; detail: 'orders' | 'parents' | 'finances' | 'billing' | 'pending'; basis?: 'current' | 'period'; subset?: string; status?: string; source?: string; currency?: string; category?: string };
export type Filter = { from: string; end: string; source: string };
export type Breakdown = { count: number; statuses: Record<string, number>; sources: Record<string, number>; awaitingConfirmation: number };
export interface Snapshot {
  generatedAt: string;
  modules: {
    orders: ModuleResult<{ current: Breakdown; period: Breakdown & { dateUnknownCount: number }; trend: TrendDay[] }>;
    parents: ModuleResult<{ current: { count: number; bySource: Record<string, number> }; period: { count: number; dateUnknownCount: number }; trend: TrendDay[]; withoutTrustedParent: number }>;
    finances: ModuleResult<{ currentIncome: Money; currentIncomeCount: number; missingVerification: { count: number; money: Money }; awaitingVerification: { count: number; money: Money }; notArrived: { count: number; money: Money } }>;
    billing: ModuleResult<{ currentDue: { CNY: number; unknownCount: number }; recordCount: number }>;
    pending: ModuleResult<{ current: { total: number; counts: Record<string, number> } }>;
  };
  details: ModuleResult<{ items: Row[]; total: number; page: number; pageSize: number }>;
}
export const sources: Record<string, string> = { all: '全部内部来源', local: '手工 / 本地未标来源', commerce: '内部商城', saved_source: '内部已保存来源', conflict: '来源关联冲突' };
export const categories: Record<string, string> = { leave: '请假审批', attendance: '考勤补签', notice: '通知 / 规则落实', report: '日报待阅', meeting: '会议心得', todo: '未完成待办', problem: '问题验收', issue: '待处理工单' };
export const phases: Record<string, string> = { discovery: '发现', completed_discovery: '发现完成', contract: '签约', completed_contract: '签约完成', incubation: '孵化', completed_incubation: '孵化完成' };
export const gapNames: Record<string, string> = { READ_FAILED: '读取失败', CREATED_AT_UNKNOWN: '内部创建日期缺失或无效', CONFIRMATION_UNAVAILABLE: '待确认信息未能读取', CONFLICTING_ORDER_ID: '办理记录内容冲突', BROKEN_RELATION: '关联记录缺失', SOURCE_CONFLICT: '来源关联冲突', CONFLICTING_FINANCE_ID: '财务记录内容冲突', MONEY_UNKNOWN: '币种未记录或金额无效', FINANCE_ORDER_MISSING: '财务记录缺少所属订单', BILLING_UNKNOWN: '商城账本信息不完整', MAPPED_INCOME_DIFFERS_FROM_PAID: '商城账本与到账收入的记录口径有差异' };
export const gapText = (gaps: Gap[]) => gaps.map(g => `${gapNames[g.code] || '部分信息待核对'}：${g.count}项`).join('；');
export function nextDay(day: string) { const ms = Date.parse(day + 'T00:00:00Z'); return Number.isFinite(ms) ? new Date(ms + 86400000).toISOString().slice(0, 10) : ''; }
export function initialFilter(): Filter { const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10); return { from: today.slice(0, 7) + '-01', end: today, source: 'all' }; }
export function query(filter: Filter, spec?: DetailSpec, page = 1): string {
  const params = new URLSearchParams({ from: spec?.from || filter.from, to: nextDay(spec?.end || filter.end), source: spec?.source || filter.source, detail: spec?.detail || 'orders', basis: spec?.basis || 'current', page: String(page), pageSize: '20' });
  for (const key of ['subset', 'status', 'currency', 'category'] as const) if (spec?.[key]) params.set(key, spec[key]);
  return params.toString();
}
export function displayTime(value: unknown) {
  if (typeof value !== 'string') return '未记录';
  const raw = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '未记录 / 日期无效' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
export function decimal(value: unknown, minor = true) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? (minor ? value / 100 : value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '金额无法判断'; }
