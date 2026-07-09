"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import { fetchAllFinances } from "@/lib/api";
import { cn } from "@/lib/utils";

const typeLabels: Record<string, string> = { income: "收入", expense: "支出", refund: "退款" };
const statusLabels: Record<string, string> = { paid: "已支付", unpaid: "未支付", refunded: "已退款" };
const statusClass: Record<string, string> = {
  paid: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  unpaid: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  refunded: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

interface FinanceRecord {
  id: number;
  order_id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  payment_method: string;
  slip_number: string;
  slip_file: string;
  created_at: string;
  customer_name?: string;
}

export default function FinancePage() {
  const [allFinances, setAllFinances] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAllFinances();
        setAllFinances(data);
      } catch {
        console.error("Failed to load finances");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = useMemo(() => {
    let result = [...allFinances];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (r: FinanceRecord) =>
          (r.description || "").toLowerCase().includes(s) ||
          (r.order_id || "").toLowerCase().includes(s)
      );
    }
    if (typeFilter !== "all") {
      result = result.filter((r: FinanceRecord) => r.type === typeFilter);
    }
    return result;
  }, [allFinances, search, typeFilter]);

  const totalIncome = useMemo(
    () => filtered.filter((r: FinanceRecord) => r.type === "income" && r.status === "paid").reduce((s: number, r: FinanceRecord) => s + Number(r.amount), 0),
    [filtered]
  );
  const totalExpense = useMemo(
    () => filtered.filter((r: FinanceRecord) => r.type === "expense").reduce((s: number, r: FinanceRecord) => s + Number(r.amount), 0),
    [filtered]
  );
  const totalPending = useMemo(
    () => filtered.filter((r: FinanceRecord) => r.status === "unpaid" || r.status === "pending").reduce((s: number, r: FinanceRecord) => s + Number(r.amount), 0),
    [filtered]
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">费用管理</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">所有订单的收入与支出明细</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingUp className="size-4 text-[var(--success)]" />总收入
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">¥{totalIncome.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingDown className="size-4 text-[var(--destructive)]" />总支出
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">¥{totalExpense.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            待付余额
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">¥{totalPending.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="搜索描述或订单号..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", "income", "expense"].map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setTypeFilter(t)}
            >
              {t === "all" ? "全部" : typeLabels[t]}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">类型</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">金额</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">描述</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">订单号</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">日期</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无费用记录</td>
                </tr>
              ) : (
                filtered.map((r: FinanceRecord) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50">
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                        r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                      )}>
                        {typeLabels[r.type] || r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">¥{Number(r.amount).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>
                        {statusLabels[r.status] || r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{r.description || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.order_id || "-"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">{r.created_at?.slice(0, 10) || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
