"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { VatCustomerProfile } from "@/components/vat-customer-profile";
import {
  Users, FileText, Calculator, Search, History, BarChart3,
  Plus, Trash2, Edit3, Save, X, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, Send, Pause, Square, Ban, Mail, Bell,
  FileCheck, ClipboardCheck, Archive, ArrowUpRight, Layers
} from "lucide-react";

// ===== Types =====
interface VatCustomer {
  id: number; company_name: string; tax_id: string; contact: string;
  status: string; created_at: string;
}
interface VatRecord {
  id: number; customer_id: number; year_month: string; progress: string;
  amount: number; assignee: string; created_at: string;
  company_name?: string; tax_id?: string;
}
interface VatReconciliation {
  id: number; customer_id: number; year_month: string;
  tax_payable: number; tax_paid: number; tax_unpaid: number; notes: string;
  company_name?: string;
}
interface DashboardData {
  totalEnabled: number; totalRecords: number;
  docsSubmitted: number; reviewed: number; filedSubmitted: number; archived: number;
  month: string;
}

const TABS = [
  { key: "customers", label: "客户白名单", icon: Users },
  { key: "records", label: "本月申报", icon: FileText },
  { key: "reconciliation", label: "对账表", icon: Calculator },
  { key: "history", label: "历史查询", icon: Search },
  { key: "summary", label: "年度汇总", icon: BarChart3 },
] as const;

const STATUS_OPTIONS = ["启用", "暂停", "已终止"] as const;

