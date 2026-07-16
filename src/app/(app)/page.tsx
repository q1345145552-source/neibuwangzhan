"use client";

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/dashboard/stat-card";
import { TodoList } from "@/components/dashboard/todo-list";
import { fetchDashboardStats, fetchOrders, fetchAssignedSteps } from "@/lib/api";
import type { Order } from "@/lib/api";

const BusinessChart = dynamic(
  () => import("@/components/dashboard/business-chart").then((mod) => mod.BusinessChart),
  { loading: () => <ChartSkeleton /> }
);

function ChartSkeleton() {
  return (
    <div className="rounded-2xl border-0 bg-[var(--card)] px-5 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <div className="mb-4 h-4 w-36 animate-pulse rounded bg-[var(--muted)]" />
      <div className="h-[280px] animate-pulse rounded-md bg-[var(--muted)]" />
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ total_orders: 0, in_progress: 0, completed: 0, today_todos: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedSteps, setAssignedSteps] = useState<Array<{ step_id: number; order_id: string; step_name: string; status: string; business_type_name: string }>>([]);
  const [stepsLoaded, setStepsLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [s, o] = await Promise.all([
          fetchDashboardStats(),
          fetchOrders(),
        ]);
        setStats(s);
        setOrders(o);

        if (user?.name) {
          const steps = await fetchAssignedSteps(user.name);
          setAssignedSteps(steps);
          setStepsLoaded(true);
        }
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const businessCounts = useMemo(() => {
    const map: Record<string, number> = {};
    orders.forEach((o) => {
      map[o.business_type_id] = (map[o.business_type_id] || 0) + 1;
    });
    return map;
  }, [orders]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
          仪表盘
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {loading ? "正在加载..." : `早上好，${user?.name || "用户"}。今天有 ${stats.today_todos} 件事等着你。`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <StatCard label="总订单" value={stats.total_orders} href="/orders" />
        </div>
        <StatCard label="进行中" value={stats.in_progress} href="/orders?status=进行中" />
        <StatCard label="已完成" value={stats.completed} href="/orders?status=已完成" />
        <StatCard label="今日待办" value={stats.today_todos} href="/tasks" />
      </div>

      {stepsLoaded && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium text-[var(--foreground)]">我的环节</h2>
            <span className="text-xs text-[var(--muted-foreground)]">共 {assignedSteps.length} 个</span>
          </div>
          {assignedSteps.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {assignedSteps.map((step) => (
                <div key={step.step_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <Link href={`/orders/${step.order_id}`} className="shrink-0 font-mono text-xs font-medium text-[var(--primary)] hover:underline">
                    {step.order_id}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">{step.step_name}</span>
                  <span className="shrink-0 rounded-md bg-[var(--secondary)] px-1.5 py-0.5 text-xs text-[var(--secondary-foreground)]">{step.business_type_name}</span>
                  <span className={cn(
                    "shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                    step.status === "进行中" ? "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[var(--info)]" :
                    step.status === "阻塞" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]" :
                    step.status === "已完成" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" :
                    "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]"
                  )}>{step.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无分配的环节</p>
          )}
        </div>
      )}


      <BusinessChart data={businessCounts} />

      <TodoList orders={orders.filter((o) => o.status !== "已完成")} />
    </div>
  );
}
