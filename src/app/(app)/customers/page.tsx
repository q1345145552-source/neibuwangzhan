"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Search, Plus, X, Building2, Edit3, Trash2, ChevronRight,
  Filter, Tag, User, Calendar, DollarSign, Download, Hand, Zap, Banknote
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
  claimed_by: string;
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
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showVatImport, setShowVatImport] = useState(false);
  const [vatImportable, setVatImportable] = useState<any[]>([]);
  const [selectedVatIds, setSelectedVatIds] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [myPoints, setMyPoints] = useState(0);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawMsg, setWithdrawMsg] = useState("");
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [showReviewPanel, setShowReviewPanel] = useState(false);

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

  const loadMyPoints = async () => {
    try {
      const res = await fetchWithAuth("/api/customers?action=my_points");
      const data = await res.json();
      setMyPoints(data.total_customer_points || 0);
    } catch {}
  };

  useEffect(() => { loadMyPoints(); }, [customers]); // refresh when customers change
  useEffect(() => { if (user?.role === "admin") loadWithdrawals(); }, [user]);

  const handleClaim = async (id: number) => {
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", id }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    loadCustomers();
  };

  const handleActivate = async (id: number) => {
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activate", id }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error); return; }
    loadCustomers();
  };

  const openVatImport = async () => {
    setShowVatImport(true);
    try {
      const res = await fetchWithAuth("/api/customers?action=vat-importable");
      const data = await res.json();
      setVatImportable(Array.isArray(data) ? data : []);
    } catch { setVatImportable([]); }
  };

  const doVatImport = async () => {
    if (!selectedVatIds.size) return;
    setImporting(true);
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vat-import", ids: [...selectedVatIds] }),
    });
    const data = await res.json();
    setImporting(false);
    setShowVatImport(false);
    setSelectedVatIds(new Set());
    loadCustomers();
    alert(data.imported ? "已导入 " + data.imported + " 个客户" : "导入失败");
  };

  const handleWithdraw = async () => {
    const amt = Number(withdrawAmount);
    if (!amt || amt <= 0) { setWithdrawMsg("请输入有效积分"); return; }
    setWithdrawMsg("");
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw_request", amount: amt }),
    });
    const data = await res.json();
    if (res.ok) { setShowWithdraw(false); setWithdrawAmount(""); alert(data.message); loadMyPoints(); }
    else { setWithdrawMsg(data.error || "申请失败"); }
  };

  const loadWithdrawals = async () => {
    if (user?.role !== "admin") return;
    try {
      const res = await fetchWithAuth("/api/customers?action=withdrawals");
      const data = await res.json();
      setWithdrawals(Array.isArray(data) ? data : []);
    } catch {}
  };

  const handleReview = async (withdrawal_id: number, approve: boolean) => {
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "withdraw_review", withdrawal_id, approve }),
    });
    if (res.ok) { loadWithdrawals(); loadMyPoints(); }
    else { const d = await res.json(); alert(d.error || "操作失败"); }
  };

  const handleExportSales = async () => {
    try {
      const res = await fetchWithAuth("/api/internal/points", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "export_sales", month: new Date().toISOString().slice(0, 7) }),
      });
      const data = await res.json();
      if (data.rows) {
        const csv = "员工,跟进积分,认领积分,激活积分,升级积分,成交积分,总销售积分\n" + data.rows.map((r: any) => `${r.name},${r.followup_points},${r.claim_points},${r.activate_points},${r.upgrade_points},${r.deal_points},${r.total_sales}`).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `销售积分_${data.month}.csv`;
        a.click(); URL.revokeObjectURL(url);
      }
    } catch {}
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm("确定删除客户\"" + name + "\"？相关跟进记录和积分也会清除。")) return;
    await fetchWithAuth("/api/customers?id=" + id, { method: "DELETE" });
    loadCustomers();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">客户管理</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-sm text-[var(--muted-foreground)]">统一管理合作客户与潜客</p>
            <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] px-2 py-0.5 text-xs font-medium text-[var(--success)]">
              <Banknote className="size-3" />我的销售积分: {myPoints}
            </span>
            <button onClick={() => setShowWithdraw(true)} className="text-xs text-[var(--primary)] hover:underline">提现</button>
            {user?.role === "admin" && <button onClick={() => setShowReviewPanel(!showReviewPanel)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">审核{withdrawals.filter((w: any) => w.status === "待审核").length > 0 ? `(${withdrawals.filter((w: any) => w.status === "待审核").length})` : ""}</button>}
            {user?.role === "admin" && <button onClick={handleExportSales} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">导出月报</button>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={openVatImport} className="gap-1.5">
            <Download className="size-4" />从VAT导入
          </Button>
          <Button size="sm" onClick={() => setShowAddForm(true)} className="gap-1.5">
            <Plus className="size-4" />录入客户
          </Button>
        </div>
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

      {/* Admin Review Panel */}
      {showReviewPanel && user?.role === "admin" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">提现审核</h3>
            <button onClick={() => setShowReviewPanel(false)}><X className="size-4 text-[var(--muted-foreground)]" /></button>
          </div>
          {withdrawals.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">暂无提现申请</p>
          ) : (
            <div className="space-y-2">
              {withdrawals.map((w: any) => (
                <div key={w.id} className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-b-0 last:pb-0">
                  <div>
                    <span className="text-sm font-medium">{w.employee_name}</span>
                    <span className="ml-2 text-sm font-mono text-[var(--success)]">-{w.amount}</span>
                    <span className={w.status === "待审核" ? "ml-2 text-xs text-amber-500" : w.status === "已通过" ? "ml-2 text-xs text-green-600" : "ml-2 text-xs text-[var(--destructive)]"}>{w.status}</span>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">{w.created_at?.slice(0, 10)}</span>
                  </div>
                  {w.status === "待审核" && (
                    <div className="flex gap-1">
                      <Button size="xs" variant="outline" className="h-7 text-xs text-green-600" onClick={() => handleReview(w.id, true)}>通过</Button>
                      <Button size="xs" variant="outline" className="h-7 text-xs text-[var(--destructive)]" onClick={() => handleReview(w.id, false)}>驳回</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">认领人</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">来源</th>
                <th className="px-4 py-3 text-right font-medium">成交金额</th>
                <th className="px-4 py-3 text-right font-medium w-28">操作</th>
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
                      {c.claimed_by ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-1.5 py-0.5 text-[var(--primary)]">{c.claimed_by}</span>
                      ) : "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)] hidden lg:table-cell">{c.source_channel || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {c.total_deal_amount > 0 ? c.total_deal_amount.toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                      {c.status === "潜在" && !c.claimed_by && (
                        <button onClick={() => handleClaim(c.id)} className="px-2 py-0.5 text-xs rounded border border-[var(--primary)] text-[var(--primary)] hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] transition-colors font-medium">
                          <Hand className="size-3 mr-0.5 inline" />认领
                        </button>
                      )}
                      {c.status === "沉睡" && (
                        <button onClick={() => handleActivate(c.id)} className="px-2 py-0.5 text-xs rounded border border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors font-medium">
                          <Zap className="size-3 mr-0.5 inline" />激活
                        </button>
                      )}
                      {user?.role === "admin" && (
                        <button onClick={() => handleDelete(c.id, c.company_name)} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors" title="删除">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
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

      {/* Withdraw Modal */}
      {showWithdraw && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => { setShowWithdraw(false); setWithdrawMsg(""); }} />
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
            <div className="w-full max-w-sm rounded-xl border bg-[var(--background)] shadow-2xl p-6 mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">积分提现</h2>
                <button onClick={() => { setShowWithdraw(false); setWithdrawMsg(""); }} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
              </div>
              <p className="text-sm text-[var(--muted-foreground)] mb-3">当前销售积分: <span className="font-bold text-[var(--success)]">{myPoints}</span></p>
              <div className="mb-3">
                <label className="text-xs text-[var(--muted-foreground)]">提现分数</label>
                <input type="number" value={withdrawAmount} onChange={e => { setWithdrawAmount(e.target.value); setWithdrawMsg(""); }}
                  className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)] font-mono" placeholder="输入要提现的分数" />
              </div>
              {withdrawMsg && <p className="text-xs text-[var(--destructive)] mb-3">{withdrawMsg}</p>}
              <p className="text-xs text-[var(--muted-foreground)] mb-4">10 泰铢 = 1 分，管理员审核通过后到账</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setShowWithdraw(false); setWithdrawMsg(""); }}>取消</Button>
                <Button size="sm" onClick={handleWithdraw}>提交申请</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* VAT Import Modal */}
      {showVatImport && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => { setShowVatImport(false); setSelectedVatIds(new Set()); }} />
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] overflow-y-auto">
            <div className="w-full max-w-md rounded-xl border bg-[var(--background)] shadow-2xl p-6 mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">从VAT白名单导入</h2>
                <button onClick={() => { setShowVatImport(false); setSelectedVatIds(new Set()); }} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
              </div>
              {vatImportable.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)] py-4">VAT白名单中的客户已全部导入，或无可导入客户</p>
              ) : (
                <>
                  <div className="max-h-64 overflow-y-auto border rounded-lg mb-4">
                    {vatImportable.map((vc: any) => (
                      <label key={vc.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--muted)]/50 cursor-pointer border-b last:border-b-0">
                        <input type="checkbox" className="size-4 rounded" checked={selectedVatIds.has(vc.id)} onChange={() => {
                          const next = new Set(selectedVatIds);
                          next.has(vc.id) ? next.delete(vc.id) : next.add(vc.id);
                          setSelectedVatIds(next);
                        }} />
                        <span className="text-sm">{vc.company_name}</span>
                        {vc.tax_id && <span className="text-xs text-[var(--muted-foreground)]">{vc.tax_id}</span>}
                      </label>
                    ))}
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-[var(--muted-foreground)]">已选 {selectedVatIds.size} 项</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setShowVatImport(false); setSelectedVatIds(new Set()); }}>取消</Button>
                      <Button size="sm" onClick={doVatImport} disabled={importing || !selectedVatIds.size}>{importing ? "导入中..." : "导入"}</Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
