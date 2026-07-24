"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import { WhtCustomerProfile } from "@/components/wht-customer-profile";
import {
  Plus, Save, X, Edit3, Trash2, RefreshCw, ChevronDown, ChevronRight, Check, FileDown, Search, ChevronLeft, AlertTriangle, Clock, Upload, Download, FileSpreadsheet,
} from "lucide-react";

const STATUS_OPTIONS = ["启用", "暂停", "已终止"] as const;
const SUBTYPES = ["ภ.ง.ด.1", "ภ.ง.ด.53"] as const;
const PROGRESS_OPTIONS = ["", "归档", "未归档"] as const;

const tabs = [
  { key: "customers", label: "客户白名单" },
  { key: "wht1", label: "ภ.ง.ด.1" },
  { key: "wht53", label: "ภ.ง.ด.53" },
  { key: "history", label: "历史查询" },
  { key: "reconciliation", label: "对账表" },
  { key: "summary", label: "年度汇总" },
];

interface WhtCustomer { id: number; company_name: string; tax_id: string; contact: string; status: string; }
interface WhtRecord { id: number; customer_id: number; year_month: string; subtype: string; progress: string; company_name: string; tax_id: string; customer_status: string; reminded?: number; }
interface WhtStep { id: number; record_id: number; step_order: number; step_name: string; status: string; assignee: string; }
interface WhtDashboardStats { month: string; stats: Record<string, { totalCustomers: number; completedSteps: number; archived: number; totalSteps: number }>; }

// WHT deadline: 15th of next month
// Current day > 10th of deadline month → yellow; > 12th → red (penalty risk)
function getWarningLevel(progress: string, yearMonth: string): { level: "green" | "yellow" | "red"; label: string } {
  if (progress === "归档") return { level: "green", label: "已完成" };
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return { level: "green", label: "正常" };
  const deadlineMonth = m === 12 ? 1 : m + 1;
  const deadlineYear = m === 12 ? y + 1 : y;
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  if (currentYear > deadlineYear || (currentYear === deadlineYear && currentMonth > deadlineMonth)) {
    return { level: "red", label: "已逾期" };
  }
  if (currentYear === deadlineYear && currentMonth === deadlineMonth) {
    if (currentDay > 12) return { level: "red", label: "逾期风险" };
    if (currentDay > 10) return { level: "yellow", label: "即将逾期" };
    return { level: "green", label: "正常" };
  }
  return { level: "green", label: "未到期" };
}

const warningRowStyle: Record<string, string> = {
  green: "",
  yellow: "border-l-4 border-l-amber-400 bg-amber-50/30",
  red: "border-l-4 border-l-red-400 bg-red-50/30",
};

const warningBadgeStyle: Record<string, string> = {
  green: "",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
};

