"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Plus, FileText, ClipboardList, Search, ArrowLeft } from "lucide-react";
import { fetchOrders, fetchBusinessTypes } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, BusinessType } from "@/lib/api";
import { cn, toThaiTime, formatCurrency } from "@/lib/utils";

interface BusinessLinePageProps {
  businessKey: string;
  label: string;
  accentHue: number;
  description: string;
  subServiceType?: string;
}

const accentStyles = (hue: number) => ({
  accentBorder: `border-[color-mix(in_oklch,oklch(0.55_0.14_${hue}),var(--background)_70%)]`,
});

export function BusinessLinePage({ businessKey, label, accentHue, description, subServiceType }: BusinessLinePageProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const types = await fetchBusinessTypes();
        setBusinessTypes(types);
        const bt = types.find((t) => t.name === businessKey);
        if (bt) {
          const data = await fetchOrders({ business_type_id: bt.id });
          const filtered = subServiceType ? data.filter((o: Order) => o.sub_service_type === subServiceType) : data;
          setOrders(filtered);
        }
      } catch (err) {
        console.error("BLP load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [businessKey, subServiceType]);

  const stats = useMemo(() => {
    const total = orders.length;
    const inProgress = orders.filter((o) => o.status === "进行中").length;
    const completed = orders.filter((o) => o.status === "已完成").length;
    const pending = orders.filter((o) => o.status === "待处理").length;
    const totalAmount = orders.reduce((sum, o) => sum + o.total_amount, 0);
    return { total, inProgress, completed, pending, totalAmount };
  }, [orders]);

  const filteredOrders = search
    ? orders.filter((o) =>
        o.id.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        (o.trademark_name || "").toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  const a = accentStyles(accentHue);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <div className="animate-pulse space-y-4">
          <div className="h-7 w-28 rounded bg-[var(--muted)]" />
          <div className="h-4 w-64 rounded bg-[var(--muted)]" />
          <div className="h-20 rounded-2xl bg-[var(--muted)]" />
          <div className="h-40 rounded-xl bg-[var(--muted)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link href="/" className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" aria-label="返回仪表盘">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{label}</h1>
        </div>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">{description}</p>
      </div>

      <div className={cn("rounded-2xl border px-6 py-5 shadow-[0_2px_6px_rgba(0,0,0,0.04)]", a.accentBorder)}>
        <div className="flex flex-wrap items-end gap-6">
          <div className="min-w-[80px]">
            <span className="text-xs text-[var(--muted-foreground)]">总计</span>
            <p className="font-mono text-3xl font-semibold tabular-nums text-[var(--foreground)]">{stats.total}</p>
            <p className="text-xs text-[var(--muted-foreground)]">单</p>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <span><span className="text-[var(--info)]">▲</span> 进行中 <strong className="font-mono tabular-nums">{stats.inProgress}</strong></span>
            <span><span className="text-[var(--success)]">●</span> 已完成 <strong className="font-mono tabular-nums">{stats.completed}</strong></span>
            {stats.pending > 0 && <span><span className="text-[var(--warning)]">◉</span> 待处理 <strong className="font-mono tabular-nums">{stats.pending}</strong></span>}
          </div>
          <span className="ml-auto text-sm text-[var(--muted-foreground)]">总额 <strong className="font-mono tabular-nums text-[var(--foreground)]">{formatCurrency(stats.totalAmount)}</strong></span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--foreground)]">{stats.total > 0 ? `共 ${stats.total} 条订单` : "还没有订单"}</h2>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <input
              ref={searchInputRef}
              placeholder="搜索订单号或客户名称..."
              onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInputRef.current?.value || ""); } }}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
            />
          </div>
          <button
            onClick={() => setSearch(searchInputRef.current?.value || "")}
            className="inline-flex items-center gap-1 rounded-md bg-[var(--primary)] px-3 py-1 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] transition-colors"
          >
            <Search className="size-3" />搜索
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">订单号</th>
                {businessKey === "商标" && <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">商标名称</th>}
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">客户</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">负责人</th>
                <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide">金额</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">日期</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                  <td className="py-3 px-4">
                    <Link href={`/orders/${order.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline tabular-nums">{order.id}</Link>
                  </td>
                  {businessKey === "商标" && <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.trademark_name || "—"}</td>}
                  <td className="py-3 px-4 max-md:hidden"><div className="font-medium text-[var(--foreground)]">{order.customer_name}</div></td>
                  <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.responsible_person}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">{formatCurrency(order.total_amount, order.currency)}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{toThaiTime(order.created_at)}</td>
                  <td className="py-3 px-4"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredOrders.length === 0 && <div className="py-16 text-center"><p className="text-sm text-[var(--muted-foreground)]">{search ? "没有匹配的订单" : `还没有${label}订单，去看看吧`}</p></div>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`/orders/new?biz=${businessKey}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><Plus className="size-3.5" aria-hidden="true" />新建订单</Link>
        <Link href={`/documents?biz=${businessKey}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-all hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><FileText className="size-3.5" aria-hidden="true" />去看文档</Link>
        <Link href={`/tasks?biz=${businessKey}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-all hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"><ClipboardList className="size-3.5" aria-hidden="true" />看看任务</Link>
      </div>
    </div>
  );
}
