"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Search, Plus, X, Building2, Edit3, Trash2, ChevronRight,
  Filter, Tag, User, Calendar, DollarSign
} from "lucide-react";

// ===== Types =====
interface Customer {
  id: number;
  company_name: string;
  industry: string;
  company_type: string;
  founded_at: string;
  source_channel: string;
  owner_name: string;
  owner_wechat: string;
  handler_name: string;
  handler_wechat: string;
  willingness: string;
  demand_tags: string;
  status: "潜在" | "跟进中" | "已合作" | "沉睡";
  total_deal_amount: number;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS = ["全部", "潜在", "跟进中", "已合作", "沉睡"] as const;

const statusColor: Record<string, string> = {
  "潜在": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "跟进中": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "已合作": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "沉睡": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

// ===== Add Customer Form =====
function AddCustomerForm({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    company_name: "", industry: "", company_type: "", founded_at: "",
    source_channel: "", owner_name: "", owner_wechat: "", handler_name: "",
    handler_wechat: "", willingness: "", demand_tags: "", status: "潜在",
    total_deal_amount: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!form.company_name.trim()) { setError("请输入公司名称"); return; }
    setSaving(true); setError("");
    try {
      const res = await fetchWithAuth("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, total_deal_amount: Number(form.total_deal_amount) || 0 }),
      });
      if (res.ok) { onSaved(); onClose(); }
      else { const e = await res.json(); setError(e.error || "创建失败"); }
    } catch { setError("网络错误"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] overflow-y-auto">
        <div className="w-full max-w-lg rounded-xl border bg-[var(--background)] shadow-2xl p-6 mx-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium">录入客户</h2>
            <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] px-3 py-2 text-sm text-[var(--destructive)] flex items-center justify-between">
              <span>{error}</span><button onClick={() => setError("")}><X className="size-3.5" /></button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="col-span-2">
              <label className="text-xs text-[var(--muted-foreground)]">公司名称 <span className="text-[var(--destructive)]">*</span></label>
              <input value={form.company_name} onChange={e => setForm(p => ({ ...p, company_name: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="必填" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">行业</label>
              <input value={form.industry} onChange={e => setForm(p => ({ ...p, industry: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">公司性质</label>
              <input value={form.company_type} onChange={e => setForm(p => ({ ...p, company_type: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 有限公司、个体" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">成立时间</label>
              <input type="date" value={form.founded_at} onChange={e => setForm(p => ({ ...p, founded_at: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">来源渠道</label>
              <input value={form.source_channel} onChange={e => setForm(p => ({ ...p, source_channel: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 转介绍、展会" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">老板姓名</label>
              <input value={form.owner_name} onChange={e => setForm(p => ({ ...p, owner_name: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">老板微信</label>
              <input value={form.owner_wechat} onChange={e => setForm(p => ({ ...p, owner_wechat: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">经办人姓名</label>
              <input value={form.handler_name} onChange={e => setForm(p => ({ ...p, handler_name: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">经办人微信</label>
              <input value={form.handler_wechat} onChange={e => setForm(p => ({ ...p, handler_wechat: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">合作意愿度</label>
              <input value={form.willingness} onChange={e => setForm(p => ({ ...p, willingness: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 高、中、低" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">需求标签</label>
              <input value={form.demand_tags} onChange={e => setForm(p => ({ ...p, demand_tags: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 VAT, 商标" />
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">合作状态</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                {STATUS_OPTIONS.slice(1).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--muted-foreground)]">成交总额 (฿)</label>
              <input type="number" value={form.total_deal_amount} onChange={e => setForm(p => ({ ...p, total_deal_amount: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)] font-mono" placeholder="0" />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--border)]">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button variant="default" size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ===== Main Page =====
export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [showAddForm, setShowAddForm] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (statusFilter !== "全部") params.set("status", statusFilter);
      const res = await fetchWithAuth(`/api/customers?${params.toString()}`);
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch { setCustomers([]); }
    finally { setLoading(false); }
  }, [search, statusFilter]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定删除客户"${name}"？相关跟进记录和积分也会清除。`)) return;
    await fetchWithAuth(`/api/customers?id=${id}`, { method: "DELETE" });
    loadCustomers();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">客户管理</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-0.5">统一管理合作客户与潜客</p>
        </div>
        <Button size="sm" onClick={() => setShowAddForm(true)} className="gap-1.5">
          <Plus className="size-4" />录入客户
        </Button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
          <input
            value={search} onChange={e => { setSearch(e.target.value); setLoading(true); }}
            placeholder="搜索公司名、联系人..."
            className="w-full h-9 pl-9 pr-3 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm outline-none focus:border-[var(--ring)]"
          />
        </div>
        <div className="flex items-center gap-1 bg-[var(--muted)] rounded-md p-0.5">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setLoading(true); }}
              className={cn(
                "px-3 py-1 text-xs rounded font-medium transition-colors",
                statusFilter === s
                  ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
        {loading ? (
          <div className="animate-pulse space-y-3 p-6">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded bg-[var(--muted)]" />)}
          </div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
            {search || statusFilter !== "全部" ? "无匹配结果" : "暂无客户，点击右上角「录入客户」开始"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">公司名称</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">行业</th>
                <th className="px-4 py-3 text-left font-medium">状态</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">联系人</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">来源</th>
                <th className="px-4 py-3 text-right font-medium">成交金额</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr
                  key={c.id}
                  className="border-t border-[var(--border)] hover:bg-[var(--muted)]/50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/customers/${c.id}`)}
                >
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <Building2 className="size-3.5 text-[var(--muted-foreground)] shrink-0" />
                      <span className="hover:text-[var(--primary)] hover:underline">{c.company_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] hidden sm:table-cell">{c.industry || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", statusColor[c.status] || "")}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <div className="text-xs">
                      {c.handler_name || c.owner_name ? (
                        <span>{c.handler_name || c.owner_name}</span>
                      ) : "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] hidden lg:table-cell">{c.source_channel || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {c.total_deal_amount > 0 ? c.total_deal_amount.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleDelete(c.id, c.company_name)} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors" title="删除">
                        <Trash2 className="size-3.5" />
                      </button>
                      <ChevronRight className="size-4 text-[var(--muted-foreground)]" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add form modal */}
      {showAddForm && <AddCustomerForm onClose={() => setShowAddForm(false)} onSaved={loadCustomers} />}
    </div>
  );
}
