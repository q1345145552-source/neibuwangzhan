"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl } from "@/lib/utils";
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

interface LateDetail { date: string; minutes: number; }
interface LeaveDetail { type: string; days: number; hours: number; has_certificate: boolean; images: string[]; }
interface AttendanceSummary {
  id: number;
  employee_id: number;
  employee_name: string;
  month: string;
  attendance_days: number;
  late_details: string;
  leave_details: string;
}

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
  const [detail, setDetail] = useState<AttendanceSummary | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!month) return;
    setLoading(true);
    setErr("");
    const url = isAdmin ? `/api/attendance/summaries?month=${month}` : "/api/attendance/summaries";
    fetchWithAuth(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSummaries(Array.isArray(d) ? d : []))
      .catch(() => setSummaries([]))
      .finally(() => setLoading(false));
  }, [month, isAdmin]);

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

  const detailLates = detail ? parseJson<LateDetail[]>(detail.late_details, []) : [];
  const detailLeaves = detail ? parseJson<LeaveDetail[]>(detail.leave_details, []) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">考勤汇总</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "所有员工月度考勤汇总" : "我的考勤汇总"}</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      {isAdmin && (
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
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : summaries.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-10 text-center text-sm text-[var(--muted-foreground)]">
          {isAdmin ? "该月份还没有考勤汇总，点上方「生成考勤汇总」生成。" : "暂无考勤汇总"}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-3 px-4 text-left text-xs font-medium">员工</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">月份</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">出勤天数</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">迟到</th>
                  <th className="py-3 px-4 text-center text-xs font-medium">请假</th>
                  <th className="py-3 px-4 text-right text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => {
                  const lates = parseJson<LateDetail[]>(s.late_details, []);
                  const leaves = parseJson<LeaveDetail[]>(s.leave_details, []);
                  return (
                    <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                      <td className="py-3 px-4 font-medium whitespace-nowrap text-[var(--foreground)]">{s.employee_name}</td>
                      <td className="py-3 px-4 text-center tabular-nums">{s.month}</td>
                      <td className="py-3 px-4 text-center tabular-nums font-semibold">{s.attendance_days}</td>
                      <td className={cn("py-3 px-4 text-center tabular-nums", lates.length > 0 ? "text-amber-600" : "text-[var(--muted-foreground)]")}>
                        {lates.length > 0 ? `${lates.length} 次` : "—"}
                      </td>
                      <td className={cn("py-3 px-4 text-center tabular-nums", leaves.length > 0 ? "text-blue-600" : "text-[var(--muted-foreground)]")}>
                        {leaves.length > 0 ? `${leaves.length} 次` : "—"}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetail(s)}>查看详情</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">{detail.employee_name} · {detail.month} 考勤汇总</h3>
              <button onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mb-3 flex items-center gap-2 rounded-md bg-[var(--muted)]/40 px-3 py-2">
              <span className="text-xs text-[var(--muted-foreground)]">出勤天数</span>
              <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{detail.attendance_days}</span>
            </div>

            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">迟到明细</p>
              {detailLates.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">无迟到</p>
              ) : (
                <div className="space-y-1">
                  {detailLates.map((l, i) => (
                    <p key={i} className="text-sm text-[var(--foreground)]">
                      <span className="text-amber-600">{l.date}</span> 迟到 {l.minutes} 分钟
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">请假明细</p>
              {detailLeaves.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">无请假</p>
              ) : (
                <div className="space-y-2">
                  {detailLeaves.map((l, i) => (
                    <div key={i} className="rounded-md border border-[var(--border)] px-3 py-2">
                      <p className="text-sm text-[var(--foreground)]">
                        {l.type} {l.days} 天
                        {l.type === "事假" && l.days === 1 ? `（${l.hours} 小时）` : ""}
                        {l.type === "病假" && (l.has_certificate ? "（有医院证明）" : "（无医院证明）")}
                      </p>
                      {l.images.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {l.images.map((img, j) => (
                            <button key={j} onClick={() => setLightbox(img)} className="overflow-hidden rounded-md border border-[var(--border)]">
                              <img src={fileUrl(img)} alt="医院证明" className="h-16 w-16 object-cover transition-transform hover:scale-105" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 图片大图 */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={fileUrl(lightbox)} alt="医院证明大图" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button onClick={() => setLightbox(null)} className="absolute right-4 top-4 text-white/80 hover:text-white"><X className="size-6" /></button>
        </div>
      )}
    </div>
  );
}
