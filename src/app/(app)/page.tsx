"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { StatCard } from "@/components/dashboard/stat-card";
import { TodoList } from "@/components/dashboard/todo-list";
import { fetchDashboardStats, fetchOrders } from "@/lib/api";
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
  const [stats, setStats] = useState({ total_orders: 0, in_progress: 0, completed: 0, today_todos: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [s, o] = await Promise.all([
          fetchDashboardStats(),
          fetchOrders(),
        ]);
        setStats(s);
        setOrders(o);
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
          {loading ? "正在加载..." : `早上好，张三。今天有 ${stats.today_todos} 件事等着你。`}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <StatCard label="总订单" value={stats.total_orders} />
        </div>
        <StatCard label="进行中" value={stats.in_progress} />
        <StatCard label="已完成" value={stats.completed} />
        <StatCard label="今日待办" value={stats.today_todos} />
      </div>

      <BusinessChart data={businessCounts} />

      <TodoList orders={orders.filter((o) => o.status === "进行中")} />
    </div>
  );
}
