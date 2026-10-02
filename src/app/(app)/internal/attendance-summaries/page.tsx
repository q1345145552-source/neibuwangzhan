"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface AttendanceSummary {
  id: number;
  employee_id: number;
  employee_name: string;
  month: string;
  attendance_days: number;
  late_details: string;
  leave_details: string;
}

interface LateDetail { date: string; minutes: number; }
interface LeaveDetail { type: string; days: number; hours: number; has_certificate: boolean; }

function currentMonthKey(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s || "[]"); } catch { return fallback; }
}

export default function AttendanceSummariesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [month, setMonth] = useState(currentMonthKey());
  const [summaries, setSummaries] = useState<AttendanceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isAdmin || !month) return;
    setLoading(true);
    setErr("");
    fetchWithAuth(`/api/attendance/summaries?month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSummaries(Array.isArray(d) ? d : []))
      .catch(() => setSummaries([]))
      .finally(() => setLoading(false));
  }, [month, isAdmin]);

  if (!isAdmin) {
    return <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">仅管理员可查看考勤汇总</div>;
  }

  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7));
  };

  const generate = async () => {
    if (!month) return;
    setGenerating(true);
    setErr("");
    try {
      const r = await fetchWithAuth("/api/attendance/summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setSummaries(Array.isArray(d.summaries) ? d.summaries : summaries);
      } else {
        setErr(d?.error || "生成失败");
      }
    } catch {
      setErr("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">考勤汇总</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">每月生成一次，统计出勤天数 / 迟到明细 / 请假明细</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(-1)}><ChevronLeft className="size-4" /></Button>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
          <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(1)}><ChevronRight className="size-4" /></Button>
        </div>
        <Button size="sm" className="h-9" onClick={generate} disabled={generating || !month}>
          <Calendar className="size-3.5" />
          {generating ? "生成中…" : "生成考勤汇总"}
        </Button>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-10 text-center text-sm text-[var(--muted-foreground)]">
          该月份还没有考勤汇总，点上方「生成考勤汇总」生成。
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-3 px-4 text-left text-xs font-medium">员工</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">出勤天数</th>
                  <th className="py-3 px-4 text-left text-xs font-medium">迟到明细</th>
                  <th className="py-3 px-4 text-left text-xs font-medium">请假明细</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => {
                  const lates = parseJson<LateDetail[]>(s.late_details, []);
                  const leaves = parseJson<LeaveDetail[]>(s.leave_details, []);
                  return (
                    <tr key={s.id} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--muted)]/20">
                      <td className="py-3 px-4 font-medium whitespace-nowrap text-[var(--foreground)]">{s.employee_name}</td>
                      <td className="py-3 px-4 text-center tabular-nums font-semibold">{s.attendance_days}</td>
                      <td className="py-3 px-4 text-[var(--muted-foreground)]">
                        {lates.length === 0 ? (
                          <span className="text-xs">无</span>
                        ) : (
                          <div className="space-y-0.5">
                            {lates.map((l, i) => (
                              <p key={i} className="text-xs">
                                <span className="text-amber-600">{l.date.slice(5)}</span> 迟到 {l.minutes} 分钟
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-[var(--muted-foreground)]">
                        {leaves.length === 0 ? (
                          <span className="text-xs">无</span>
                        ) : (
                          <div className="space-y-0.5">
                            {leaves.map((l, i) => (
                              <p key={i} className="text-xs">
                                {l.type} {l.days} 天
                                {l.type === "事假" && l.days === 1 ? `（${l.hours} 小时）` : ""}
                                {l.type === "病假" && (l.has_certificate ? "（有医院证明）" : "（无医院证明）")}
                              </p>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
