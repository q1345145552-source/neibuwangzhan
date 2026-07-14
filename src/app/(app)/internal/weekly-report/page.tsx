"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

interface EmployeeReport {
  name: string;
  orderSteps: number;
  evaluations: number;
  contracts: number;
  issuesResolved: number;
}

function getWeekRange(offset: number) {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  monday.setDate(monday.getDate() + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { from: fmt(monday), to: fmt(sunday), label: `${fmt(monday)} ~ ${fmt(sunday)}` };
}

export default function WeeklyReportPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<EmployeeReport[]>([]);
  const [loading, setLoading] = useState(true);

  const { from, to, label } = useMemo(() => getWeekRange(weekOffset), [weekOffset]);

  useEffect(() => {
    setLoading(true);
    fetchWithAuth(`/api/internal/weekly-report?from=${from}&to=${to}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => setData(d.employees || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  const totals = useMemo(() => {
    return data.reduce(
      (acc, e) => ({
        orderSteps: acc.orderSteps + e.orderSteps,
        evaluations: acc.evaluations + e.evaluations,
        contracts: acc.contracts + e.contracts,
        issuesResolved: acc.issuesResolved + e.issuesResolved,
      }),
      { orderSteps: 0, evaluations: 0, contracts: 0, issuesResolved: 0 }
    );
  }, [data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">周报</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">团队工作量统计</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs">返回内部管理</Button>
        </Link>
      </div>

      {/* Week selector */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekOffset(o => o - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium min-w-[240px] text-center">{label}</span>
        <Button variant="outline" size="sm" className="h-8" onClick={() => setWeekOffset(o => o < 0 ? o + 1 : 0)} disabled={weekOffset >= 0}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : data.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">该周暂无数据</div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-3 px-5 text-left text-xs font-medium">员工</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">完成订单步骤</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">达人评估</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">签订合同</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">解决工单</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">合计</th>
                </tr>
              </thead>
              <tbody>
                {data.map(e => (
                  <tr key={e.name} className="border-b border-[var(--border)] hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 font-medium">{e.name}</td>
                    <td className="py-2.5 px-4 text-center tabular-nums">{e.orderSteps}</td>
                    <td className="py-2.5 px-4 text-center tabular-nums">{e.evaluations}</td>
                    <td className="py-2.5 px-4 text-center tabular-nums">{e.contracts}</td>
                    <td className="py-2.5 px-4 text-center tabular-nums">{e.issuesResolved}</td>
                    <td className="py-2.5 px-4 text-center tabular-nums font-semibold">
                      {e.orderSteps + e.evaluations + e.contracts + e.issuesResolved}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--muted)]/20 font-semibold">
                  <td className="py-2.5 px-5">合计</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{totals.orderSteps}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{totals.evaluations}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{totals.contracts}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{totals.issuesResolved}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {totals.orderSteps + totals.evaluations + totals.contracts + totals.issuesResolved}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
