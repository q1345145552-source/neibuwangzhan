import { StatCard } from "@/components/dashboard/stat-card";
import { TodoList } from "@/components/dashboard/todo-list";
import dynamic from "next/dynamic";

const BusinessChart = dynamic(
  () => import("@/components/dashboard/business-chart").then((mod) => mod.BusinessChart),
  { loading: () => <ChartSkeleton /> }
);

function ChartSkeleton() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-5">
      <div className="mb-4 h-4 w-36 animate-pulse rounded bg-[var(--muted)]" />
      <div className="h-[280px] animate-pulse rounded-md bg-[var(--muted)]" />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div>
        <h1
          className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]"
          style={{ textWrap: "balance" }}
        >
          仪表盘
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          早上好，张三。今天有 {12} 件事等着你。
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <StatCard label="总订单" value={628} change={{ value: 12, direction: "up" }} />
        </div>
        <StatCard label="进行中" value={47} change={{ value: 3, direction: "up" }} />
        <StatCard
          label="已完成"
          value={523}
          change={{ value: 8, direction: "up" }}
        />
        <StatCard
          label="今日待办"
          value={12}
          change={{ value: 0, direction: "flat" }}
        />
      </div>

      {/* Chart */}
      <BusinessChart />

      {/* Todo list */}
      <TodoList />
    </div>
  );
}