const DASHBOARD_CARDS = [
  { key: "totalRecords", label: "本月应申报", icon: Layers, color: "text-[var(--foreground)]", bg: "bg-[var(--card)]" },
  { key: "docsSubmitted", label: "已交资料", icon: ClipboardCheck, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950" },
  { key: "reviewed", label: "审核完毕", icon: FileCheck, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950" },
  { key: "filedSubmitted", label: "已提交申报", icon: Send, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-950" },
  { key: "archived", label: "已归档", icon: Archive, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950" },
] as const;

// --- Warning helpers ---
function getWarningLevel(progress: string, yearMonth: string): { level: "green" | "yellow" | "orange" | "red"; label: string; daysOverdue: number; estimatedFine: number } {
  if (progress === "归档完成") return { level: "green", label: "已完成", daysOverdue: 0, estimatedFine: 0 };
  if (progress !== "收资料") return { level: "green", label: "进行中", daysOverdue: 0, estimatedFine: 0 };

  const [y, m] = yearMonth.split("-").map(Number);
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Only warn for current month, or past months
  if (currentYear < y || (currentYear === y && currentMonth < m)) {
    return { level: "green", label: "未到期", daysOverdue: 0, estimatedFine: 0 };
  }

  if (currentYear === y && currentMonth === m) {
    if (currentDay >= 10) return { level: "red", label: "逾期", daysOverdue: currentDay - 10, estimatedFine: (currentDay - 10) * 500 };
    if (currentDay >= 7) return { level: "orange", label: "即将逾期", daysOverdue: currentDay - 7, estimatedFine: 0 };
    if (currentDay >= 5) return { level: "yellow", label: "需关注", daysOverdue: currentDay - 5, estimatedFine: 0 };
    return { level: "green", label: "正常", daysOverdue: 0, estimatedFine: 0 };
  }

  // Past month
  const totalDays = currentDay + 30; // rough
  return { level: "red", label: "逾期", daysOverdue: totalDays, estimatedFine: totalDays * 500 };
}

const warningStyles: Record<string, string> = {
  green: "",
  yellow: "border-l-4 border-l-amber-400 bg-amber-50/30 dark:bg-amber-950/20",
  orange: "border-l-4 border-l-orange-400 bg-orange-50/30 dark:bg-orange-950/20",
  red: "border-l-4 border-l-red-400 bg-red-50/30 dark:bg-red-950/20",
};

const warningBadge: Record<string, string> = {
  green: "bg-[var(--success)] text-[var(--success-foreground)]",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  orange: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  red: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export default function VatPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("customers");
  const [filterBy, setFilterBy] = useState<string | null>(null);

  // Customers
  const [customers, setCustomers] = useState<VatCustomer[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [customerForm, setCustomerForm] = useState({ company_name: "", tax_id: "", contact: "", status: "启用" as string });

  // Records
  const [records, setRecords] = useState<VatRecord[]>([]);
  const [allRecords, setAllRecords] = useState<VatRecord[]>([]); // unfiltered for history
  const [recordMonth, setRecordMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Dashboard
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);

  // Reconciliation
  const [reconciliations, setReconciliations] = useState<VatReconciliation[]>([]);
  const [reconMonth, setReconMonth] = useState(new Date().toISOString().slice(0, 7));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profileCustomerId, setProfileCustomerId] = useState<number | null>(null);

  // ===== Load data =====
  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/vat/customers");
      setCustomers(Array.isArray(await res.json()) ? await res.json() : []);
    } catch { setCustomers([]); }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/dashboard?month=${recordMonth}`);
      setDashboard(await res.json());
    } catch { setDashboard(null); }
  }, [recordMonth]);

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/records?month=${recordMonth}`);
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      setRecords(arr);
      setAllRecords(arr);
      setSelectedIds(new Set());
    } catch { setRecords([]); setAllRecords([]); }
  }, [recordMonth]);

  const loadReconciliations = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/reconciliation?month=${reconMonth}`);
      setReconciliations(Array.isArray(await res.json()) ? await res.json() : []);
    } catch { setReconciliations([]); }
  }, [reconMonth]);

  useEffect(() => { loadCustomers(); loadDashboard(); }, [loadCustomers, loadDashboard]);
  useEffect(() => {
    if (activeTab === "records") loadRecords();
    if (activeTab === "history") {
      fetchWithAuth("/api/vat/records").then(r => r.json()).then(d => setAllRecords(Array.isArray(d) ? d : [])).catch(() => {});
    }
    if (activeTab === "reconciliation") loadReconciliations();
  }, [activeTab, loadRecords, loadReconciliations]);

  // Apply filter when filterBy changes
  useEffect(() => {
    if (!filterBy || activeTab !== "records") return;
    const refetch = async () => {
      const res = await fetchWithAuth(`/api/vat/records?month=${recordMonth}`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    };
    refetch();
  }, [filterBy, activeTab, recordMonth]);

  // ===== Dashboard click → jump to records tab with filter =====
  const handleDashboardClick = (filterKey: string) => {
    setFilterBy(filterKey);
    setActiveTab("records");
  };

  // ===== Customer CRUD =====
  const handleAddCustomer = async () => {
    if (!customerForm.company_name.trim()) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/vat/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customerForm),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "添加失败"); return; }
      setShowAddCustomer(false);
      setCustomerForm({ company_name: "", tax_id: "", contact: "", status: "启用" });
      loadCustomers(); loadDashboard();
    } catch { setError("添加客户失败"); }
    finally { setLoading(false); }
  };

  const handleUpdateCustomer = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/vat/customers", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...customerForm }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "更新失败"); return; }
      setEditingCustomerId(null); loadCustomers(); loadDashboard();
    } catch { setError("更新客户失败"); }
    finally { setLoading(false); }
  };

  const handleDeleteCustomer = async (id: number) => {
    if (!confirm("确认删除该客户？")) return;
    try { await fetchWithAuth(`/api/vat/customers?id=${id}`, { method: "DELETE" }); loadCustomers(); loadDashboard(); }
    catch { setError("删除失败"); }
  };

  const startEditCustomer = (c: VatCustomer) => {
    setEditingCustomerId(c.id);
    setCustomerForm({ company_name: c.company_name, tax_id: c.tax_id, contact: c.contact, status: c.status });
  };

  // ===== Batch operations =====
  const toggleSelectAll = () => {
    if (selectedIds.size === records.length) { setSelectedIds(new Set()); return; }
    setSelectedIds(new Set(records.map(r => r.id)));
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const handleBatchAction = async (action: string) => {
    if (selectedIds.size === 0) { setError("请先选择记录"); return; }
    const ids = Array.from(selectedIds);
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/vat/records/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, record_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "操作失败"); return; }
      if (action === "pause") { loadCustomers(); loadDashboard(); }
      setError("");
      setSelectedIds(new Set());
      loadRecords();
    } catch { setError("批量操作失败"); }
    finally { setLoading(false); }
  };

  // ===== Filter records for dashboard click =====
  const filteredRecords = useMemo(() => {
    if (!filterBy) return records;
    if (filterBy === "totalRecords") return records;

    // For more granular filtering, we need step-level data — approximate with progress
    const progressMap: Record<string, string[]> = {
      docsSubmitted: ["Excel 计算", "发客户确认", "e-Filing 提交", "付款纳税", "归档完成"],
      reviewed: ["e-Filing 提交", "付款纳税", "归档完成"],
      filedSubmitted: ["付款纳税", "归档完成"],
      archived: ["归档完成"],
    };
    const allowed = progressMap[filterBy];
    if (!allowed) return records;
    return records.filter(r => allowed.includes(r.progress));
  }, [records, filterBy]);

  // ===== Progress bar =====
  const progressPct = dashboard && dashboard.totalRecords > 0
    ? Math.round((dashboard.archived / dashboard.totalRecords) * 100)
    : 0;

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      "启用": "bg-[var(--success)] text-[var(--success-foreground)]",
      "暂停": "bg-[color-mix(in_oklch,var(--warning),var(--background)_20%)] text-[var(--warning-foreground)]",
      "已终止": "bg-[var(--muted)] text-[var(--muted-foreground)]",
    };
    return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", map[s] || map["暂停"]);
  };

  // ===== Render =====
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight">VAT申报</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">VAT客户管理、月度申报、对账与历史查询</p>
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-4 py-3 text-sm text-[var(--destructive)] flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 hover:opacity-70 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* ===== Dashboard (always visible) ===== */}
      {dashboard && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {DASHBOARD_CARDS.map(card => {
              const val = (dashboard as any)[card.key] || 0;
              return (
                <button
                  key={card.key}
                  onClick={() => handleDashboardClick(card.key)}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg border p-4 text-left transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer",
                    card.bg
                  )}
                >
                  <div className="flex items-center gap-2">
                    <card.icon className={cn("size-4", card.color)} />
                    <span className="text-xs text-[var(--muted-foreground)]">{card.label}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums">{val}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">户</span>
                  </div>
                  <span className="text-[0.65rem] text-[var(--muted-foreground)]/60 flex items-center gap-0.5">
                    查看详情 <ArrowUpRight className="size-2.5" />
                  </span>
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">本月整体进度</span>
              <span className="text-sm tabular-nums font-medium">{progressPct}%</span>
            </div>
            <div className="h-3 rounded-full bg-[var(--muted)] overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  progressPct === 100 ? "bg-emerald-500" :
                  progressPct >= 60 ? "bg-[var(--primary)]" :
                  progressPct >= 30 ? "bg-amber-500" :
                  "bg-red-500"
                )}
                style={{ width: `${Math.max(progressPct, 3)}%` }}
              />
            </div>
            <div className="flex justify-between mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">
              <span>0%</span>
              <span>{dashboard.archived}/{dashboard.totalRecords} 已归档</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}

              {/* Quick actions */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              const res = await fetchWithAuth("/api/vat/notify", { method: "POST" });
              const data = await res.json();
              if (res.ok) setError(`✅ ${data.message}`);
              else setError(data.error || "发送失败");
            } catch { setError("发送对账通知失败"); }
          }}>
            <Bell className="size-4 mr-1" />发送对账通知
          </Button>
        </div>

        {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--muted)] p-1 w-fit flex-wrap">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setFilterBy(null); }}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              activeTab === t.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            <t.icon className="size-4" />
            {t.label}
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
            <div className="rounded-lg border p-4 flex flex-col gap-3 bg-[var(--card)]">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input className="rounded border px-3 py-2 text-sm" placeholder="公司名称 *"
                  value={customerForm.company_name}
                  onChange={e => setCustomerForm(p => ({ ...p, company_name: e.target.value }))} />
                <input className="rounded border px-3 py-2 text-sm" placeholder="税号"
                  value={customerForm.tax_id}
                  onChange={e => setCustomerForm(p => ({ ...p, tax_id: e.target.value }))} />
                <input className="rounded border px-3 py-2 text-sm" placeholder="联系方式"
                  value={customerForm.contact}
                  onChange={e => setCustomerForm(p => ({ ...p, contact: e.target.value }))} />
                <select className="rounded border px-3 py-2 text-sm"
                  value={customerForm.status}
                  onChange={e => setCustomerForm(p => ({ ...p, status: e.target.value }))}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => editingCustomerId ? handleUpdateCustomer(editingCustomerId) : handleAddCustomer()} disabled={loading}>
                  <Save className="size-4 mr-1" />{editingCustomerId ? "保存" : "添加"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddCustomer(false); setEditingCustomerId(null); }}>
                  <X className="size-4 mr-1" />取消
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">公司名称</th>
                  <th className="px-4 py-3 text-left font-medium">税号</th>
                  <th className="px-4 py-3 text-left font-medium">联系方式</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-left font-medium">创建时间</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无客户数据</td></tr>
                ) : customers.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-3 font-medium cursor-pointer hover:text-[var(--primary)] hover:underline" onClick={() => setProfileCustomerId(c.id)}>{c.company_name}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{c.tax_id || "—"}</td>
                    <td className="px-4 py-3">{c.contact || "—"}</td>
                    <td className="px-4 py-3"><span className={statusBadge(c.status)}>{c.status}</span></td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{c.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon-xs" variant="ghost" onClick={() => startEditCustomer(c)}><Edit3 className="size-3" /></Button>
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

      {/* ---- 本月申报 (with batch ops + warnings) ---- */}
      {activeTab === "records" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium">本月申报</h2>
              {filterBy && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-xs text-[var(--primary)]">
                  {DASHBOARD_CARDS.find(c => c.key === filterBy)?.label || filterBy}
                  <button onClick={() => setFilterBy(null)}><X className="size-3" /></button>
                </span>
              )}
            </div>
            <input type="month" value={recordMonth} onChange={e => { setRecordMonth(e.target.value); setFilterBy(null); }}
              className="rounded border px-3 py-2 text-sm" />
          </div>

          {/* Batch actions bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_95%)] px-4 py-2">
              <span className="text-sm font-medium">已选 {selectedIds.size} 条</span>
              <div className="flex-1" />
              <Button size="xs" variant="outline" onClick={() => handleBatchAction("urge")} disabled={loading}>
                <Mail className="size-3 mr-1" />已催交资料
              </Button>
              <Button size="xs" variant="outline" onClick={() => handleBatchAction("notify")} disabled={loading}>
                <Send className="size-3 mr-1" />发确认通知
              </Button>
              <Button size="xs" variant="outline" onClick={() => handleBatchAction("pause")} disabled={loading} className="text-[var(--destructive)] border-[var(--destructive)]">
                <Pause className="size-3 mr-1" />批量暂停
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setSelectedIds(new Set())}><X className="size-3" /></Button>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" className="size-4 rounded"
                      checked={records.length > 0 && selectedIds.size === records.length}
                      onChange={toggleSelectAll} />
                  </th>
                  <th className="px-4 py-3 text-left font-medium">公司名称</th>
                  <th className="px-4 py-3 text-left font-medium">税号</th>
                  <th className="px-4 py-3 text-left font-medium">进度</th>
                  <th className="px-4 py-3 text-left font-medium">预警</th>
                  <th className="px-4 py-3 text-left font-medium">负责人</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无申报记录</td></tr>
                ) : filteredRecords.map(r => {
                  const warn = getWarningLevel(r.progress, r.year_month);
                  return (
                    <tr key={r.id} className={cn("border-t transition-colors group", warningStyles[warn.level])}>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" className="size-4 rounded"
                          checked={selectedIds.has(r.id)}
                          onChange={() => toggleSelect(r.id)} />
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <span className="cursor-pointer hover:text-[var(--primary)] hover:underline"
                          onClick={(e) => { e.stopPropagation(); window.location.href = `/vat/${r.id}`; }}>
                          {r.company_name || "—"}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); setProfileCustomerId(r.customer_id); }}
                          className="ml-2 text-[0.6rem] text-[var(--muted-foreground)] hover:text-[var(--primary)] underline">
                          画像
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted-foreground)]">{r.tax_id || "—"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                          {r.progress === "归档完成" ? <CheckCircle2 className="size-3" /> :
                           r.progress === "收资料" ? <Clock className="size-3 text-[var(--muted-foreground)]" /> :
                           <Clock className="size-3" />}
                          {r.progress}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", warningBadge[warn.level])}>
                          {warn.level === "red" && <AlertTriangle className="size-3" />}
                          {warn.label}
                        </span>
                        {warn.estimatedFine > 0 && (
                          <span className="ml-1.5 text-[0.65rem] text-[var(--destructive)]">
                            罚款约 ¥{warn.estimatedFine.toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">{r.assignee || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {records.length === 0 && (
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const res = await fetchWithAuth("/api/vat/records/generate", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ month: recordMonth }),
                });
                if (res.ok) { loadRecords(); loadDashboard(); }
                else { const e = await res.json(); setError(e.error || "生成失败"); }
              } catch { setError("生成申报记录失败"); }
            }}>
              <Plus className="size-4 mr-1" />批量生成当月记录
            </Button>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-[var(--success)] inline-block" /> 正常</span>
            <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-amber-400 inline-block" /> 5号后未交资料</span>
            <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-orange-400 inline-block" /> 7号后</span>
            <span className="flex items-center gap-1"><span className="size-3 rounded-sm bg-red-400 inline-block" /> 逾期</span>
          </div>
        </div>
      )}

      {/* ---- 对账表 ---- */}
      {activeTab === "reconciliation" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">对账表</h2>
            <input type="month" value={reconMonth} onChange={e => setReconMonth(e.target.value)}
              className="rounded border px-3 py-2 text-sm" />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">公司名称</th>
                  <th className="px-4 py-3 text-left font-medium">月份</th>
                  <th className="px-4 py-3 text-right font-medium">应付税金</th>
                  <th className="px-4 py-3 text-right font-medium">已付税金</th>
                  <th className="px-4 py-3 text-right font-medium">未付税金</th>
                  <th className="px-4 py-3 text-left font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {reconciliations.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无对账数据</td></tr>
                ) : reconciliations.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{r.company_name || "—"}</td>
                    <td className="px-4 py-3">{r.year_month}</td>
                    <td className="px-4 py-3 text-right">¥{r.tax_payable.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-[var(--success)]">¥{r.tax_paid.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-medium text-[var(--destructive)]">¥{r.tax_unpaid.toLocaleString()}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{r.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- 历史查询 ---- */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">历史查询</h2>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="搜索公司名称..."
                className="rounded border px-3 py-2 text-sm w-48"
                onChange={async (e) => {
                  const q = e.target.value;
                  try {
                    if (!q) {
                      const res = await fetchWithAuth("/api/vat/records");
                      setAllRecords(Array.isArray(await res.json()) ? await res.json() : []);
                      return;
                    }
                    const res = await fetchWithAuth(`/api/vat/records?search=${encodeURIComponent(q)}`);
                    setAllRecords(Array.isArray(await res.json()) ? await res.json() : []);
                  } catch {}
                }} />
              <select className="rounded border px-3 py-2 text-sm"
                onChange={async (e) => {
                  const m = e.target.value;
                  try {
                    const url = m ? `/api/vat/records?month=${m}` : "/api/vat/records";
                    const res = await fetchWithAuth(url);
                    setAllRecords(Array.isArray(await res.json()) ? await res.json() : []);
                  } catch {}
                }}>
                <option value="">全部月份</option>
                {(() => {
                  const months = [];
                  const now = new Date();
                  for (let i = 0; i < 24; i++) {
                    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                    months.push(d.toISOString().slice(0, 7));
                  }
                  return months.map(m => <option key={m} value={m}>{m}</option>);
                })()}
              </select>
            </div>
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">公司名称</th>
                  <th className="px-4 py-3 text-left font-medium">申报月份</th>
                  <th className="px-4 py-3 text-left font-medium">进度</th>
                  <th className="px-4 py-3 text-left font-medium">金额</th>
                  <th className="px-4 py-3 text-left font-medium">负责人</th>
                </tr>
              </thead>
              <tbody>
                {!allRecords.length ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无历史记录</td></tr>
                ) : allRecords.map(r => (
                  <tr key={r.id} className="border-t hover:bg-[var(--muted)] cursor-pointer transition-colors"
                    onClick={() => window.location.href = `/vat/${r.id}`}>
                    <td className="px-4 py-3 font-medium text-[var(--primary)] hover:underline">{r.company_name || "—"}</td>
                    <td className="px-4 py-3">{r.year_month}</td>
                    <td className="px-4 py-3">{r.progress}</td>
                    <td className="px-4 py-3">{r.amount > 0 ? `¥${r.amount.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3">{r.assignee || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- 年度汇总 ---- */}
      {activeTab === "summary" && (
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">年度汇总</h2>
          <p className="text-sm text-[var(--muted-foreground)]">按年度汇总各客户的 VAT 申报情况、税金统计。报表功能下一轮实现。</p>
          <div className="rounded-lg border p-8 text-center text-[var(--muted-foreground)]">
            <BarChart3 className="size-8 mx-auto mb-2 opacity-30" />
            年度汇总功能将在下一轮迭代中完善
          </div>
        </div>
      )}
    {profileCustomerId && (
        <VatCustomerProfile
          customerId={profileCustomerId}
          onClose={() => setProfileCustomerId(null)}
        />
      )}
    </div>
  );
}