// Inline editable cell for reconciliation
function EditableCell({ id, field, value, onUpdate }: { id: number; field: string; value: number; onUpdate: (id: number, field: string, value: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(value);
  
  if (!editing) {
    return (
      <span className="cursor-pointer hover:text-[var(--primary)]" onClick={() => { setTemp(value); setEditing(true); }}>
        {field === "tax_unpaid" && value > 0 ? <span className="text-red-500 font-medium">฿{value.toLocaleString()}</span> : `฿${value.toLocaleString()}`}
      </span>
    );
  }
  
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        value={temp}
        onChange={e => setTemp(Number(e.target.value))}
        className="w-20 h-7 rounded border px-2 text-xs outline-none focus:border-[var(--ring)]"
        autoFocus
        onKeyDown={e => {
          if (e.key === "Enter") { onUpdate(id, field, temp); setEditing(false); }
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <button onClick={() => { onUpdate(id, field, temp); setEditing(false); }} className="text-[var(--success)] text-xs"><Check className="size-3" /></button>
      <button onClick={() => setEditing(false)} className="text-[var(--muted-foreground)] text-xs"><X className="size-3" /></button>
    </span>
  );
}


export default function WhtPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("customers");
  const [loading, setLoading] = useState(false);

  // Customers
  const [customers, setCustomers] = useState<WhtCustomer[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [customerForm, setCustomerForm] = useState({ company_name: "", tax_id: "", contact: "", status: "启用" as string });

  // Records
  const [records, setRecords] = useState<WhtRecord[]>([]);
  const [recordMonth, setRecordMonth] = useState(new Date().toISOString().slice(0, 7));
  const [expandedRecord, setExpandedRecord] = useState<number | null>(null);
  const [stepsMap, setStepsMap] = useState<Record<number, WhtStep[]>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [searchText, setSearchText] = useState("");
  const [filterSubtype, setFilterSubtype] = useState("");
  const [filterProgress, setFilterProgress] = useState("");
  const [filterMonthFrom, setFilterMonthFrom] = useState("");
  const [filterMonthTo, setFilterMonthTo] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  // Batch
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [profileCustomerId, setProfileCustomerId] = useState<number | null>(null);

  // Import
  const [importingCsv, setImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // History
  const [historyRecords, setHistoryRecords] = useState<WhtRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);

  // Reconciliation
  const [reconMonth, setReconMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reconciliations, setReconciliations] = useState<any[]>([]);

  // Summary
  const [summaryYear, setSummaryYear] = useState(new Date().getFullYear().toString());
  const [summaryData, setSummaryData] = useState<{ year: string; customers: any[]; grand: any } | null>(null);


  // Error
  const [error, setError] = useState("");
  const [dashboardStats, setDashboardStats] = useState<WhtDashboardStats | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/wht/customers");
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth('/api/wht/stats');
      const data = await res.json();
      if (data.stats) setDashboardStats(data);
    } catch {}
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const buildRecordsUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (searchText) params.set("search", searchText);
    const subtype = activeTab === "wht1" ? "ภ.ง.ด.1" : activeTab === "wht53" ? "ภ.ง.ด.53" : filterSubtype;
    if (subtype) params.set("subtype", subtype);
    if (filterMonthFrom) params.set("month_from", filterMonthFrom);
    if (filterMonthTo) params.set("month_to", filterMonthTo);
    if (filterProgress) params.set("progress", filterProgress);
    params.set("page", String(currentPage));
    params.set("pageSize", String(pageSize));
    return `/api/wht/records?${params.toString()}`;
  }, [activeTab, searchText, filterSubtype, filterProgress, filterMonthFrom, filterMonthTo, currentPage]);

  const loadRecords = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetchWithAuth(buildRecordsUrl());
      const data = await res.json();
      setRecords(Array.isArray(data.rows) ? data.rows : []);
      setTotalRecords(data.total ?? 0);
    } catch {} finally { setRefreshing(false); }
  }, [buildRecordsUrl]);

  useEffect(() => {
    if (activeTab === "wht1" || activeTab === "wht53") setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "wht1" || activeTab === "wht53") loadRecords();
  }, [activeTab, searchText, filterSubtype, filterProgress, filterMonthFrom, filterMonthTo, currentPage, loadRecords]);

  const handleSearch = () => setCurrentPage(1);


  // Download template
  const handleDownloadTemplate = async () => {
    try {
      const res = await fetchWithAuth("/api/wht/customers?action=template");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "预扣税客户导入模板.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch { setError("下载模板失败"); }
  };

  // Import CSV
  const handleImportCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingCsv(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const res = await fetchWithAuth("/api/wht/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch_import", csv_text: text }),
      });
      const data = await res.json();
      setImportResult(data);
      if (data.success) loadCustomers();
    } catch { setError("导入失败"); }
    finally { setImportingCsv(false); e.target.value = ""; }
  };

  // Load history records
  const loadHistory = useCallback(async (opts?: { page?: number }) => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchText) params.set("search", searchText);
      if (filterSubtype) params.set("subtype", filterSubtype);
      if (filterMonthFrom) params.set("month_from", filterMonthFrom);
      if (filterMonthTo) params.set("month_to", filterMonthTo);
      if (filterProgress && filterProgress !== "未归档") params.set("progress", filterProgress);
      params.set("page", String(opts?.page ?? historyPage));
      params.set("pageSize", "20");
      const res = await fetchWithAuth(`/api/wht/records?${params.toString()}`);
      const data = await res.json();
      setHistoryRecords(data.rows || []);
      setHistoryTotal(data.total || 0);
      if (opts?.page) setHistoryPage(opts.page);
    } catch {}
    finally { setHistoryLoading(false); }
  }, [searchText, filterSubtype, filterProgress, filterMonthFrom, filterMonthTo, historyPage]);

  // Load reconciliations
  const loadReconciliations = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/wht/reconciliation?month=${reconMonth}`);
      setReconciliations(await res.json());
    } catch {}
  }, [reconMonth]);

  // Load summary
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/wht/summary?year=${summaryYear}`);
      setSummaryData(await res.json());
    } catch {}
  }, [summaryYear]);

  // Load data for new tabs
  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab, loadHistory]);
  useEffect(() => {
    if (activeTab === "reconciliation") loadReconciliations();
  }, [activeTab, reconMonth, loadReconciliations]);
  useEffect(() => {
    if (activeTab === "summary") loadSummary();
  }, [activeTab, summaryYear, loadSummary]);

  // Handle reconciliation update
  const handleReconUpdate = async (id: number, field: string, value: number) => {
    try {
      await fetchWithAuth("/api/wht/reconciliation", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, [field]: value }),
      });
      loadReconciliations();
    } catch { setError("更新失败"); }
  };
  // Batch handlers
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === records.length) setSelectedIds([]);
    else setSelectedIds(records.map(r => r.id));
  };

  const handleBatchAction = async (action: "remind" | "notice" | "pause") => {
    const labels: Record<string, string> = { remind: "标记催交", notice: "发送确认通知", pause: "批量暂停客户" };
    if (!confirm(`确认对 ${selectedIds.length} 条记录执行"${labels[action]}"？`)) return;
    setBatchLoading(true);
    try {
      const res = await fetchWithAuth("/api/wht/records/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids: selectedIds }),
      });
      if (res.ok) { setSelectedIds([]); loadRecords(); }
      else { const e = await res.json(); setError(e.error || "操作失败"); }
    } catch { setError("网络错误"); }
    finally { setBatchLoading(false); }
  };

  // Customer CRUD
  const handleAddCustomer = async () => {
    if (!customerForm.company_name.trim()) return setError("请输入公司名称");
    setLoading(true); setError("");
    try {
      const res = await fetchWithAuth("/api/wht/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customerForm),
      });
      if (res.ok) { loadCustomers(); setShowAddCustomer(false); setCustomerForm({ company_name: "", tax_id: "", contact: "", status: "启用" }); }
      else { const e = await res.json(); setError(e.error); }
    } catch { setError("添加失败"); }
    finally { setLoading(false); }
  };

  const handleUpdateCustomer = async (id: number) => {
    if (!customerForm.company_name.trim()) return setError("请输入公司名称");
    setLoading(true); setError("");
    try {
      const res = await fetchWithAuth("/api/wht/customers", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...customerForm }),
      });
      if (res.ok) { loadCustomers(); setEditingCustomerId(null); setCustomerForm({ company_name: "", tax_id: "", contact: "", status: "启用" }); }
      else { const e = await res.json(); setError(e.error); }
    } catch { setError("更新失败"); }
    finally { setLoading(false); }
  };

  const handleDeleteCustomer = async (id: number) => {
    if (!confirm("确认删除该客户？")) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/wht/customers?id=${id}`, { method: "DELETE" });
      if (res.ok) loadCustomers();
      else { const e = await res.json(); setError(e.error || "删除失败"); }
    } catch { setError("网络错误"); }
    finally { setLoading(false); }
  };

  const startEdit = (c: WhtCustomer) => {
    setEditingCustomerId(c.id);
    setCustomerForm({ company_name: c.company_name, tax_id: c.tax_id, contact: c.contact, status: c.status });
  };

  // Record generation
  const handleGenerate = async () => {
    const subtype = activeTab === "wht1" ? "ภ.ง.ด.1" : "ภ.ง.ด.53";
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/wht/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", month: recordMonth, subtype }),
      });
      if (res.ok) { const d = await res.json(); setError(""); alert(`已生成 ${d.created} 条记录`); loadRecords(); }
      else { const e = await res.json(); setError(e.error); }
    } catch { setError("生成失败"); }
    finally { setLoading(false); }
  };

  // Expand/collapse record steps
  const toggleExpand = async (recordId: number) => {
    if (expandedRecord === recordId) { setExpandedRecord(null); return; }
    setExpandedRecord(recordId);
    if (!stepsMap[recordId]) {
      try {
        const res = await fetchWithAuth(`/api/wht/records/${recordId}/steps`);
        const data = await res.json();
        setStepsMap(prev => ({ ...prev, [recordId]: Array.isArray(data) ? data : [] }));
      } catch {}
    }
  };

  const handleStepToggle = async (recordId: number, step: WhtStep) => {
    const nextStatus = step.status === "待处理" ? "进行中"
      : step.status === "进行中" ? "已完成"
      : step.status === "已完成" ? "待处理" : "待处理";
    setLoading(true);
    try {
      await fetchWithAuth(`/api/wht/records/${recordId}/steps`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_id: step.id, status: nextStatus }),
      });
      const res = await fetchWithAuth(`/api/wht/records/${recordId}/steps`);
      const data = await res.json();
      setStepsMap(prev => ({ ...prev, [recordId]: Array.isArray(data) ? data : [] }));
      loadRecords();
    } catch { setError("操作失败"); }
    finally { setLoading(false); }
  };

  const totalCount = (recordId: number) => (stepsMap[recordId] || []).length;
  const completedCount = (recordId: number) => (stepsMap[recordId] || []).filter(s => s.status === "已完成" || s.status === "已跳过").length;

  const stepIcon = (status: string) => {
    if (status === "已完成" || status === "已跳过") return <Check className="size-4 text-[var(--success)]" />;
    if (status === "进行中") return <div className="size-4 rounded-full border-2 border-[var(--primary)] flex items-center justify-center"><div className="size-2 rounded-full bg-[var(--primary)]" /></div>;
    return <div className="size-4 rounded-full border-2 border-[var(--muted-foreground)]/40" />;
  };

  const statusBadge = (status: string) => cn(
    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
    status === "启用" ? "bg-green-100 text-green-700" :
    status === "暂停" ? "bg-yellow-100 text-yellow-700" :
    "bg-red-100 text-red-700"
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-medium text-[var(--foreground)]">预扣税申报</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5">ภ.ง.ด.1 员工工资扣税 ｜ ภ.ง.ด.53 服务费代扣税</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 px-4 py-2 text-sm text-[var(--destructive)]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}><X className="size-4" /></button>
        </div>
      )}

      {importResult && (
        <div className={cn(
          "flex items-start gap-2 rounded-lg px-4 py-3 text-sm",
          importResult.errors?.length > 0 ? "bg-amber-50 border border-amber-200 text-amber-800" : "bg-emerald-50 border border-emerald-200 text-emerald-700"
        )}>
          <div className="flex-1">
            <p className="font-medium">
              {importResult.success ? `导入完成：${importResult.imported} 条成功` : "导入失败"}
              {importResult.skipped > 0 && ` · ${importResult.skipped} 条跳过`}
            </p>
            {importResult.errors?.length > 0 && (
              <ul className="mt-1 text-xs list-disc list-inside space-y-0.5">
                {importResult.errors.slice(0, 5).map((e: string, i: number) => <li key={i}>{e}</li>)}
                {importResult.errors.length > 5 && <li>...共 {importResult.errors.length} 条错误</li>}
              </ul>
            )}
            {importResult.skippedRows?.length > 0 && !importResult.errors?.length && (
              <ul className="mt-1 text-xs list-disc list-inside space-y-0.5">
                {importResult.skippedRows.slice(0, 3).map((s: string, i: number) => <li key={i}>{s}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => setImportResult(null)}><X className="size-4" /></button>
        </div>
      )}

      {/* Dashboard */}
      <div className="grid grid-cols-2 gap-4">
        {["ภ.ง.ด.1", "ภ.ง.ด.53"].map(subtype => {
          const key = subtype === "ภ.ง.ด.1" ? "wht1" : "wht53";
          const s = dashboardStats?.stats?.[subtype];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left hover:border-[color-mix(in_oklch,var(--primary),var(--background)_60%)] hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{subtype}</h3>
                <span className="text-[0.65rem] text-[var(--muted-foreground)]">{dashboardStats?.month || "—"}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-2xl font-bold text-[var(--foreground)] tabular-nums">{s?.totalCustomers ?? "—"}</p>
                  <p className="text-[0.65rem] text-[var(--muted-foreground)]">应申报客户</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--foreground)] tabular-nums">
                    {s != null ? `${s.completedSteps}/${s.totalSteps}` : "—"}
                  </p>
                  <p className="text-[0.65rem] text-[var(--muted-foreground)]">已完成步骤</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--success)] tabular-nums">{s?.archived ?? "—"}</p>
                  <p className="text-[0.65rem] text-[var(--muted-foreground)]">已归档</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-1 w-fit">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn("px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.key ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- 客户白名单 ---- */}
      {activeTab === "customers" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">客户白名单</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleDownloadTemplate} className="gap-1.5">
                <FileSpreadsheet className="size-4" />下载模板
              </Button>
              <label className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] transition-colors">
                <Upload className="size-4" />{importingCsv ? "导入中..." : "批量导入"}
                <input type="file" accept=".csv" onChange={handleImportCsv} className="hidden" disabled={importingCsv} />
              </label>
              <Button size="sm" onClick={() => { setShowAddCustomer(true); setEditingCustomerId(null); setCustomerForm({ company_name: "", tax_id: "", contact: "", status: "启用" }); }}>
                <Plus className="size-4 mr-1" />添加客户
              </Button>
            </div>
          </div>

          {(showAddCustomer || editingCustomerId !== null) && (
            <div className="rounded-lg border bg-[var(--card)] p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">公司名称 *</label>
                  <input type="text" value={customerForm.company_name} onChange={e => setCustomerForm(p => ({ ...p, company_name: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">税号</label>
                  <input type="text" value={customerForm.tax_id} onChange={e => setCustomerForm(p => ({ ...p, tax_id: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-mono outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">联系方式</label>
                  <input type="text" value={customerForm.contact} onChange={e => setCustomerForm(p => ({ ...p, contact: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs text-[var(--muted-foreground)]">状态</label>
                  <select value={customerForm.status} onChange={e => setCustomerForm(p => ({ ...p, status: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowAddCustomer(false); setEditingCustomerId(null); }}><X className="size-3.5 mr-1" />取消</Button>
                <Button size="sm" onClick={() => editingCustomerId ? handleUpdateCustomer(editingCustomerId) : handleAddCustomer()} disabled={loading}>
                  <Save className="size-3.5 mr-1" />{editingCustomerId ? "保存修改" : "确认添加"}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名称</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">税号</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">联系方式</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]/30">
                    <td className="px-4 py-3 font-medium">{c.company_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted-foreground)]">{c.tax_id || "—"}</td>
                    <td className="px-4 py-3">{c.contact || "—"}</td>
                    <td className="px-4 py-3">
                        <span className={statusBadge(c.status)}>{c.status}</span>
                        <button onClick={(e) => { e.stopPropagation(); setProfileCustomerId(c.id); }}
                          className="ml-2 text-[0.6rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline">
                          画像
                        </button>
                      </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-xs" variant="ghost" onClick={() => startEdit(c)}><Edit3 className="size-3" /></Button>
                        <Button size="icon-xs" variant="ghost" onClick={() => handleDeleteCustomer(c.id)} className="text-[var(--destructive)]"><Trash2 className="size-3" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- ภ.ง.ด.1 / ภ.ง.ด.53 ---- */}
      {(activeTab === "wht1" || activeTab === "wht53") && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              {records.length > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
                  <input type="checkbox" checked={selectedIds.length === records.length && records.length > 0}
                    onChange={toggleSelectAll} className="size-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]" />
                  全选
                </label>
              )}
              <h2 className="text-lg font-medium">{activeTab === "wht1" ? "ภ.ง.ด.1 员工工资扣税" : "ภ.ง.ด.53 服务费代扣税"}</h2>
            </div>
            <div className="flex items-center gap-2">
              <input type="month" value={recordMonth} onChange={e => setRecordMonth(e.target.value)}
                className="rounded border px-3 py-2 text-sm" />
              <Button size="sm" onClick={handleGenerate} disabled={loading} className="gap-1.5">
                <Plus className="size-3.5" />批量生成当月记录
              </Button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
                <input type="text" placeholder="搜索公司名称..." value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSearch()}
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <Button variant="outline" size="sm" onClick={handleSearch} className="gap-1.5">
                <Search className="size-3.5" />搜索
              </Button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--muted-foreground)]">月份从</label>
                <input type="month" value={filterMonthFrom} onChange={e => { setFilterMonthFrom(e.target.value); setCurrentPage(1); }}
                  className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--muted-foreground)]">到</label>
                <input type="month" value={filterMonthTo} onChange={e => { setFilterMonthTo(e.target.value); setCurrentPage(1); }}
                  className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--muted-foreground)]">子类型</label>
                <select value={filterSubtype} onChange={e => { setFilterSubtype(e.target.value); setCurrentPage(1); }}
                  className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                  <option value="">全部</option>
                  <option value="ภ.ง.ด.1">ภ.ง.ด.1</option>
                  <option value="ภ.ง.ด.53">ภ.ง.ด.53</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-[var(--muted-foreground)]">状态</label>
                <select value={filterProgress} onChange={e => { setFilterProgress(e.target.value); setCurrentPage(1); }}
                  className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                  <option value="">全部</option>
                  <option value="归档">已归档</option>
                  <option value="未归档">进行中</option>
                </select>
              </div>
              <Button variant="outline" size="sm" onClick={loadRecords} disabled={refreshing} className="gap-1.5">
                <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />刷新
              </Button>
            </div>
          </div>

          {/* Batch action bar */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--primary)]/30 bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-4 py-2.5">
              <span className="text-sm font-medium text-[var(--primary)]">已选 {selectedIds.length} 条</span>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => handleBatchAction("remind")} disabled={batchLoading} className="gap-1">
                标记已催交
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBatchAction("notice")} disabled={batchLoading} className="gap-1">
                发送确认通知
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleBatchAction("pause")} disabled={batchLoading} className="gap-1 text-[var(--destructive)] border-[var(--destructive)]/30">
                批量暂停
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])} className="gap-1">
                <X className="size-3.5" />取消
              </Button>
            </div>
          )}

          {records.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed">
              暂无申报记录
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {records.map(r => {
                  const steps = stepsMap[r.id] || [];
                  const wl = getWarningLevel(r.progress, r.year_month);
                  return (
                    <div key={r.id} className={cn("rounded-lg border bg-[var(--card)]", warningRowStyle[wl.level])}>
                      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--muted)]/30">
                        <input type="checkbox" checked={selectedIds.includes(r.id)}
                          onChange={() => toggleSelect(r.id)}
                          onClick={e => e.stopPropagation()}
                          className="size-4 rounded border-[var(--border)] cursor-pointer accent-[var(--primary)]" />
                        <span className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => toggleExpand(r.id)}>
                          {expandedRecord === r.id ? <ChevronDown className="size-4 text-[var(--muted-foreground)]" /> : <ChevronRight className="size-4 text-[var(--muted-foreground)]" />}
                          <span className="font-medium">{r.company_name}</span>
                          <button onClick={(e) => { e.stopPropagation(); setProfileCustomerId(r.customer_id); }}
                            className="text-[0.6rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline">
                            画像
                          </button>
                          <span className="flex-1" />
                          <span className="text-xs text-[var(--muted-foreground)]">{r.year_month}</span>
                          <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">{r.subtype}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{r.tax_id || "—"}</span>
                          <span className="text-sm text-[var(--muted-foreground)]">
                            {totalCount(r.id) > 0 ? `${completedCount(r.id)}/${totalCount(r.id)}` : ""}
                          </span>
                          {wl.level !== "green" && (
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", warningBadgeStyle[wl.level])}>
                              {wl.level === "red" ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                              {wl.label}
                            </span>
                          )}
                          {r.reminded ? (
                            <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700">已催交</span>
                          ) : null}
                        </span>
                        <span className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                          r.progress === "归档" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        )}>{r.progress}</span>
                      </div>
                      {expandedRecord === r.id && (
                        <div className="border-t px-4 py-3">
                          <div className="space-y-1">
                            {steps.map((s: WhtStep) => (
                              <div key={s.id}
                                className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--muted)]/20 cursor-pointer group"
                                onClick={() => handleStepToggle(r.id, s)}
                              >
                                {stepIcon(s.status)}
                                <span className={cn("text-sm flex-1", (s.status === "已完成" || s.status === "已跳过") && "text-[var(--muted-foreground)] line-through")}>
                                  {s.step_name}
                                </span>
                                <span className="text-xs text-[var(--muted-foreground)] opacity-0 group-hover:opacity-100 transition-opacity">
                                  {s.assignee && `👤 ${s.assignee}`}
                                </span>
                                {s.status === "已跳过" && <span className="text-[10px] text-amber-500">可选</span>}
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
                            <Button size="sm" variant="outline" className="gap-1" onClick={() => router.push(`/wht/${r.id}`)}>
                              查看详情
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-sm text-[var(--muted-foreground)] px-2">
                    第 {currentPage} / {totalPages} 页（共 {totalRecords} 条）
                  </span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* ---- 历史查询 ---- */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-lg font-medium">历史查询</h2>
            <Button variant="outline" size="sm" onClick={() => loadHistory()} disabled={historyLoading} className="gap-1.5">
              <RefreshCw className={cn("size-3.5", historyLoading && "animate-spin")} />刷新
            </Button>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
              <input type="text" placeholder="搜索公司名称..." value={searchText}
                onChange={e => { setSearchText(e.target.value); setHistoryPage(1); }}
                className="w-full h-9 pl-8 pr-3 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">月份从</label>
              <input type="month" value={filterMonthFrom} onChange={e => { setFilterMonthFrom(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">到</label>
              <input type="month" value={filterMonthTo} onChange={e => { setFilterMonthTo(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">子类型</label>
              <select value={filterSubtype} onChange={e => { setFilterSubtype(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                <option value="">全部</option>
                <option value="ภ.ง.ด.1">ภ.ง.ด.1</option>
                <option value="ภ.ง.ด.53">ภ.ง.ด.53</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">状态</label>
              <select value={filterProgress} onChange={e => { setFilterProgress(e.target.value); setHistoryPage(1); }}
                className="h-8 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                <option value="">全部</option>
                <option value="归档">已归档</option>
                <option value="未归档">进行中</option>
              </select>
            </div>
          </div>

          {historyRecords.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed">
              暂无历史申报记录
            </div>
          ) : (
            <>
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名称</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">月份</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">子类型</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">进度</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">金额</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRecords.map((r: WhtRecord) => {
                      const wl = getWarningLevel(r.progress, r.year_month);
                      return (
                        <tr key={r.id} className={cn("border-t border-[var(--border)] hover:bg-[var(--muted)]/30", warningRowStyle[wl.level])}>
                          <td className="px-4 py-3 font-medium">
                            <span className="cursor-pointer hover:text-[var(--primary)] hover:underline"
                              onClick={() => router.push(`/wht/${r.id}`)}>{r.company_name}</span>
                            <button onClick={(e) => { e.stopPropagation(); setProfileCustomerId(r.customer_id); }}
                              className="ml-2 text-[0.6rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline">画像</button>
                          </td>
                          <td className="px-4 py-3 text-[var(--muted-foreground)]">{r.year_month}</td>
                          <td className="px-4 py-3">
                            <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-[var(--muted)]">{r.subtype}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                r.progress === "归档" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                              )}>{r.progress}</span>
                              {wl.level !== "green" && (
                                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-medium", warningBadgeStyle[wl.level])}>
                                  {wl.level === "red" ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                                  {wl.label}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs">{(r as any).amount > 0 ? `฿${(r as any).amount.toLocaleString()}` : "—"}</td>
                          <td className="px-4 py-3 text-right">
                            <Button size="icon-xs" variant="ghost" onClick={() => router.push(`/wht/${r.id}`)}>
                              <ChevronRight className="size-4" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {Math.ceil(historyTotal / 20) > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button variant="outline" size="sm" disabled={historyPage <= 1}
                    onClick={() => setHistoryPage(p => Math.max(1, p - 1))}>
                    <ChevronLeft className="size-4" />
                  </Button>
                  <span className="text-sm text-[var(--muted-foreground)] px-2">
                    第 {historyPage} / {Math.ceil(historyTotal / 20)} 页（共 {historyTotal} 条）
                  </span>
                  <Button variant="outline" size="sm" disabled={historyPage >= Math.ceil(historyTotal / 20)}
                    onClick={() => setHistoryPage(p => Math.min(Math.ceil(historyTotal / 20), p + 1))}>
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---- 对账表 ---- */}
      {activeTab === "reconciliation" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">对账表</h2>
            <div className="flex items-center gap-2">
              <input type="month" value={reconMonth} onChange={e => setReconMonth(e.target.value)}
                className="rounded border px-3 py-2 text-sm" />
              <Button variant="outline" size="sm" onClick={loadReconciliations} className="gap-1.5">
                <RefreshCw className="size-3.5" />刷新
              </Button>
            </div>
          </div>

          {reconciliations.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed">
              暂无对账数据
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名称</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">月份</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">应付税金</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">已付税金</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">未付税金</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliations.map((rec: any) => (
                    <tr key={rec.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]/30">
                      <td className="px-4 py-3 font-medium">{rec.company_name}</td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">{rec.year_month}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        <EditableCell id={rec.id} field="tax_payable" value={rec.tax_payable} onUpdate={handleReconUpdate} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        <EditableCell id={rec.id} field="tax_paid" value={rec.tax_paid} onUpdate={handleReconUpdate} />
                      </td>
                      <td className={cn("px-4 py-3 text-right font-mono text-xs", rec.tax_unpaid > 0 && "text-red-500 font-medium")}>
                        <EditableCell id={rec.id} field="tax_unpaid" value={rec.tax_unpaid} onUpdate={handleReconUpdate} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={(e) => { e.stopPropagation(); setProfileCustomerId(rec.customer_id); }}
                          className="text-[0.6rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline">画像</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- 年度汇总 ---- */}
      {activeTab === "summary" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">年度汇总</h2>
            <div className="flex items-center gap-2">
              <select className="rounded border px-3 py-2 text-sm" value={summaryYear}
                onChange={e => setSummaryYear(e.target.value)}>
                {(() => {
                  const years = [];
                  for (let y = new Date().getFullYear(); y >= 2024; y--) years.push(y);
                  return years.map(y => <option key={y} value={y}>{y}年</option>);
                })()}
              </select>
              {summaryData && summaryData.customers.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => {
                  import("@/lib/export").then(({ exportToExcel }) => {
                    const cols = [
                      { header: "公司名称", key: "companyName" as const },
                      { header: "税号", key: "taxId" as const },
                      { header: "ภ.ง.ด.1笔数", key: "wht1Count" as const },
                      { header: "ภ.ง.ด.53笔数", key: "wht53Count" as const },
                      { header: "总申报笔数", key: "totalRecords" as const },
                      { header: "已归档", key: "archivedRecords" as const },
                      { header: "未完成", key: "overdueRecords" as const },
                      { header: "预扣税总额", key: "totalAmount" as const, render: (r: any) => `฿${r.totalAmount.toLocaleString()}` },
                      { header: "已付", key: "totalPaid" as const, render: (r: any) => `฿${r.totalPaid.toLocaleString()}` },
                      { header: "未付", key: "totalUnpaid" as const, render: (r: any) => `฿${r.totalUnpaid.toLocaleString()}` },
                    ];
                    exportToExcel(summaryData.customers, cols, `WHT年度汇总_${summaryYear}`);
                  });
                }}>
                  <Download className="size-4 mr-1" />导出Excel
                </Button>
              )}
            </div>
          </div>

          {!summaryData ? (
            <div className="flex items-center justify-center py-12">
              <div className="size-6 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
            </div>
          ) : summaryData.customers.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed">
              {summaryYear} 年暂无申报记录
            </div>
          ) : (
            <>
              {/* Grand totals */}
              <div className="grid grid-cols-6 gap-3">
                {[
                  { label: "总申报", value: summaryData.grand.totalRecords, color: "text-[var(--foreground)]" },
                  { label: "已归档", value: summaryData.grand.archivedRecords, color: "text-emerald-600" },
                  { label: "未完成", value: summaryData.grand.overdueRecords, color: "text-amber-600" },
                  { label: "总金额", value: `฿${summaryData.grand.totalAmount.toLocaleString()}`, color: "text-[var(--foreground)]" },
                  { label: "已付", value: `฿${summaryData.grand.totalPaid.toLocaleString()}`, color: "text-emerald-600" },
                  { label: "未付", value: `฿${summaryData.grand.totalUnpaid.toLocaleString()}`, color: "text-red-500" },
                ].map(item => (
                  <div key={item.label} className="rounded-lg border bg-[var(--card)] p-3 text-center">
                    <p className={cn("text-sm font-bold tabular-nums", item.color)}>{item.value}</p>
                    <p className="text-[0.6rem] text-[var(--muted-foreground)]">{item.label}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--muted)]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--muted-foreground)]">公司名称</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted-foreground)]">ภ.ง.ด.1</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted-foreground)]">ภ.ง.ด.53</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted-foreground)]">总数</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted-foreground)]">已归档</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-[var(--muted-foreground)]">未完成</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">总金额</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-[var(--muted-foreground)]">未付</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.customers.map((c: any) => (
                      <tr key={c.customerId} className="border-t border-[var(--border)] hover:bg-[var(--muted)]/30">
                        <td className="px-4 py-3 font-medium">{c.companyName}</td>
                        <td className="px-4 py-3 text-center">{c.wht1Count}</td>
                        <td className="px-4 py-3 text-center">{c.wht53Count}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{c.totalRecords}</td>
                        <td className="px-4 py-3 text-center text-emerald-600 tabular-nums">{c.archivedRecords}</td>
                        <td className="px-4 py-3 text-center text-amber-600 tabular-nums">{c.overdueRecords}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">฿{c.totalAmount.toLocaleString()}</td>
                        <td className={cn("px-4 py-3 text-right font-mono text-xs tabular-nums", c.totalUnpaid > 0 && "text-red-500")}>฿{c.totalUnpaid.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}


      {/* Customer Profile Panel */}
      {profileCustomerId && (
        <WhtCustomerProfile
          customerId={profileCustomerId}
          onClose={() => setProfileCustomerId(null)}
        />
      )}

    </div>
  );
}
