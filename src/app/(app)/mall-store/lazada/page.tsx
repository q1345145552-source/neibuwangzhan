"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { fetchOrders } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function LazadaMallPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders({ business_type_id: 8 }).then((data) => {
      setOrders(data.filter((o: Order) => o.sub_service_type === "lazada"));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const stats = { total: orders.length, inProgress: orders.filter(o => o.status === "进行中").length, completed: orders.filter(o => o.status === "已完成").length };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-7 w-28 rounded bg-[var(--muted)]" /><div className="h-40 rounded-xl bg-[var(--muted)]" /></div>;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>Lazada Mall</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">Lazada Mall要求法人申请，产品需先有FDA或TISI认证才能上架。Bam负责前期资料和提交，流程比Shopee简单但认证是硬门槛。</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"><span className="text-xs text-[var(--muted-foreground)]">总订单</span><p className="font-mono text-2xl font-semibold text-[var(--foreground)]">{stats.total}</p></div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"><span className="text-xs text-[var(--muted-foreground)]">进行中</span><p className="font-mono text-2xl font-semibold text-[var(--info)]">{stats.inProgress}</p></div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]"><span className="text-xs text-[var(--muted-foreground)]">已完成</span><p className="font-mono text-2xl font-semibold text-[var(--success)]">{stats.completed}</p></div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">订单号</th><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">客户</th><th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)]">金额</th><th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th></tr></thead>
          <tbody>{orders.map(o => (<tr key={o.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]"><td className="py-3 px-4"><Link href={`/orders/${o.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline">{o.id}</Link></td><td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{o.customer_name}</td><td className="py-3 px-4 text-right font-mono text-xs text-[var(--foreground)]">¥{o.total_amount.toLocaleString()}</td><td className="py-3 px-4"><span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[o.status])}>{statusLabels[o.status]}</span></td></tr>))}</tbody>
        </table>
        {orders.length === 0 && <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无Lazada Mall订单</div>}
      </div>
      <Link href="/orders/new" className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)]"><Plus className="size-3.5" />新建Lazada Mall订单</Link>
    </div>
  );
}
