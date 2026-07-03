"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus, Search, ArrowUpDown, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchOrders, fetchBusinessTypes, deleteOrder } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, BusinessType } from "@/lib/api";
import { cn, toThaiTime, formatCurrency } from "@/lib/utils";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [businessFilter, setBusinessFilter] = useState("all");
  const [sortField, setSortField] = useState<"total_amount" | "created_at" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState<{id:string,name:string}|null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const params: { business_type_id?: number; status?: string } = {};
        if (businessFilter && businessFilter !== "all") params.business_type_id = Number(businessFilter);
        if (statusFilter && statusFilter !== "all") params.status = statusFilter;
        const data = await fetchOrders(params);
        if (!ignore) setOrders(data);
      } catch (err) {
        console.error("Orders load error:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    fetchBusinessTypes().then(setBusinessTypes).catch(() => {});
    return () => { ignore = true; };
  }, [businessFilter, statusFilter]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await deleteOrder(deleteTarget.id);
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      console.error("删除订单失败:", err);
      setErrorMsg(err.message || "删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = search
    ? orders.filter((o) =>
        o.id.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        (o.trademark_name || "").toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const sorted = sortField
    ? [...filtered].sort((a, b) => {
        const va = sortField === "total_amount" ? a.total_amount : new Date(a.created_at).getTime();
        const vb = sortField === "total_amount" ? b.total_amount : new Date(b.created_at).getTime();
        return sortDir === "asc" ? va - vb : vb - va;
      })
    : filtered;

  const toggleSort = (field: "total_amount" | "created_at") => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: Title + new order button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>订单管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{loading ? "加载中..." : `一共 ${orders.length} 条，搜一下更快`}</p>
        </div>
        <Link href="/orders/new" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          <Plus className="size-3.5" aria-hidden="true" />新建订单
        </Link>
      </div>

      {/* Row 2: Search bar — full width */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="输入订单号或客户名称快速搜索..." aria-label="搜索订单" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 pl-9 text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)]" />
      </div>

      {/* Row 3: Status + business filter + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="按状态筛选" className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
          <option value="all">全部状态</option>
          <option value="待处理">待处理</option>
          <option value="进行中">进行中</option>
          <option value="已完成">已完成</option>
          <option value="已逾期">已逾期</option>
        </select>
        <select value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)} aria-label="按业务线筛选" className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
          <option value="all">全部业务线</option>
          {businessTypes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">订单号</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">商标名称</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">客户</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">负责人</th>
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide" aria-sort={sortField === "total_amount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline" onClick={() => toggleSort("total_amount")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("total_amount"); } }}>
                  金额<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden" aria-sort={sortField === "created_at" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline" onClick={() => toggleSort("created_at")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("created_at"); } }}>
                  日期<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
              {user?.role !== "client" && <th className="py-3 px-4 text-center text-xs font-medium text-[var(--muted-foreground)] tracking-wide w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <Link href={`/orders/${order.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline tabular-nums">{order.id}</Link>
                </td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.trademark_name || "—"}</td>
                <td className="py-3 px-4 max-md:hidden">
                  <div className="font-medium text-[var(--foreground)]">{order.customer_name}</div>
                </td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.responsible_person}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">{formatCurrency(order.total_amount, order.currency)}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{toThaiTime(order.created_at)}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
                </td>
                {user?.role !== "client" && (
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => setDeleteTarget({ id: order.id, name: order.customer_name })}
                      className="inline-flex items-center justify-center rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors"
                      title="删除订单"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的订单</div>}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              确定要删除订单 <span className="font-mono font-medium text-[var(--foreground)]">{deleteTarget.id}</span>（{deleteTarget.name}）吗？此操作会同时删除所有关联的步骤、文档、费用和证书，且不可恢复。
            </p>
            {errorMsg && <p className="mt-3 text-sm text-[var(--destructive)]">{errorMsg}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleConfirmDelete} disabled={deleting} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
