"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { reportSubmissionRevision } from "@/lib/boss-submission-types";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, bangkokDateStr } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, ClipboardList, ChevronDown } from "lucide-react";
import { WORK_REPORT_REQUIRED_FROM } from "@/lib/work-report-policy";

interface WorkReport {
  id: number;
  employee_name: string;
  report_date: string;
  completed_items: string;
  completed_items_zh: string;
  summary: string;
  summary_zh: string;
  tomorrow_plan: string;
  tomorrow_plan_zh: string;
  problems: string;
  problems_zh: string;
  related_objects: string;
  ai_label: string;
  ai_comment: string;
  boss_rating: number;
  boss_comment: string;
  risk_flag: number;
  risk_desc: string;
  status: string;
  is_backfill: number;
  submitted_at: string;
  created_at: string;
  updated_at?: string;
  rejection_reason?: string;
}

interface AutoItem { type: string; id: string; title: string; subtitle: string; href: string; checked: boolean; responsible?: string; businessType?: string; }
interface AutoGroup { type: string; label: string; items: AutoItem[]; }
interface RelatedObject { type: "project" | "customer" | "order"; id: string; name: string; }
interface PickObject { id: string; name: string; }
interface BoardRow { name: string; report: WorkReport | null; }
type ReportReview = Pick<WorkReport, "id" | "employee_name" | "report_date" | "boss_rating" | "boss_comment">;

function ReportReturnFeedback({ report, onResubmit }: { report: WorkReport; onResubmit?: () => void }) {
  if (report.status !== "退回" && !report.rejection_reason?.trim()) return null;
  return <div className="min-w-0 space-y-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 [overflow-wrap:anywhere] dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
    <p className="whitespace-pre-wrap">{report.status === "退回" ? "退回原因" : "上次退回原因"}：{report.rejection_reason?.trim() || "历史记录未保存退回原因"}</p>
    {report.status === "退回" && <p>请修改日报后重新提交。</p>}
    {report.status === "退回" && onResubmit && <Button size="sm" className="min-h-11" onClick={event => { event.stopPropagation(); onResubmit(); }}>修改重交</Button>}
  </div>;
}

type DayStatus = "已提交" | "补交" | "未提交" | "退回";

interface ParsedItem { text: string; href?: string; }

const translationLabels = {
  completed_items: "今日已完成",
  summary: "工作总结",
  tomorrow_plan: "明日计划",
  problems: "遇到的问题",
} as const;
type TranslationField = keyof typeof translationLabels;

