"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Plus, Save, X, Edit3, Trash2, RefreshCw, ChevronDown, ChevronRight, Check, FileDown, Search, ChevronLeft, AlertTriangle, Clock,
} from "lucide-react";

const STATUS_OPTIONS = ["启用", "暂停", "已终止"] as const;
const SUBTYPES = ["ภ.ง.ด.1", "ภ.ง.ด.53"] as const;
const PROGRESS_OPTIONS = ["", "归档", "未归档"] as const;

const tabs = [
  { key: "customers", label: "客户白名单" },
  { key: "wht1", label: "ภ.ง.ด.1" },
  { key: "wht53", label: "ภ.ง.ด.53" },
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
            <Button size="sm" onClick={() => { setShowAddCustomer(true); setEditingCustomerId(null); setCustomerForm({ company_name: "", tax_id: "", contact: "", status: "启用" }); }}>
              <Plus className="size-4 mr-1" />添加客户
            </Button>
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
                    <td className="px-4 py-3"><span className={statusBadge(c.status)}>{c.status}</span></td>
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
                          <span className="font-medium flex-1">{r.company_name}</span>
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
    </div>
  );
}
