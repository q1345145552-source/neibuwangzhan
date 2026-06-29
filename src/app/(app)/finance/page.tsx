"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, DollarSign, FileSpreadsheet } from "lucide-react";
import { financeRecords, summaryStats } from "@/mock/finance";
import { cn } from "@/lib/utils";

const typeLabels: Record<string, string> = { income: "收入", expense: "支出", refund: "退款" };
const typeIcons: Record<string, React.ReactNode> = {
  income: <TrendingUp className="size-3 text-[var(--success)]" />,
  expense: <TrendingDown className="size-3 text-[var(--destructive)]" />,
  refund: <TrendingDown className="size-3 text-[var(--destructive)]" />,
};
const statusLabels: Record<string, string> = { paid: "已支付", unpaid: "未支付", refunded: "已退款" };
const statusClass: Record<string, string> = {
  paid: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  unpaid: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  refunded: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

export default function FinancePage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = useMemo(() => {
    let result = [...financeRecords];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.description.toLowerCase().includes(s) ||
          r.clientName.toLowerCase().includes(s) ||
          r.businessLine.toLowerCase().includes(s)
      );
    }
    if (typeFilter !== "all") result = result.filter((r) => r.type === typeFilter);
    return result;
  }, [search, typeFilter]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            费用管理
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">钱的事，清清楚楚最好</p>
        </div>
        <Button size="sm" onClick={() => console.log("导出报表")}><FileSpreadsheet className="size-3.5" aria-hidden="true" />导出报表</Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "总收入", value: `¥${summaryStats.totalIncome.toLocaleString()}`, icon: <TrendingUp className="size-4 text-[var(--success)]" /> },
          { label: "总支出", value: `¥${summaryStats.totalExpense.toLocaleString()}`, icon: <TrendingDown className="size-4 text-[var(--destructive)]" /> },
          { label: "待收金额", value: `¥${summaryStats.unpaidAmount.toLocaleString()}`, icon: <DollarSign className="size-4 text-[var(--warning)]" /> },
        ].map((card) => (
          <div key={card.label} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)]">
              {card.icon}
            </div>
            <div>
              <p className="text-xs text-[var(--muted-foreground)] tracking-wide">{card.label}</p>
              <p className="font-mono text-lg font-semibold tabular-nums text-[var(--foreground)]">{card.value}</p>
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-[var(--primary)]/30 bg-[color-mix(in_oklch,var(--primary),var(--background)_95%)] px-5 py-4 sm:col-span-2 lg:col-span-1">
          <p className="text-xs text-[var(--muted-foreground)] tracking-wide">净利润</p>
          <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-[var(--primary)]">¥{summaryStats.netRevenue.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="搜索描述、客户、业务线..."
            aria-label="搜索财务记录"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="按类型筛选"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
        >
          <option value="all">全部类型</option>
          <option value="income">收入</option>
          <option value="expense">支出</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">类型</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">描述</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">客户</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">业务线</th>
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide">金额</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">日期</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rec) => (
              <tr key={rec.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    rec.type === "income" && "bg-[color-mix(in_oklch,var(--success),var(--background)_90%)] text-[var(--success)]",
                    rec.type === "expense" && "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]",
                    rec.type === "refund" && "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]",
                  )}>
                    {rec.type === "income" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                    {typeLabels[rec.type]}
                  </span>
                </td>
                <td className="py-3 px-4 font-medium text-[var(--foreground)] max-w-[200px] truncate">{rec.description}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{rec.clientName}</td>
                <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{rec.businessLine}</td>
                <td className={cn(
                  "py-3 px-4 text-right font-mono text-xs font-medium tabular-nums",
                  rec.type === "income" && "text-[var(--success)]",
                  (rec.type === "expense" || rec.type === "refund") && "text-[var(--destructive)]",
                )}>
                  {rec.type === "income" ? "+" : "-"}¥{rec.amount.toLocaleString()}
                </td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{rec.date}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[rec.status])}>
                    {statusLabels[rec.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的记录</div>
        )}
      </div>
    </div>
  );
}