function ReportTranslation({ report, field, onTranslated, children }: {
  report: WorkReport;
  field: TranslationField;
  onTranslated: (id: number, field: TranslationField, value: string) => void;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cached = report[`${field}_zh`];
  const translate = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithAuth(`/api/work-reports/${report.id}/translate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "翻译失败，请重试");
      onTranslated(report.id, field, data[`${field}_zh`]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "翻译失败，请重试");
    } finally { setBusy(false); }
  };
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--muted-foreground)]">{translationLabels[field]}</p>
        {!cached && (
          <Button size="sm" variant="outline" onClick={translate} disabled={busy} aria-label={`${translationLabels[field]} AI 翻译`}>
            {busy ? "翻译中…" : "AI 翻译"}
          </Button>
        )}
      </div>
      {children}
      {error && <p role="alert" className="mt-1 break-words text-xs text-[var(--destructive)]">{error}</p>}
      {cached && (
        <div className="mt-2 min-w-0 rounded-lg border border-blue-200/60 bg-blue-50/60 p-2.5 dark:border-blue-400/20 dark:bg-blue-950/30">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-300">AI 中文翻译</p>
          {field === "completed_items" ? (
            <ol className="mt-1 space-y-1">
              {parseItems(cached).map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{index + 1}. {item.text}</li>)}
            </ol>
          ) : <p className="mt-1 whitespace-pre-wrap break-words">{cached}</p>}
        </div>
      )}
    </div>
  );
}

function parseItems(s: string): ParsedItem[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    return a
      .map((x: unknown): ParsedItem | null => {
        if (typeof x === "string") return { text: x };
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          const text = String(o.text || "").trim();
          if (!text) return null;
          return { text, href: typeof o.href === "string" && o.href ? o.href : undefined };
        }
        return null;
      })
      .filter((x): x is ParsedItem => x !== null);
  } catch { return []; }
}

// 解析原始 completed_items（字符串 + 结构化对象），返回原始混合数组
function parseItemsRaw(s: string): (string | { text: string; type?: string; refId?: string; href?: string })[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    return a.filter((x: unknown) => typeof x === "string" || (x && typeof x === "object"));
  } catch { return []; }
}

function parseRelated(s: string): RelatedObject[] {
  try {
    const a = JSON.parse(s || "[]");
    if (!Array.isArray(a)) return [];
    const out: RelatedObject[] = [];
    for (const o of a as Record<string, unknown>[]) {
      const type = String(o?.type || "");
      const id = String(o?.id ?? "");
      const name = String(o?.name || "");
      if (["project", "customer", "order"].includes(type) && id) {
        out.push({ type: type as RelatedObject["type"], id, name });
      }
    }
    return out;
  } catch { return []; }
}

function relatedTypeLabel(t: string): string {
  return t === "project" ? "项目" : t === "customer" ? "客户" : "订单";
}

function relatedObjectHref(type: string, id: string): string {
  if (type === "project") return `/projects/${id}`;
  if (type === "customer") return `/customers/${id}`;
  return `/orders/${id}`;
}

function mapObjects(type: string, d: unknown): PickObject[] {
  const arr: any[] = Array.isArray(d) ? d : [];
  return arr
    .map((o) => {
      if (type === "project") return { id: String(o.id), name: String(o.name || "").trim() };
      if (type === "customer") return { id: String(o.id), name: String(o.company_name || "").trim() };
      return { id: String(o.id), name: o.customer_name ? `${o.id} · ${o.customer_name}` : String(o.id) };
    })
    .filter((o) => o.name);
}

function dateMinusDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

function reportStatus(r: WorkReport | null | undefined): DayStatus {
  if (!r) return "未提交";
  if (r.status === "退回") return "退回";
  return r.is_backfill === 1 ? "补交" : "已提交";
}

function statusBadgeClass(st: DayStatus): string {
  if (st === "已提交") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (st === "补交") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (st === "退回") return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
  return "bg-red-100 font-semibold text-red-700 dark:bg-red-900/50 dark:text-red-300";
}

function aiLabelClass(label: string): string {
  if (label === "优秀") return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (label === "良好") return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (label === "敷衍") return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (label === "过短") return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function StatusBadge({ st }: { st: DayStatus }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", statusBadgeClass(st))}>{st}</span>;
}

function ReviewStatus({ report }: { report: ReportReview }) {
  const reviewed = report.boss_rating > 0 || Boolean(report.boss_comment?.trim());
  if (!reviewed) return <span className="text-xs text-[var(--muted-foreground)]">未点评</span>;
  return (
    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
      {report.boss_rating > 0 ? `已点评 ★ ${report.boss_rating} 星` : "已点评 · 未评分"}
    </span>
  );
}

export default function WorkReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const reportIdParam = useSearchParams().get("report");
  const [linkedReport, setLinkedReport] = useState<{ key: string; report: WorkReport } | null>(null);
  const [jumpError, setJumpError] = useState("");
  const [highlightReportId, setHighlightReportId] = useState<number | null>(null);
  const jumpedReport = useRef<string | null>(null);
  const reportLinkRequest = useRef(0);
  const notificationReport = linkedReport?.key === reportIdParam ? linkedReport.report : null;

  // 员工：自己的日报列表
  const [reports, setReports] = useState<WorkReport[]>([]);
  const [pendingDates, setPendingDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // 老板：看板（按日期看所有在职员工状态）
  const [boardDate, setBoardDate] = useState(bangkokDateStr());
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardLoadedDate, setBoardLoadedDate] = useState("");
  const [boardError, setBoardError] = useState("");
  const boardRequest = useRef(0);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviews, setReviews] = useState<ReportReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState("");

  // 填写/重交表单
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "resubmit">("create");
  const [formId, setFormId] = useState<number | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formItems, setFormItems] = useState<string[]>([""]);
  const [autoGroups, setAutoGroups] = useState<AutoGroup[]>([]);
  const [businessTypes, setBusinessTypes] = useState<{ id: number; name: string }[]>([]);
  const [orderResponsibleFilter, setOrderResponsibleFilter] = useState("");
  const [orderBizFilter, setOrderBizFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ order: true });
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, AutoItem[]>>({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [formRelated, setFormRelated] = useState<RelatedObject[]>([]);
  const [formSummary, setFormSummary] = useState("");
  const [formPlan, setFormPlan] = useState("");
  const [formProblems, setFormProblems] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [prevPlan, setPrevPlan] = useState("");

  // 关联业务对象选择器
  const [pickerType, setPickerType] = useState<"project" | "customer" | "order">("order");
  const [pickerObjects, setPickerObjects] = useState<PickObject[]>([]);
  const [pickerId, setPickerId] = useState("");

  // 详情弹窗
  const [detail, setDetail] = useState<WorkReport | null>(null);
  const [rejectTarget, setRejectTarget] = useState<WorkReport | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);
  const rejectInFlight = useRef(false);
  const [rejectViewport, setRejectViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!rejectTarget || !viewport) { setRejectViewport(null); return; }
    const update = () => setRejectViewport({ left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height });
    update(); viewport.addEventListener("resize", update); viewport.addEventListener("scroll", update);
    return () => { viewport.removeEventListener("resize", update); viewport.removeEventListener("scroll", update); };
  }, [rejectTarget]);

  // 老板点评（星级 + 一句点评）
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewErr, setReviewErr] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewSaved, setReviewSaved] = useState(false);

  // 故事线（按业务对象看）
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyType, setStoryType] = useState<"project" | "customer" | "order">("order");
  const [storyObjects, setStoryObjects] = useState<PickObject[]>([]);
  const [storyObjectId, setStoryObjectId] = useState("");
  const [timeline, setTimeline] = useState<WorkReport[]>([]);
  const onTranslated = (id: number, field: TranslationField, value: string) => {
    const update = (report: WorkReport) => report.id === id ? { ...report, [`${field}_zh`]: value } : report;
    setLinkedReport(target => target ? { ...target, report: update(target.report) } : target);
    setDetail((report) => report ? update(report) : report);
    setReports((rows) => rows.map(update));
    setBoard((rows) => rows.map((row) => ({ ...row, report: row.report ? update(row.report) : null })));
    setTimeline((rows) => rows.map(update));
  };
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [storySummary, setStorySummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [storyErr, setStoryErr] = useState("");

  const today = bangkokDateStr();
  const yesterday = dateMinusDays(today, 1);

  const loadEmployee = () => {
    setLoading(true);
    fetchWithAuth("/api/work-reports?pending_dates=1", { cache: "no-store" })
      .then(response => response.ok ? response.json() : [])
      .then(dates => setPendingDates(Array.isArray(dates) ? dates : []))
      .catch(() => setPendingDates([]));
    fetchWithAuth("/api/work-reports", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setReports(Array.isArray(d) ? d : []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  const loadBoard = () => {
    const request = ++boardRequest.current;
    const date = boardDate;
    setBoardLoading(true);
    fetchWithAuth(`/api/work-reports/board?date=${date}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("日报看板加载失败，请刷新后重试。");
        return r.json();
      })
      .then((d) => {
        if (!d || !Array.isArray(d.employees)) throw new Error("日报看板加载失败，请刷新后重试。");
        if (request !== boardRequest.current) return;
        setBoard(d.employees);
        setBoardError("");
      })
      .catch(() => {
        if (request !== boardRequest.current) return;
        setBoard([]);
        setBoardError("日报看板加载失败，请刷新后重试。");
      })
      .finally(() => {
        if (request !== boardRequest.current) return;
        setBoardLoadedDate(date);
        setBoardLoading(false);
      });
  };

  const refresh = () => { if (isAdmin) loadBoard(); else loadEmployee(); };

  const loadReviews = async () => {
    setReviewsLoading(true);
    setReviewsError("");
    try {
      const res = await fetchWithAuth("/api/work-reports/reviews", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "点评汇总加载失败");
      setReviews(Array.isArray(data) ? data : []);
    } catch (error) {
      setReviewsError(error instanceof Error ? error.message : "点评汇总加载失败");
    } finally { setReviewsLoading(false); }
  };

  const openDetail = (r: WorkReport) => {
    setDetail(r);
    if (isAdmin && r.status === "已提交") {
      void fetchWithAuth("/api/boss-supervision/pending/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "report", items: [{ id: r.id, revision: r.submitted_at || r.created_at || "" }] }) }).catch(() => {});
    }
    setReviewRating(r.boss_rating || 0);
    setReviewComment(r.boss_comment || "");
    setReviewErr("");
    setReviewSaved(false);
  };

  useEffect(() => {
    if (isAdmin) loadBoard();
    else loadEmployee();
    return () => { ++boardRequest.current; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name, isAdmin, boardDate]);

  // 编号查原记录，取其真实日期；不从通知文字/员工姓名猜日期，也不自动打开详情。
  useEffect(() => {
    let active = true;
    const run = ++reportLinkRequest.current;
    const controller = new AbortController();
    jumpedReport.current = null;
    setLinkedReport(null);
    setHighlightReportId(null);
    setJumpError(""); setRejectTarget(null);
    setStoryOpen(false);
    setReviewsOpen(false);
    setDetail(null); setFormOpen(false);
    if (reportIdParam === null || !user) return;
    const id = Number(reportIdParam);
    if (!/^[1-9]\d*$/.test(reportIdParam) || !Number.isSafeInteger(id) || id <= 0) {
      setJumpError("日报编号无效。");
      return;
    }
    fetchWithAuth(`/api/work-reports/${id}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 || response.status === 404
          ? "日报不存在或你无权查看。" : "日报加载失败，请刷新后重试。");
        const report: WorkReport = await response.json();
        if (report.id !== id || !/^\d{4}-\d{2}-\d{2}$/.test(report.report_date)
          || (!isAdmin && report.employee_name !== user.name)) throw new Error("日报不存在或你无权查看。");
        if (!active || run !== reportLinkRequest.current) return;
        setLinkedReport({ key: reportIdParam, report });
        if (isAdmin) setBoardDate(report.report_date);
      })
      .catch((error) => {
        if (active) setJumpError(error instanceof Error ? error.message : "日报加载失败，请刷新后重试。");
      });
    return () => { active = false; controller.abort(); };
  }, [reportIdParam, user?.name, isAdmin]);

  // 等对应日期看板或员工列表就绪，再让目标所在视图显示并开始定位。
  useEffect(() => {
    if (!notificationReport || jumpedReport.current === reportIdParam) return;
    if (isAdmin) {
      if (boardDate !== notificationReport.report_date || boardLoading || boardLoadedDate !== boardDate) return;
      if (boardError) { setJumpError(boardError); return; }
    } else if (loading) return;
    setStoryOpen(false);
    setReviewsOpen(false);
    setDetail(null);
    jumpedReport.current = reportIdParam;
    setHighlightReportId(notificationReport.id);
  }, [notificationReport, reportIdParam, isAdmin, boardDate, boardLoading, boardLoadedDate, boardError, loading]);

  useEffect(() => {
    if (highlightReportId === null) return;
    let frame: number;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = performance.now() + 5000;
    const locate = () => {
      const target = [...document.querySelectorAll<HTMLElement>(`[data-report-id="${highlightReportId}"]`)]
        .find((element) => element.getClientRects().length > 0);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        clearTimer = setTimeout(() => setHighlightReportId(null), 3000);
      } else if (performance.now() < deadline) frame = requestAnimationFrame(locate);
      else { setHighlightReportId(null); setJumpError("暂时无法定位该日报，请刷新后重试。"); }
    };
    frame = requestAnimationFrame(locate);
    return () => { cancelAnimationFrame(frame); clearTimeout(clearTimer); };
  }, [highlightReportId]);

  // 加载某类型业务对象列表（项目/客户/订单）
  const loadPickerObjects = (type: string) => {
    const url = type === "project" ? "/api/projects/names" : type === "customer" ? "/api/customers" : "/api/orders";
    fetchWithAuth(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const objs = mapObjects(type, d);
        setPickerObjects(objs);
        setPickerId(objs[0]?.id || "");
      })
      .catch(() => { setPickerObjects([]); setPickerId(""); });
  };

  const resetPicker = () => {
    setPickerType("order");
    setPickerObjects([]);
    setPickerId("");
  };

  const openCreate = (date: string) => {
    setFormMode("create");
    setFormId(null);
    setFormDate(date);
    setFormItems([""]);
    setAutoGroups([]);
    setOrderResponsibleFilter("");
    setOrderBizFilter("");
    setCollapsed({ order: true });
    setSearchQueries({});
    setSearchResults({});
    setFormRelated([]);
    setFormSummary("");
    setFormPlan("");
    setFormProblems("");
    setFormErr("");
    setPrevPlan("");
    setFormOpen(true);
    resetPicker();
    loadPickerObjects("order");

    // 业务线列表（订单组筛选用）
    fetchWithAuth("/api/business-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setBusinessTypes(Array.isArray(d) ? d.map((b: any) => ({ id: b.id, name: String(b.name) })) : []))
      .catch(() => setBusinessTypes([]));

    // 自动带出：当天系统操作（分四类）+ 前一天的明日计划
    setAutoLoading(true);
    fetchWithAuth(`/api/work-reports/auto?date=${date}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          const groups: AutoGroup[] = (Array.isArray(d.groups) ? d.groups : []).map((g: any) => ({
            type: String(g.type || ""),
            label: String(g.label || ""),
            items: (Array.isArray(g.items) ? g.items : []).map((i: any) => ({
              type: String(i.type || ""),
              id: String(i.id || ""),
              title: String(i.title || ""),
              subtitle: String(i.subtitle || ""),
              href: String(i.href || ""),
              checked: true,
              responsible: typeof i.responsible === "string" ? i.responsible : "",
              businessType: typeof i.businessType === "string" ? i.businessType : "",
            })),
          }));
          setAutoGroups(groups);
          setPrevPlan(typeof d.prev_plan === "string" ? d.prev_plan : "");
        }
      })
      .catch(() => {})
      .finally(() => setAutoLoading(false));
  };

  const openResubmit = (r: WorkReport) => {
    setFormMode("resubmit");
    setFormId(r.id);
    setFormDate(r.report_date);
    const raw = parseItemsRaw(r.completed_items);
    const strs = raw.filter((x) => typeof x === "string").map((s) => String(s).trim()).filter(Boolean);
    const objs = raw.filter((x) => typeof x === "object") as { text: string; type?: string; refId?: string; href?: string }[];
    const order = ["order", "todo", "issue", "other"];
    const labels: Record<string, string> = { order: "订单", todo: "待办", issue: "工单", other: "其他" };
    const byType: Record<string, AutoItem[]> = {};
    for (const o of objs) {
      const t = o.type || "other";
      if (!byType[t]) byType[t] = [];
      byType[t].push({ type: t, id: o.refId || "", title: o.text, subtitle: "", href: o.href || "", checked: true });
    }
    const groups: AutoGroup[] = order.filter((t) => byType[t]).map((t) => ({ type: t, label: labels[t], items: byType[t] }));
    for (const t of Object.keys(byType)) {
      if (!order.includes(t)) groups.push({ type: t, label: "其他", items: byType[t] });
    }
    setAutoGroups(groups);
    setFormItems(strs.length ? strs : [""]);
    setCollapsed({ order: true });
    setSearchQueries({});
    setSearchResults({});
    setFormRelated(parseRelated(r.related_objects));
    setFormSummary(r.summary || "");
    setFormPlan(r.tomorrow_plan || "");
    setFormProblems(r.problems || "");
    setFormErr("");
    setPrevPlan("");
    setFormOpen(true);
    setDetail(null);
    resetPicker();
    loadPickerObjects("order");
  };

  const addItem = () => setFormItems((p) => [...p, ""]);
  const removeItem = (i: number) => setFormItems((p) => p.filter((_, idx) => idx !== i));
  const updateItem = (i: number, v: string) => setFormItems((p) => p.map((it, idx) => (idx === i ? v : it)));
  const toggleAutoItem = (gType: string, itemId: string) => {
    setAutoGroups((prev) => prev.map((g) => (g.type === gType ? { ...g, items: g.items.map((i) => (i.id === itemId ? { ...i, checked: !i.checked } : i)) } : g)));
  };

  const toggleCollapse = (type: string) => setCollapsed((p) => ({ ...p, [type]: !p[type] }));

  const doSearch = async (type: string, q: string) => {
    const query = q.trim();
    if (!query) { setSearchResults((p) => ({ ...p, [type]: [] })); return; }
    setSearchLoading(true);
    const res = await fetchWithAuth(`/api/work-reports/search?type=${type}&q=${encodeURIComponent(query)}`, { cache: "no-store" }).catch(() => null);
    setSearchLoading(false);
    if (res && res.ok) {
      const data = await res.json().catch(() => []);
      const items: AutoItem[] = (Array.isArray(data) ? data : []).map((i: any) => ({
        type, id: String(i.id || ""), title: String(i.title || ""), subtitle: String(i.subtitle || ""), href: String(i.href || ""),
        checked: true, responsible: typeof i.responsible === "string" ? i.responsible : "", businessType: typeof i.businessType === "string" ? i.businessType : "",
      }));
      setSearchResults((p) => ({ ...p, [type]: items }));
    }
  };

  const onSearchChange = (type: string, q: string) => {
    setSearchQueries((p) => ({ ...p, [type]: q }));
    // 简单防抖：本地 setTimeout 即可
    window.setTimeout(() => {
      setSearchQueries((cur) => { if ((cur[type] || "") === q) doSearch(type, q); return cur; });
    }, 300);
  };

  const addSearchItem = (type: string, item: AutoItem) => {
    setAutoGroups((prev) => prev.map((g) => {
      if (g.type !== type) return g;
      if (g.items.some((i) => i.id === item.id)) return g; // 已存在不重复
      return { ...g, items: [...g.items, item] };
    }));
  };

  const changePickerType = (t: "project" | "customer" | "order") => {
    setPickerType(t);
    setPickerObjects([]);
    setPickerId("");
    loadPickerObjects(t);
  };

  const addRelated = () => {
    const obj = pickerObjects.find((o) => o.id === pickerId);
    if (!obj) return;
    setFormRelated((p) => (p.some((r) => r.type === pickerType && r.id === obj.id) ? p : [...p, { type: pickerType, id: obj.id, name: obj.name }]));
  };

  const removeRelated = (type: string, id: string) => setFormRelated((p) => p.filter((r) => !(r.type === type && r.id === id)));

  const submit = async () => {
    const checkedObjs = autoGroups.flatMap((g) => g.items.filter((i) => i.checked).map((i) => ({ text: i.title, type: i.type, refId: i.id, href: i.href })));
    const manual = formItems.map((s) => s.trim()).filter(Boolean);
    const items = [...checkedObjs, ...manual];
    if (items.length === 0) { setFormErr("请至少勾选或填写一条今日已完成"); return; }
    setSaving(true);
    const body = { report_date: formDate, completed_items: items, summary: formSummary, tomorrow_plan: formPlan, problems: formProblems, related_objects: formRelated };
    const linkRun = reportLinkRequest.current;
    const saved: { ok: boolean; report?: WorkReport } = formMode === "create"
      ? { ok: await apiCall("/api/work-reports", { method: "POST", body, onError: (m) => setFormErr(m) }) }
      : await (async () => {
        try {
          const response = await fetchWithAuth(`/api/work-reports/${formId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) { setFormErr(data.error || "重交失败，请重试"); return { ok: false }; }
          return { ok: true, report: data.id === formId && data.employee_name === user?.name ? data as WorkReport : undefined };
        } catch { setFormErr("网络错误，请重试"); return { ok: false }; }
      })();
    setSaving(false);
    if (saved.ok) {
      if (saved.report && linkRun === reportLinkRequest.current) {
        const updated = saved.report;
        setLinkedReport(target => target?.key === reportIdParam && target.report.id === updated.id ? { ...target, report: updated } : target);
      }
      setFormOpen(false); setFormErr(""); refresh();
    }
  };

  const reject = (r: WorkReport) => {
    if (rejectInFlight.current || r.status !== "已提交") return;
    setRejectTarget(r); setRejectionReason(""); setRejectError("");
  };

  const confirmReject = async () => {
    if (!rejectTarget || rejectInFlight.current) return;
    if (!rejectionReason.trim()) { setRejectError("请填写退回原因"); return; }
    const target = rejectTarget;
    const reason = rejectionReason.trim();
    rejectInFlight.current = true; setRejectSaving(true); setRejectError("");
    const ok = await apiCall(`/api/work-reports/${target.id}`, { method: "PATCH", body: { action: "reject", rejection_reason: reason, submission_revision: reportSubmissionRevision(target) }, onError: setRejectError });
    rejectInFlight.current = false; setRejectSaving(false);
    if (ok) {
      setLinkedReport(link => link?.report.id === target.id ? { ...link, report: { ...link.report, status: "退回", rejection_reason: reason } } : link);
      setRejectTarget(null); setDetail(null); refresh();
    }
  };

  const submitReview = async () => {
    if (!detail) return;
    if (reviewRating < 1 || reviewRating > 5) { setReviewErr("请先打 1-5 星"); return; }
    const reportId = detail.id;
    const rating = reviewRating;
    const comment = reviewComment.trim();
    setReviewing(true);
    const ok = await apiCall(`/api/work-reports/${reportId}`, { method: "PATCH", body: { action: "review", rating, comment }, onError: (m) => setReviewErr(m) });
    setReviewing(false);
    if (ok) {
      const update = (report: WorkReport) => report.id === reportId ? { ...report, boss_rating: rating, boss_comment: comment } : report;
      setLinkedReport(target => target ? { ...target, report: update(target.report) } : target);
      setDetail((report) => report ? update(report) : report);
      setBoard((rows) => rows.map((row) => ({ ...row, report: row.report ? update(row.report) : null })));
      setReports((rows) => rows.map(update));
      setTimeline((rows) => rows.map(update));
      setReviewErr("");
      setReviewSaved(true);
      setTimeout(() => setReviewSaved(false), 2500);
    }
  };

  // ── 故事线（按业务对象看）──
  const objectUrl = (type: string) => (type === "project" ? "/api/projects/names" : type === "customer" ? "/api/customers" : "/api/orders");

  const loadStoryObjects = (type: string) => {
    setStoryType(type as "project" | "customer" | "order");
    setStoryObjects([]);
    setStoryObjectId("");
    setTimeline([]);
    setStorySummary("");
    setStoryErr("");
    fetchWithAuth(objectUrl(type), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const objs = mapObjects(type, d);
        setStoryObjects(objs);
        setStoryObjectId(objs[0]?.id || "");
        if (objs[0]?.id) loadTimeline(type, objs[0].id);
      })
      .catch(() => { setStoryObjects([]); setStoryObjectId(""); });
  };

  const loadTimeline = (type?: string, id?: string) => {
    const t = type || storyType;
    const i = id || storyObjectId;
    if (!i) { setTimeline([]); setStorySummary(""); return; }
    setTimelineLoading(true);
    setStorySummary("");
    setStoryErr("");
    fetchWithAuth(`/api/work-reports/story?type=${t}&id=${encodeURIComponent(i)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTimeline(Array.isArray(d) ? d : []))
      .catch(() => setTimeline([]))
      .finally(() => setTimelineLoading(false));
  };

  const openStory = () => {
    setReviewsOpen(false);
    setStoryOpen(true);
    setStorySummary("");
    setStoryErr("");
    loadStoryObjects("order");
  };

  const generateStory = async () => {
    if (!storyObjectId) return;
    const obj = storyObjects.find((o) => o.id === storyObjectId);
    setSummarizing(true);
    setStoryErr("");
    const res = await fetchWithAuth("/api/work-reports/story/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: storyType, id: storyObjectId, name: obj?.name || "" }),
    }).catch(() => null);
    setSummarizing(false);
    if (!res || !res.ok) {
      const data = await res?.json().catch(() => ({}));
      setStoryErr(data?.error || "AI 总结失败");
      return;
    }
    const data = await res.json().catch(() => ({}));
    setStorySummary(typeof data.summary === "string" ? data.summary : "");
  };

  // 最近30天与系统待补交日期；启用日前只保留实际已有的历史日报。
  const employeeTarget = !isAdmin && notificationReport?.employee_name === user?.name ? notificationReport : null;
  const visibleReports = employeeTarget && !reports.some(report => report.id === employeeTarget.id) ? [...reports, employeeTarget] : reports;
  const dayList = [...new Set([...Array.from({ length: 30 }, (_, i) => dateMinusDays(today, i))
    .filter(day => day === today || day >= WORK_REPORT_REQUIRED_FROM || reports.some(report => report.report_date === day)), ...pendingDates,
    ...(employeeTarget ? [employeeTarget.report_date] : [])])].sort().reverse();
  // 默认在职人员查询保持原样；只有通知中的目标日报可临时补入（含离职员工历史日报）。
  const boardTarget = isAdmin && notificationReport?.report_date === boardDate ? notificationReport : null;
  const visibleBoard = !boardTarget || board.some(row => row.report?.id === boardTarget.id) ? board
    : board.some(row => row.name === boardTarget.employee_name)
      ? board.map(row => row.name === boardTarget.employee_name ? { ...row, report: boardTarget } : row)
      : [...board, { name: boardTarget.employee_name, report: boardTarget }];

  // 订单组筛选：负责人 + 业务线
  const orderItems = autoGroups.find((g) => g.type === "order")?.items || [];
  const responsibleOptions = [...new Set(orderItems.map((i) => (i.responsible || "").trim()).filter(Boolean))];
  const filteredOrderItems = orderItems.filter((i) => {
    if (orderResponsibleFilter && (i.responsible || "") !== orderResponsibleFilter) return false;
    if (orderBizFilter && (i.businessType || "") !== orderBizFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{isAdmin ? "工作记录看板" : "我的工作记录"}</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "按日期查看所有在职员工的提交情况" : "每天填一份，记录今天做了什么"}</p>
      </div>

      {/* 视图切换 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={storyOpen || reviewsOpen ? "ghost" : "default"} onClick={() => { setStoryOpen(false); setReviewsOpen(false); }}>{isAdmin ? "看板" : "我的日报"}</Button>
        {isAdmin && <Button size="sm" variant={reviewsOpen ? "default" : "ghost"} onClick={() => { setStoryOpen(false); setReviewsOpen(true); void loadReviews(); }}>点评汇总</Button>}
        <Button size="sm" variant={storyOpen ? "default" : "ghost"} onClick={openStory}>按业务对象看</Button>
      </div>

      {jumpError && <p role="alert" className="text-sm text-[var(--destructive)]">{jumpError}</p>}

      {/* 老板看板 */}
      {!storyOpen && !reviewsOpen && isAdmin && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={boardDate}
              onChange={(e) => setBoardDate(e.target.value)}
              className="h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
            />
            <span className="text-xs text-[var(--muted-foreground)]">共 {board.length} 名在职员工</span>
          </div>

          {boardLoading || boardLoadedDate !== boardDate ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
          ) : visibleBoard.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无在职员工</p>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleBoard.map((row) => {
                const st = reportStatus(row.report);
                const risky = row.report?.risk_flag === 1;
                return (
                  <div
                    key={row.name}
                    data-report-id={row.report?.id}
                    onClick={() => row.report && openDetail(row.report)}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border p-3",
                      risky ? "border-red-400 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30" : "border-[var(--border)] bg-[var(--background)]",
                      row.report && "cursor-pointer transition-colors hover:border-[var(--primary)]",
                      row.report?.id === highlightReportId && "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-900/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 max-w-full truncate text-sm font-medium text-[var(--foreground)]">{row.name}</span>
                      {row.report && <ReviewStatus report={row.report} />}
                      {risky && <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">风险</span>}
                    </div>
                    <StatusBadge st={st} />
                    </div>
                    {row.report && <ReportReturnFeedback report={row.report} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 老板点评汇总 */}
      {isAdmin && reviewsOpen && (
        <div className="flex min-w-0 flex-col gap-3">
          {reviewsLoading ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
          ) : reviewsError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-[var(--destructive)]">
              <span>{reviewsError}</span><Button size="sm" variant="outline" onClick={() => void loadReviews()}>重试</Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">共点评 {reviews.length} 条</p>
              {reviews.length === 0 ? (
                <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无点评记录</p>
              ) : reviews.map((review) => (
                <div key={review.id} className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs text-[var(--muted-foreground)]">{review.report_date}</span>
                    <span className="min-w-0 break-words text-sm font-medium text-[var(--foreground)]">{review.employee_name}</span>
                    <ReviewStatus report={review} />
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{review.boss_comment?.trim() || "未填写点评意见"}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* 员工视角 */}
      {!storyOpen && !isAdmin && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {reports.some((r) => r.report_date === today) ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] px-3 py-1.5 text-sm font-medium text-[oklch(0.38_0.14_155)]">
                今日已提交
              </span>
            ) : (
              <Button size="sm" onClick={() => openCreate(today)} className="gap-1.5">
                <ClipboardList className="size-4" />填写今日工作记录
              </Button>
            )}
            {yesterday >= WORK_REPORT_REQUIRED_FROM && !reports.some((r) => r.report_date === yesterday) && (
              <Button size="sm" variant="outline" onClick={() => openCreate(yesterday)}>
                补交昨日工作记录
              </Button>
            )}
            {pendingDates.some(date => date < yesterday) && <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">补交历史日报
              <select aria-label="选择待补交日期" defaultValue="" onChange={event => {
                const date = event.target.value;
                if (date) {
                  const returned = reports.find(report => report.report_date === date && report.status === "退回");
                  if (returned) openResubmit(returned); else openCreate(date);
                }
                event.target.value = "";
              }} className="min-h-11 min-w-0 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm">
                <option value="">选择待补交日期</option>{pendingDates.filter(date => date < yesterday).map(date => <option key={date} value={date}>{date}</option>)}
              </select>
            </label>}
          </div>

          {loading ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {dayList.map((day) => {
                const r = visibleReports.find((x) => x.report_date === day);
                const st = reportStatus(r);
                return (
                  <div
                    key={day}
                    data-report-id={r?.id}
                    onClick={() => r && openDetail(r)}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] p-3",
                      r && "cursor-pointer transition-colors hover:border-[var(--primary)]",
                      r?.id === highlightReportId && "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-900/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-[var(--foreground)]">{day}</span>
                    <div className="flex items-center gap-2">
                      {!r && day === today && <Button size="sm" onClick={(e) => { e.stopPropagation(); openCreate(today); }}>去填写</Button>}
                      {!r && day !== today && (day === yesterday || pendingDates.includes(day)) && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openCreate(day); }}>去补交</Button>}
                      {r && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>查看</Button>}
                      <StatusBadge st={st} />
                    </div>
                    </div>
                    {r && <ReportReturnFeedback report={r} onResubmit={() => openResubmit(r)} />}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 故事线：按业务对象看 */}
      {storyOpen && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select value={storyType} onChange={(e) => loadStoryObjects(e.target.value)} className="h-9 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
              <option value="order">订单</option>
              <option value="customer">客户</option>
              <option value="project">项目</option>
            </select>
            <select value={storyObjectId} onChange={(e) => { setStoryObjectId(e.target.value); setStorySummary(""); loadTimeline(storyType, e.target.value); }} className="h-9 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
              {storyObjects.length === 0 ? (
                <option value="">无可用对象</option>
              ) : (
                storyObjects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)
              )}
            </select>
            <Button size="sm" onClick={generateStory} disabled={!storyObjectId || timeline.length === 0 || summarizing}>
              {summarizing ? "生成中…" : "生成故事线总结"}
            </Button>
          </div>

          {storyErr && <p className="text-xs text-[var(--destructive)]">{storyErr}</p>}

          {storySummary && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/20 p-4">
              <p className="text-xs font-medium text-[var(--muted-foreground)]">故事线总结</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{storySummary}</p>
            </div>
          )}

          {timelineLoading ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
          ) : timeline.length === 0 ? (
            <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">该对象下暂无相关日报</p>
          ) : (
            <div className="flex flex-col gap-2">
              {timeline.map((r) => (
                <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[var(--foreground)]">{r.report_date}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{r.employee_name}</span>
                    {r.risk_flag === 1 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">风险</span>}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {parseItems(r.completed_items).map((it, i) => <li key={i} className="break-words">· {it.text}</li>)}
                  </ul>
                  {r.summary && <p className="mt-1 break-words text-xs text-[var(--muted-foreground)]">{r.summary}</p>}
                  {r.problems && <p className="mt-1 break-words text-xs text-[var(--muted-foreground)]">问题：{r.problems}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 填写/重交弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={formMode === "create" ? "填写工作记录" : "重新提交工作记录"} className="max-h-[88dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">
                {formMode === "create" ? (formDate === today ? "填写今日工作记录" : formDate === yesterday ? "补交昨日工作记录" : "补交历史工作记录") : "重新提交工作记录"}
              </h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">日期：{formDate}</p>

            {/* 前一天的明日计划对照 */}
            {prevPlan && (
              <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3">
                <p className="text-xs font-medium text-[var(--muted-foreground)]">{dateMinusDays(formDate, 1)} 的明日计划（对照，看看做了没）</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">{prevPlan}</p>
              </div>
            )}

            <div className="mt-4">
              <label className="text-xs font-medium">今日已完成 <span className="text-[var(--destructive)]">*</span></label>

              {/* 自动带出，分四类勾选 */}
              {autoGroups.map((g) => {
                const isOrder = g.type === "order";
                const canSearch = g.type === "order" || g.type === "todo" || g.type === "issue";
                const isCollapsed = !!collapsed[g.type];
                const items = isOrder ? filteredOrderItems : g.items;
                const results = searchResults[g.type] || [];
                const query = searchQueries[g.type] || "";
                return (
                  <div key={g.type} className="mt-2 rounded-lg border border-[var(--border)]">
                    {/* 组标题，点击折叠/展开 */}
                    <button type="button" onClick={() => toggleCollapse(g.type)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
                      <span className="text-xs font-medium text-[var(--foreground)]">{g.label}（{items.length}）</span>
                      <ChevronDown className={cn("size-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform", !isCollapsed && "rotate-180")} />
                    </button>

                    {!isCollapsed && (
                      <div className="px-3 pb-2">
                        {/* 搜索（订单/待办/工单） */}
                        {canSearch && (
                          <div className="mb-1.5">
                            <input
                              value={query}
                              onChange={(e) => onSearchChange(g.type, e.target.value)}
                              placeholder={g.type === "order" ? "搜索订单号或客户名" : g.type === "todo" ? "搜索待办内容" : "搜索工单"}
                              className="h-8 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2.5 text-xs outline-none focus:border-[var(--ring)]"
                            />
                            {searchLoading && <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">搜索中…</p>}
                            {results.length > 0 && (
                              <div className="mt-1 space-y-1">
                                {results.map((item) => {
                                  const added = g.items.some((i) => i.id === item.id);
                                  return (
                                    <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1">
                                      <div className="min-w-0 flex-1">
                                        <span className="text-xs text-[var(--foreground)]">{item.title}</span>
                                        {item.subtitle && <span className="ml-1 text-[10px] text-[var(--muted-foreground)]">{item.subtitle}</span>}
                                      </div>
                                      {added ? (
                                        <span className="shrink-0 text-[10px] text-green-600">已添加</span>
                                      ) : (
                                        <Button size="xs" variant="outline" onClick={() => addSearchItem(g.type, item)}>添加</Button>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 订单组筛选 */}
                        {isOrder && (
                          <div className="mb-1.5 flex items-center gap-1.5">
                            <select value={orderResponsibleFilter} onChange={(e) => setOrderResponsibleFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-xs outline-none focus:border-[var(--ring)]">
                              <option value="">全部负责人</option>
                              {responsibleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <select value={orderBizFilter} onChange={(e) => setOrderBizFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 text-xs outline-none focus:border-[var(--ring)]">
                              <option value="">全部业务线</option>
                              {businessTypes.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                            </select>
                          </div>
                        )}

                        <div className="space-y-1">
                          {items.map((item) => (
                            <div key={item.id} className="flex items-start gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5">
                              <input type="checkbox" checked={item.checked} onChange={() => toggleAutoItem(g.type, item.id)} className="mt-0.5 size-4 shrink-0" />
                              <div className="min-w-0 flex-1">
                                {item.href ? (
                                  <Link href={item.href} className="text-sm text-[var(--foreground)] hover:text-[var(--primary)] hover:underline">{item.title}</Link>
                                ) : (
                                  <span className="text-sm text-[var(--foreground)]">{item.title}</span>
                                )}
                                {item.subtitle && <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">{item.subtitle}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {autoLoading && <p className="mt-1 text-xs text-[var(--muted-foreground)]">正在带出系统记录…</p>}

              {/* 手动添加 */}
              <div className="mt-2 space-y-1.5">
                {formItems.map((item, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input value={item} onChange={(e) => updateItem(i, e.target.value)} placeholder={`工作项 ${i + 1}`} className="h-9 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    <button type="button" onClick={() => removeItem(i)} className="flex size-9 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/40"><X className="size-3.5" /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addItem} className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"><Plus className="size-3.5" />添加工作项</button>
            </div>

            {/* 关联业务对象 */}
            <div className="mt-3">
              <label className="text-xs font-medium">关联业务对象（可选）</label>
              {formRelated.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {formRelated.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-1 text-xs text-[var(--foreground)]">
                      <span className="text-[var(--muted-foreground)]">{relatedTypeLabel(r.type)}</span>
                      <span className="max-w-[180px] truncate">{r.name}</span>
                      <button type="button" onClick={() => removeRelated(r.type, r.id)} className="text-[var(--muted-foreground)] hover:text-[var(--destructive)]"><X className="size-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-1.5">
                <select value={pickerType} onChange={(e) => changePickerType(e.target.value as any)} className="h-9 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="order">订单</option>
                  <option value="customer">客户</option>
                  <option value="project">项目</option>
                </select>
                <select value={pickerId} onChange={(e) => setPickerId(e.target.value)} className="h-9 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  {pickerObjects.length === 0 ? (
                    <option value="">无可用对象</option>
                  ) : (
                    pickerObjects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)
                  )}
                </select>
                <Button size="sm" variant="outline" onClick={addRelated} disabled={!pickerId}>添加</Button>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium">工作总结（可选）</label>
              <textarea value={formSummary} onChange={(e) => setFormSummary(e.target.value)} rows={3} placeholder="今天的工作总结" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">明日计划（可选）</label>
              <textarea value={formPlan} onChange={(e) => setFormPlan(e.target.value)} rows={2} placeholder="明天打算做什么" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">遇到的问题（可选）</label>
              <textarea value={formProblems} onChange={(e) => setFormProblems(e.target.value)} rows={2} placeholder="遇到什么问题需要协调" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && isAdmin && (
        <div style={rejectViewport ? { left: rejectViewport.left, top: rejectViewport.top, width: rejectViewport.width, height: rejectViewport.height, right: "auto", bottom: "auto" } : undefined} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !rejectInFlight.current && setRejectTarget(null)}>
          <div role="dialog" aria-modal="true" aria-label="退回日报" style={rejectViewport ? { maxHeight: Math.max(0, rejectViewport.height - 32) } : undefined} className="max-h-[88dvh] w-full min-w-0 max-w-sm space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold">退回 {rejectTarget.employee_name} {rejectTarget.report_date} 的日报</h3>
            <label className="block text-sm">退回原因（必填）
              <textarea aria-label="退回原因" value={rejectionReason} onChange={e => setRejectionReason(e.target.value)} disabled={rejectSaving} rows={3} className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--background)] p-2" autoFocus />
            </label>
            {rejectError && <p role="alert" className="text-sm text-red-600">{rejectError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="min-h-11" disabled={rejectSaving} onClick={() => setRejectTarget(null)}>取消</Button>
              <Button variant="destructive" className="min-h-11" disabled={rejectSaving || !rejectionReason.trim()} onClick={confirmReject}>{rejectSaving ? "退回中…" : "确认退回"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-label={`日报详情：${detail.employee_name} ${detail.report_date}`} className="max-h-[88dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {isAdmin ? `${detail.employee_name} 的工作记录` : "工作记录"}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <span>{detail.report_date}</span>
                  {detail.is_backfill === 1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">补交</span>}
                  <StatusBadge st={reportStatus(detail)} />
                </div>
              </div>
              <button aria-label="关闭日报详情" onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-3"><ReportReturnFeedback report={detail} onResubmit={!isAdmin && detail.employee_name === user?.name ? () => openResubmit(detail) : undefined} /></div>
            <div className="mt-4 space-y-3 text-sm">
              <ReportTranslation key={`${detail.id}-completed_items`} report={detail} field="completed_items" onTranslated={onTranslated}>
                <ul className="mt-1 space-y-1">
                  {parseItems(detail.completed_items).map((it, i) => (
                    <li key={i} className="flex gap-2"><span className="text-[var(--muted-foreground)]">{i + 1}.</span>
                      {it.href ? (
                        <a href={it.href} target="_blank" rel="noreferrer" className="break-words text-[var(--primary)] hover:underline">{it.text}</a>
                      ) : (
                        <span className="break-words">{it.text}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </ReportTranslation>
              {detail.ai_label && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[var(--muted-foreground)]">AI 质量评估</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", aiLabelClass(detail.ai_label))}>{detail.ai_label}</span>
                  </div>
                  {detail.ai_comment && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{detail.ai_comment}</p>}
                </div>
              )}
              {detail.risk_flag === 1 && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">风险</span>
                    <span className="text-xs font-medium text-[var(--foreground)]">存在风险或卡点</span>
                  </div>
                  {detail.risk_desc && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{detail.risk_desc}</p>}
                </div>
              )}
              {parseRelated(detail.related_objects).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">关联业务对象</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {parseRelated(detail.related_objects).map((r, i) => (
                      <a key={i} href={relatedObjectHref(r.type, r.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--muted)]/30 px-2 py-1 text-xs text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]">
                        <span className="text-[var(--muted-foreground)]">{relatedTypeLabel(r.type)}</span>
                        <span className="max-w-[200px] truncate">{r.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {detail.summary && (
                <ReportTranslation key={`${detail.id}-summary`} report={detail} field="summary" onTranslated={onTranslated}>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.summary}</p>
                </ReportTranslation>
              )}
              {detail.tomorrow_plan && (
                <ReportTranslation key={`${detail.id}-tomorrow_plan`} report={detail} field="tomorrow_plan" onTranslated={onTranslated}>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.tomorrow_plan}</p>
                </ReportTranslation>
              )}
              {detail.problems && (
                <ReportTranslation key={`${detail.id}-problems`} report={detail} field="problems" onTranslated={onTranslated}>
                  <p className="mt-1 whitespace-pre-wrap break-words">{detail.problems}</p>
                </ReportTranslation>
              )}
              <p className="text-xs text-[var(--muted-foreground)]">提交时间：{toThaiTime(detail.submitted_at) || "—"}</p>
            </div>

            {/* 老板点评 */}
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              {isAdmin ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--muted-foreground)]">老板点评（1-5 星）</p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setReviewRating(n)} title={`${n} 星`} className={cn("text-2xl leading-none", n <= reviewRating ? "text-amber-500" : "text-[var(--border)]")}>{n <= reviewRating ? "★" : "☆"}</button>
                    ))}
                  </div>
                  <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} rows={2} placeholder="写一句点评" className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
                  {reviewErr && <p className="text-xs text-[var(--destructive)]">{reviewErr}</p>}
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={submitReview} disabled={reviewing}>{reviewing ? "提交中…" : "保存点评"}</Button>
                    {reviewSaved && <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">✓ 已保存</span>}
                  </div>
                </div>
              ) : (
                (detail.boss_rating > 0 || detail.boss_comment) && (
                  <div>
                    <p className="text-xs font-medium text-[var(--muted-foreground)]">老板点评</p>
                    {detail.boss_rating > 0 && (
                      <div className="mt-1 text-lg leading-none text-amber-500">
                        {"★".repeat(detail.boss_rating)}{"☆".repeat(5 - detail.boss_rating)}
                      </div>
                    )}
                    {detail.boss_comment && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{detail.boss_comment}</p>}
                  </div>
                )
              )}
            </div>

            {isAdmin && detail.status === "已提交" && (
              <div className="mt-4 border-t border-[var(--border)] pt-3">
                <Button size="sm" variant="destructive" disabled={rejectSaving} onClick={() => reject(detail)}>退回</Button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
