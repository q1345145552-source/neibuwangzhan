"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fetchOrders, fetchBusinessTypes } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, BusinessType } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [businessFilter, setBusinessFilter] = useState("all");
  const [sortField, setSortField] = useState<"total_amount" | "created_at" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (bt?: string, st?: string) => {
    try {
      setLoading(true);
      const params: { business_type_id?: number; status?: string } = {};
      if (bt && bt !== "all") params.business_type_id = Number(bt);
      if (st && st !== "all") params.status = st;
      const data = await fetchOrders(params);
      setOrders(data);
    } catch (err) {
      console.error("Orders load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(businessFilter, statusFilter);
    fetchBusinessTypes().then(setBusinessTypes).catch(() => {});
  }, [businessFilter, statusFilter, load]);

  const filtered = search
    ? orders.filter((o) =>
        o.id.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase())
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>订单管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{loading ? "加载中..." : `一共 ${orders.length} 条，搜一下更快`}</p>
        </div>
        <Link href="/orders/new" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
          <Plus className="size-3.5" aria-hidden="true" />新建订单
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input placeholder="搜索订单号、客户…" aria-label="搜索订单" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
        </div>
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
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <Link href={`/orders/${order.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline tabular-nums">{order.id}</Link>
                </td>
                <td className="py-3 px-4 max-md:hidden">
                  <div className="font-medium text-[var(--foreground)]">{order.customer_name}</div>
                </td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.responsible_person}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">¥{order.total_amount.toLocaleString()}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{order.created_at?.slice(0, 10)}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的订单</div>}
      </div>
    </div>
  );
}
