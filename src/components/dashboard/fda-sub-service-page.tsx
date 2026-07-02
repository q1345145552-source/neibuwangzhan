"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, TrendingUp, DollarSign, ArrowLeft, FileText, ClipboardList } from "lucide-react";
import { fetchOrders } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order } from "@/lib/api";
import { servicePrices } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description: string;
  subServiceType: string;
}

export function FdaSubServicePage({ title, description, subServiceType }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const pricing = servicePrices[subServiceType];

  useEffect(() => {
    fetchOrders({ business_type_id: 3 }).then((data) => {
      setOrders(data.filter((o: Order) => o.sub_service_type === subServiceType));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [subServiceType]);

  const stats = {
    total: orders.length,
    inProgress: orders.filter(o => o.status === "进行中").length,
    completed: orders.filter(o => o.status === "已完成").length,
    totalAmount: orders.reduce((s, o) => s + o.total_amount, 0),
    thisMonth: orders.filter(o => {
      const d = o.created_at?.slice(0, 7) || "";
      return d === "2026-06";
    }).length,
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-7 w-28 rounded bg-[var(--muted)]" /><div className="h-40 rounded-xl bg-[var(--muted)]" /></div>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="shrink-0 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors" aria-label="返回"><ArrowLeft className="size-4" /></button>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{title}</h1>
          <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">{description}</p>
        </div>
      </div>

      {/* Stats + Pricing */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <span className="text-xs text-[var(--muted-foreground)]">总订单</span>
              <p className="font-mono text-2xl font-semibold text-[var(--foreground)]">{stats.total}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <span className="text-xs text-[var(--muted-foreground)]"><TrendingUp className="inline size-3 text-[var(--info)]" /> 进行中</span>
              <p className="font-mono text-2xl font-semibold text-[var(--info)]">{stats.inProgress}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <span className="text-xs text-[var(--muted-foreground)]">已完成</span>
              <p className="font-mono text-2xl font-semibold text-[var(--success)]">{stats.completed}</p>
            </div>
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <span className="text-xs text-[var(--muted-foreground)]"><DollarSign className="inline size-3 text-[var(--warning)]" /> 总收入</span>
              <p className="font-mono text-lg font-semibold text-[var(--foreground)]">¥{stats.totalAmount.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">本月新增 <strong className="text-[var(--foreground)]">{stats.thisMonth}</strong> 单</p>
        </div>

        {/* Pricing card */}
        {pricing && (
          <div className="rounded-2xl border-2 border-[color-mix(in_oklch,var(--success),var(--background)_70%)] bg-[color-mix(in_oklch,var(--success),var(--background)_97%)] px-5 py-4">
            <h3 className="mb-3 text-sm font-medium text-[var(--foreground)]">费用标准</h3>
            <ul className="space-y-2">
              {pricing.items.map((item) => (
                <li key={item.name} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--muted-foreground)]">{item.name}</span>
                  <span className="font-mono font-medium text-[var(--foreground)]">{item.price}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-[var(--muted-foreground)]">{pricing.note}</p>
          </div>
        )}
      </div>

      {/* Orders table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">订单号</th><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">客户</th><th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)]">金额</th><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th></tr></thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]">
                <td className="py-3 px-4"><Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline">{o.id}</Link></td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{o.customer_name}</td>
                <td className="py-3 px-4 text-right font-mono text-xs text-[var(--foreground)]">¥{o.total_amount.toLocaleString()}</td>
                <td className="py-3 px-4"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[o.status])}>{statusLabels[o.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无{title}订单</div>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/orders/new?biz=FDA认证&sub=${subServiceType}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)]"><Plus className="size-3.5" aria-hidden="true" />新建{title}订单</Link>
        <Link href="/documents?biz=FDA认证" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-all hover:bg-[var(--muted)]"><FileText className="size-3.5" aria-hidden="true" />去看文档</Link>
        <Link href="/tasks?biz=FDA认证" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-all hover:bg-[var(--muted)]"><ClipboardList className="size-3.5" aria-hidden="true" />看看任务</Link>
      </div>
    </div>
  );
}
