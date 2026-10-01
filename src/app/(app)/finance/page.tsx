"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, TrendingUp, TrendingDown, Download, ChevronDown, X } from "lucide-react";
import { fetchAllFinances } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { exportToExcel, type ExportColumn } from "@/lib/export";

const typeLabels: Record<string, string> = { income: "收入", expense: "支出", refund: "退款" };
const statusLabels: Record<string, string> = { paid: "已支付", unpaid: "未支付", refunded: "已退款" };
const statusClass: Record<string, string> = {
  paid: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  unpaid: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  refunded: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

// 币种分开的钱数展示：¥x + ฿y（为 0 的币种省略，全 0 显示 ¥0）
function fmtMoney(cny: number, thb: number): string {
  const parts: string[] = [];
  if (cny) parts.push(`¥${cny.toLocaleString()}`);
  if (thb) parts.push(`฿${thb.toLocaleString()}`);
  return parts.length ? parts.join(" + ") : "¥0";
}

// 利润按币种分别上色：正数绿色、负数红色、0 中性
function profitNode(cny: number, thb: number) {
  const color = (v: number) => (v > 0 ? "text-emerald-600" : v < 0 ? "text-red-500" : "text-[var(--muted-foreground)]");
  const items: { v: number; sym: string }[] = [];
  if (cny) items.push({ v: cny, sym: "¥" });
  if (thb) items.push({ v: thb, sym: "฿" });
  if (!items.length) return <span className="text-[var(--muted-foreground)] tabular-nums">¥0</span>;
  return (
    <span className="tabular-nums">
      {items.map((it, i) => (
        <span key={it.sym} className={color(it.v)}>
          {i > 0 && <span className="text-[var(--muted-foreground)]"> + </span>}
          {it.sym}{it.v.toLocaleString()}
        </span>
      ))}
    </span>
  );
}

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
  business_type_id?: number;
  business_name?: string;
  currency?: string;
}

