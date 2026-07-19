"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Users, FileText, Calculator, Search, History, BarChart3, Plus, Trash2, Edit3, Save, X, CheckCircle2, Clock, PauseCircle, Ban } from "lucide-react";

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

const TABS = [
  { key: "customers", label: "客户白名单", icon: Users },
  { key: "records", label: "本月申报", icon: FileText },
  { key: "reconciliation", label: "对账表", icon: Calculator },
  { key: "history", label: "历史查询", icon: Search },
  { key: "summary", label: "年度汇总", icon: BarChart3 },
];

const STATUS_OPTIONS = ["启用", "暂停", "已终止"] as const;
const PROGRESS_STEPS = ["收资料", "Excel 计算", "发客户确认", "e-Filing 提交", "付款纳税", "归档完成"] as const;

export default function VatPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("customers");

  // Customers
  const [customers, setCustomers] = useState<VatCustomer[]>([]);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(null);
  const [customerForm, setCustomerForm] = useState({ company_name: "", tax_id: "", contact: "", status: "启用" as string });

  // Records
  const [records, setRecords] = useState<VatRecord[]>([]);
  const [recordMonth, setRecordMonth] = useState(new Date().toISOString().slice(0, 7));

  // Reconciliation
  const [reconciliations, setReconciliations] = useState<VatReconciliation[]>([]);
  const [reconMonth, setReconMonth] = useState(new Date().toISOString().slice(0, 7));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ===== Load data =====
  const loadCustomers = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/vat/customers");
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch { setCustomers([]); }
  }, []);

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/records?month=${recordMonth}`);
      const data = await res.json();
      setRecords(Array.isArray(data) ? data : []);
    } catch { setRecords([]); }
  }, [recordMonth]);

  const loadReconciliations = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/vat/reconciliation?month=${reconMonth}`);
      const data = await res.json();
      setReconciliations(Array.isArray(data) ? data : []);
    } catch { setReconciliations([]); }
  }, [reconMonth]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);
  useEffect(() => {
    if (activeTab === "records") loadRecords();
    if (activeTab === "history") {
      // Load all records for history tab
      fetchWithAuth("/api/vat/records").then(r => r.json()).then(d => setRecords(Array.isArray(d) ? d : [])).catch(() => {});
    }
    if (activeTab === "reconciliation") loadReconciliations();
  }, [activeTab, loadRecords, loadReconciliations]);


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
      loadCustomers();
    } catch { setError("添加客户失败"); }
    finally { setLoading(false); }
  };

  const handleUpdateCustomer = async (id: number) => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/vat/customers`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...customerForm }),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "更新失败"); return; }
      setEditingCustomerId(null);
      loadCustomers();
    } catch { setError("更新客户失败"); }
    finally { setLoading(false); }
  };

  const handleDeleteCustomer = async (id: number) => {
    if (!confirm("确认删除该客户？")) return;
    try {
      await fetchWithAuth(`/api/vat/customers?id=${id}`, { method: "DELETE" });
      loadCustomers();
    } catch { setError("删除失败"); }
  };

  const startEditCustomer = (c: VatCustomer) => {
    setEditingCustomerId(c.id);
    setCustomerForm({ company_name: c.company_name, tax_id: c.tax_id, contact: c.contact, status: c.status });
  };

  // ===== Tab content =====

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      "启用": "bg-[var(--success)] text-[var(--success-foreground)]",
      "暂停": "bg-[color-mix(in_oklch,var(--warning),var(--background)_20%)] text-[var(--warning-foreground)]",
      "已终止": "bg-[var(--muted)] text-[var(--muted-foreground)]",
    };
    return cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", map[s] || map["暂停"]);
  };

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

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--muted)] p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
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

          {/* Add / Edit form */}
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

          {/* Customer list */}
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
                    <td className="px-4 py-3 font-medium">{c.company_name}</td>
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

      {/* ---- 本月申报 ---- */}
      {activeTab === "records" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">本月申报</h2>
            <input type="month" value={recordMonth} onChange={e => setRecordMonth(e.target.value)}
              className="rounded border px-3 py-2 text-sm" />
          </div>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">公司名称</th>
                  <th className="px-4 py-3 text-left font-medium">税号</th>
                  <th className="px-4 py-3 text-left font-medium">申报月份</th>
                  <th className="px-4 py-3 text-left font-medium">当前进度</th>
                  <th className="px-4 py-3 text-left font-medium">申报金额</th>
                  <th className="px-4 py-3 text-left font-medium">负责人</th>
                </tr>
              </thead>
              <tbody>
                {records.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无申报记录</td></tr>
                ) : records.map(r => (
                  <tr key={r.id} className="border-t hover:bg-[var(--muted)] cursor-pointer transition-colors"
                    onClick={() => window.location.href = `/vat/${r.id}`}>
                    <td className="px-4 py-3 font-medium text-[var(--primary)] hover:underline">{r.company_name || "—"}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{r.tax_id || "—"}</td>
                    <td className="px-4 py-3">{r.year_month}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">
                        {r.progress === "归档完成" ? <CheckCircle2 className="size-3" /> : r.progress === "收资料" ? <Clock className="size-3 text-[var(--muted-foreground)]" /> : <Clock className="size-3" />}
                        {r.progress}
                      </span>
                    </td>
                    <td className="px-4 py-3">{r.amount > 0 ? `¥${r.amount.toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3">{r.assignee || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {records.length === 0 && (
            <Button size="sm" variant="outline" onClick={async () => {
              try {
                const res = await fetchWithAuth(`/api/vat/records/generate`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ month: recordMonth }),
                });
                if (res.ok) loadRecords();
                else { const e = await res.json(); setError(e.error || "生成失败"); }
              } catch { setError("生成申报记录失败"); }
            }}>
              <Plus className="size-4 mr-1" />为本月启用客户生成申报记录
            </Button>
          )}
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
                    if (!q) { loadRecords(); return; }
                    const res = await fetchWithAuth(`/api/vat/records?search=${encodeURIComponent(q)}`);
                    const data = await res.json();
                    setRecords(Array.isArray(data) ? data : []);
                  } catch {}
                }} />
              <select className="rounded border px-3 py-2 text-sm"
                onChange={async (e) => {
                  const m = e.target.value;
                  if (!m) { setRecordMonth(""); return; }
                  setRecordMonth(m);
                  try {
                    const res = await fetchWithAuth(`/api/vat/records?month=${m}`);
                    const data = await res.json();
                    setRecords(Array.isArray(data) ? data : []);
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
                {!records.length ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无历史记录</td></tr>
                ) : records.map(r => (
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
    </div>
  );
}
