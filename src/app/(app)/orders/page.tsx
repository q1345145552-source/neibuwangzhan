"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ArrowUpDown } from "lucide-react";
import { orders, businessLines, statusLabels, priorityLabels, statusClass } from "@/mock/orders";
import { cn } from "@/lib/utils";

export default function OrdersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [businessFilter, setBusinessFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<"amount" | "deadline" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    let result = [...orders];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(s) ||
          o.clientName.toLowerCase().includes(s) ||
          o.businessLine.toLowerCase().includes(s) ||
          o.assignee.toLowerCase().includes(s)
      );
    }
    if (statusFilter !== "all") result = result.filter((o) => o.status === statusFilter);
    if (businessFilter !== "all") result = result.filter((o) => o.businessLine === businessFilter);
    if (sortField) {
      result.sort((a, b) => {
        const va = sortField === "amount" ? a.amount : new Date(a.deadline).getTime();
        const vb = sortField === "amount" ? b.amount : new Date(b.deadline).getTime();
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }
    return result;
  }, [search, statusFilter, businessFilter, sortField, sortDir]);

  const toggleSort = (field: "amount" | "deadline") => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            订单管理
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">一共 {filtered.length} 条，搜一下更快</p>
        </div>
        <Link
          href="/orders/new"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-2.5 py-[5px] text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1"
        >
          <Plus className="size-3.5" aria-hidden="true" />新建订单
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="搜索订单号、客户、业务线..."
            aria-label="搜索订单"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="按状态筛选"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
        >
          <option value="all">全部状态</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          value={businessFilter}
          onChange={(e) => setBusinessFilter(e.target.value)}
          aria-label="按业务线筛选"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
        >
          <option value="all">全部业务线</option>
          {businessLines.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">订单号</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">客户</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">业务线</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">负责人</th>
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide" aria-sort={sortField === "amount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline"
                  onClick={() => toggleSort("amount")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("amount"); } }}
                >
                  金额<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide" aria-sort={sortField === "deadline" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline"
                  onClick={() => toggleSort("deadline")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("deadline"); } }}
                >
                  截止<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <Link href={`/orders/${order.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline tabular-nums">
                    {order.id}
                  </Link>
                </td>
                <td className="py-3 px-4 max-md:hidden">
                  <div className="font-medium text-[var(--foreground)]">{order.clientName}</div>
                  <div className="text-xs text-[var(--muted-foreground)]">{order.contactPerson}</div>
                </td>
                <td className="py-3 px-4 text-[var(--foreground)]">{order.businessLine}</td>
                <td className="py-3 px-4 text-[var(--foreground)] max-md:hidden">{order.assignee}</td>
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">¥{order.amount.toLocaleString()}</td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)]">{order.deadline}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>
                    {statusLabels[order.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的订单</div>
        )}
      </div>
    </div>
  );
}