export default function FinancePage() {
  const [allFinances, setAllFinances] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);

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

  // 按币种分别汇总（人民币和泰铢不能直接相加），返回 "¥x + ฿y" 形式的展示文案
  const sumByCurrency = (rows: FinanceRecord[]): string => {
    const cny = rows.filter((r) => ((r as { currency?: string }).currency || "CNY") === "CNY").reduce((s, r) => s + Number(r.amount), 0);
    const thb = rows.filter((r) => (r as { currency?: string }).currency === "THB").reduce((s, r) => s + Number(r.amount), 0);
    if (thb === 0) return `¥${cny.toLocaleString()}`;
    if (cny === 0) return `฿${thb.toLocaleString()}`;
    return `¥${cny.toLocaleString()} + ฿${thb.toLocaleString()}`;
  };
  const totalIncome = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => r.type === "income" && r.status === "paid")),
    [filtered]
  );
  const totalExpense = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => r.type === "expense")),
    [filtered]
  );
  const totalPending = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => r.status === "unpaid" || r.status === "pending")),
    [filtered]
  );

  // 按业务线分组汇总：收入=已支付收入、支出=全部支出、利润=收入-支出，币种分开
  const businessGroups = useMemo(() => {
    const map = new Map<string, { name: string; incomeCNY: number; incomeTHB: number; expenseCNY: number; expenseTHB: number }>();
    for (const r of allFinances) {
      const name = r.business_name || "未分类";
      let g = map.get(name);
      if (!g) {
        g = { name, incomeCNY: 0, incomeTHB: 0, expenseCNY: 0, expenseTHB: 0 };
        map.set(name, g);
      }
      const isTHB = r.currency === "THB";
      const amount = Number(r.amount) || 0;
      if (r.type === "income" && r.status === "paid") {
        if (isTHB) g.incomeTHB += amount; else g.incomeCNY += amount;
      } else if (r.type === "expense") {
        if (isTHB) g.expenseTHB += amount; else g.expenseCNY += amount;
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [allFinances]);

  // 当前点开的业务线（汇总沿用 businessGroups，保证和分组卡片数字一致）
  const selectedGroup = useMemo(
    () => businessGroups.find((g) => g.name === selectedBusiness) || null,
    [businessGroups, selectedBusiness]
  );

  // 该业务线下所有订单的费用明细（按时间倒序）
  const selectedDetails = useMemo(() => {
    if (!selectedBusiness) return [];
    return allFinances
      .filter((r) => (r.business_name || "未分类") === selectedBusiness)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [allFinances, selectedBusiness]);

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

      {/* 按业务线分组 */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-[var(--foreground)]">按业务线分组</h2>
        {businessGroups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">暂无费用数据</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {businessGroups.map((g) => {
              const open = selectedBusiness === g.name;
              return (
                <div
                  key={g.name}
                  onClick={() => setSelectedBusiness(open ? null : g.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedBusiness(open ? null : g.name); } }}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-[var(--card)] p-4 transition-colors",
                    open ? "border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{g.name}</p>
                    <ChevronDown className={cn("size-4 shrink-0 text-[var(--muted-foreground)] transition-transform", open && "rotate-180")} />
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted-foreground)]">总收入</span>
                      <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(g.incomeCNY, g.incomeTHB)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted-foreground)]">总支出</span>
                      <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(g.expenseCNY, g.expenseTHB)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                      <span className="text-xs text-[var(--muted-foreground)]">利润</span>
                      {profitNode(g.incomeCNY - g.expenseCNY, g.incomeTHB - g.expenseTHB)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 业务线明细 */}
      {selectedGroup && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedBusiness(null)}
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                aria-label="关闭明细"
              >
                <X className="size-4" />
              </button>
              <h3 className="text-sm font-medium text-[var(--foreground)]">{selectedGroup.name}</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{selectedDetails.length} 笔费用</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="text-[var(--muted-foreground)]">总收入 <span className="ml-1 text-[var(--foreground)] tabular-nums">{fmtMoney(selectedGroup.incomeCNY, selectedGroup.incomeTHB)}</span></span>
              <span className="text-[var(--muted-foreground)]">总支出 <span className="ml-1 text-[var(--foreground)] tabular-nums">{fmtMoney(selectedGroup.expenseCNY, selectedGroup.expenseTHB)}</span></span>
              <span className="text-[var(--muted-foreground)]">利润 {profitNode(selectedGroup.incomeCNY - selectedGroup.expenseCNY, selectedGroup.incomeTHB - selectedGroup.expenseTHB)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">订单号</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">客户名</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">类型</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">金额</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">币种</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">状态</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">描述</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">时间</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetails.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无费用明细</td>
                  </tr>
                ) : (
                  selectedDetails.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{r.order_id || "-"}</td>
                      <td className="px-4 py-2.5">{r.customer_name || "-"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                        )}>
                          {typeLabels[r.type] || r.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">{r.currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">{r.currency === "THB" ? "泰铢" : "人民币"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>{statusLabels[r.status] || r.status}</span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate">{r.description || "-"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">{toThaiTime(r.created_at) || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingUp className="size-4 text-[var(--success)]" />总收入
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{totalIncome}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingDown className="size-4 text-[var(--destructive)]" />总支出
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{totalExpense}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            待付余额
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">{totalPending}</p>
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
          <table className="w-full text-sm hidden md:table">
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
                    <td className="px-4 py-3 font-mono tabular-nums">{(r as { currency?: string }).currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</td>
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
          {/* 手机端卡片 */}
          <div className="md:hidden flex flex-col gap-2 p-3">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无费用记录</p>
            ) : filtered.map((r: FinanceRecord) => (
              <div key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                    r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                  )}>{typeLabels[r.type] || r.type}</span>
                  <span className="font-mono tabular-nums text-sm">{(r as { currency?: string }).currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>{statusLabels[r.status] || r.status}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{r.created_at?.slice(0, 10) || "-"}</span>
                </div>
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">描述</span><span className="text-right">{r.description || "—"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">订单号</span><span className="font-mono text-xs">{r.order_id || "—"}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
