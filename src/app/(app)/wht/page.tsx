"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Plus, Save, X, Edit3, Trash2, RefreshCw, ChevronDown, ChevronRight, Check, FileDown,
} from "lucide-react";

const STATUS_OPTIONS = ["启用", "暂停", "已终止"] as const;
const SUBTYPES = ["ภ.ง.ด.1", "ภ.ง.ด.53"] as const;

const tabs = [
  { key: "customers", label: "客户白名单" },
  { key: "wht1", label: "ภ.ง.ด.1" },
  { key: "wht53", label: "ภ.ง.ด.53" },
];

interface WhtCustomer { id: number; company_name: string; tax_id: string; contact: string; status: string; }
interface WhtRecord { id: number; customer_id: number; year_month: string; subtype: string; progress: string; company_name: string; tax_id: string; customer_status: string; }
interface WhtStep { id: number; record_id: number; step_order: number; step_name: string; status: string; assignee: string; }

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

  // Error
  const [error, setError] = useState("");

  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/wht/customers");
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const loadRecords = useCallback(async () => {
    setRefreshing(true);
    try {
      const subtype = activeTab === "wht1" ? "ภ.ง.ด.1" : activeTab === "wht53" ? "ภ.ง.ด.53" : "";
      const url = `/api/wht/records?month=${recordMonth}&subtype=${subtype}`;
      const res = await fetchWithAuth(url);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch {} finally { setRefreshing(false); }
  }, [activeTab, recordMonth]);

  useEffect(() => {
    if (activeTab === "wht1" || activeTab === "wht53") loadRecords();
  }, [activeTab, recordMonth, loadRecords]);

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
    setLoading(true); setError("");
    try {
      const subtype = activeTab === "wht1" ? "ภ.ง.ด.1" : "ภ.ง.ด.53";
      const res = await fetchWithAuth("/api/wht/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", month: recordMonth, subtype }),
      });
      const data = await res.json();
      if (res.ok) loadRecords();
      else setError(data.error);
    } catch { setError("生成失败"); }
    finally { setLoading(false); }
  };

  // Steps
  const toggleExpand = async (recordId: number) => {
    if (expandedRecord === recordId) { setExpandedRecord(null); return; }
    setExpandedRecord(recordId);
    if (!stepsMap[recordId]) {
      const res = await fetchWithAuth(`/api/wht/records/${recordId}/steps`);
      const data = await res.json();
      setStepsMap(prev => ({ ...prev, [recordId]: Array.isArray(data) ? data : [] }));
    }
  };

  const handleStepToggle = async (recordId: number, step: WhtStep) => {
    const newStatus = step.status === "已完成" ? "待处理" : "已完成";
    const res = await fetchWithAuth(`/api/wht/records/${recordId}/steps`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step_id: step.id, status: newStatus }),
    });
    if (res.ok) {
      const data = await res.json();
      setStepsMap(prev => ({ ...prev, [recordId]: Array.isArray(data) ? data : [] }));
      loadRecords();
    }
  };

  const completedCount = (recordId: number) => {
    const steps = stepsMap[recordId] || [];
    return steps.filter((s: WhtStep) => s.status === "已完成" || s.status === "已跳过").length;
  };
  const totalCount = (recordId: number) => (stepsMap[recordId] || []).length;

  const statusBadge = (s: string) => cn(
    "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
    s === "启用" ? "bg-[var(--success)] text-[var(--success-foreground)]" :
    s === "暂停" ? "bg-amber-100 text-amber-700" :
    "bg-[var(--muted)] text-[var(--muted-foreground)]"
  );

  const stepIcon = (status: string) => {
    if (status === "已完成") return <Check className="size-3 text-green-600" />;
    if (status === "已跳过") return <span className="text-[10px] text-gray-400">—</span>;
    return <div className="size-3 rounded-full border border-[var(--border)]" />;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">预扣税申报</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-0.5">ภ.ง.ด.1 员工工资扣税 ｜ ภ.ง.ด.53 服务费代扣税</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 px-4 py-2 text-sm text-[var(--destructive)]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")}><X className="size-4" /></button>
        </div>
      )}

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
            <div className="rounded-lg border p-4 flex flex-col gap-3 bg-[var(--card)]">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input className="rounded border px-3 py-2 text-sm" placeholder="公司名称 *" value={customerForm.company_name}
                  onChange={e => setCustomerForm(p => ({ ...p, company_name: e.target.value }))} />
                <input className="rounded border px-3 py-2 text-sm" placeholder="税号" value={customerForm.tax_id}
                  onChange={e => setCustomerForm(p => ({ ...p, tax_id: e.target.value }))} />
                <input className="rounded border px-3 py-2 text-sm" placeholder="联系方式" value={customerForm.contact}
                  onChange={e => setCustomerForm(p => ({ ...p, contact: e.target.value }))} />
                <select className="rounded border px-3 py-2 text-sm" value={customerForm.status}
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
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无客户数据</td></tr>
                ) : customers.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-3 font-medium">{c.company_name}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{c.tax_id || "—"}</td>
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
            <h2 className="text-lg font-medium">{activeTab === "wht1" ? "ภ.ง.ด.1 员工工资扣税" : "ภ.ง.ด.53 服务费代扣税"}</h2>
            <div className="flex items-center gap-2">
              <input type="month" value={recordMonth} onChange={e => setRecordMonth(e.target.value)}
                className="rounded border px-3 py-2 text-sm" />
              <Button variant="outline" size="sm" onClick={loadRecords} disabled={refreshing} className="gap-1.5">
                <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />刷新
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={loading} className="gap-1.5">
                <Plus className="size-3.5" />批量生成当月记录
              </Button>
            </div>
          </div>

          {records.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed">
              暂无本月申报记录，点击"批量生成当月记录"开始
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {records.map(r => {
                const steps = stepsMap[r.id] || [];
                return (
                  <div key={r.id} className="rounded-lg border bg-[var(--card)]">
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--muted)]/30"
                      onClick={() => toggleExpand(r.id)}
                    >
                      {expandedRecord === r.id ? <ChevronDown className="size-4 text-[var(--muted-foreground)]" /> : <ChevronRight className="size-4 text-[var(--muted-foreground)]" />}
                      <span className="font-medium flex-1">{r.company_name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">{r.tax_id || "—"}</span>
                      <span className="text-sm text-[var(--muted-foreground)]">
                        {totalCount(r.id) > 0 ? `${completedCount(r.id)}/${totalCount(r.id)}` : ""}
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
