"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl } from "@/lib/utils";
import { ArrowLeft, Wallet, Calendar, ChevronLeft, ChevronRight, Download, X } from "lucide-react";

interface Payslip {
  id: number;
  employee_id: number;
  employee_name: string;
  month: string;
  base_salary: number;
  diligence_bonus: number;
  skill_allowance: number;
  bonus: number | string;
  commission: number | string;
  overtime: number | string;
  social_security: number;
  late_deduction: number;
  personal_leave_deduction: number;
  sick_leave_deduction: number;
  withholding_tax: number | string;
  status: string;
  reject_reason: string;
  summary: string;
}

interface LateDetail { date: string; minutes: number; }
interface LeaveDetail { type: string; days: number; hours: number; has_certificate: boolean; images: string[]; }
interface AttendanceSummary {
  id: number;
  employee_id: number;
  employee_name: string;
  month: string;
  attendance_days: number;
  late_details: string;
  early_details: string;
  leave_details: string;
  work_hours: number;
  absence_days: number;
}

// 当前曼谷月份 YYYY-MM
function currentMonthKey(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

function parseJson<T>(s: string, fallback: T): T {
  try { return JSON.parse(s || "[]"); } catch { return fallback; }
}

export default function PayslipsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tab, setTab] = useState<"payslips" | "attendance">("payslips");
  const [month, setMonth] = useState(currentMonthKey());

  // ── 工资单 ──
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [genMsg, setGenMsg] = useState("");
  const [detail, setDetail] = useState<Payslip | null>(null);

  // ── 考勤汇总 ──
  const [summaries, setSummaries] = useState<AttendanceSummary[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [attGenerating, setAttGenerating] = useState(false);
  const [attErr, setAttErr] = useState("");
  const [attDetail, setAttDetail] = useState<AttendanceSummary | null>(null);

  // 医院证明大图（工资单详情和考勤汇总详情共用）
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin || !month) return;
    setLoading(true);
    setErr("");
    fetchWithAuth(`/api/payslips?month=${month}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPayslips(Array.isArray(d) ? d : []))
      .catch(() => setPayslips([]))
      .finally(() => setLoading(false));
  }, [month, isAdmin]);

  useEffect(() => {
    if (!month) return;
    setAttLoading(true);
    setAttErr("");
    const url = isAdmin ? `/api/attendance/summaries?month=${month}` : "/api/attendance/summaries";
    fetchWithAuth(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSummaries(Array.isArray(d) ? d : []))
      .catch(() => setSummaries([]))
      .finally(() => setAttLoading(false));
  }, [month, isAdmin]);

  const shiftMonth = (offset: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7));
  };

  // ── 工资单操作 ──
  const generate = async () => {
    if (!month) return;
    setGenerating(true);
    setErr("");
    setGenMsg("");
    try {
      const r = await fetchWithAuth("/api/payslips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setPayslips(Array.isArray(d.payslips) ? d.payslips : payslips);
        const created = typeof d.created === "number" ? d.created : 0;
        setGenMsg(created > 0 ? `已生成 ${created} 张工资单` : "已刷新工资单（自动项已按最新工资档案更新）");
      } else {
        setErr(d?.error || "生成失败");
      }
    } catch {
      setErr("生成失败");
    } finally {
      setGenerating(false);
    }
  };

  const updateField = (id: number, field: string, value: string) => {
    setPayslips((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const saveRow = async (id: number) => {
    const row = payslips.find((p) => p.id === id);
    if (!row) return;
    setSavingId(id);
    setErr("");
    try {
      const r = await fetchWithAuth("/api/payslips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          bonus: row.bonus === "" || row.bonus === null ? 0 : Number(row.bonus),
          commission: row.commission === "" || row.commission === null ? 0 : Number(row.commission),
          overtime: row.overtime === "" || row.overtime === null ? 0 : Number(row.overtime),
          withholding_tax: row.withholding_tax === "" || row.withholding_tax === null ? 0 : Number(row.withholding_tax),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setPayslips((prev) => prev.map((p) => (p.id === id ? { ...p, bonus: d.bonus, commission: d.commission, overtime: d.overtime, withholding_tax: d.withholding_tax } : p)));
      } else {
        setErr(d?.error || "保存失败");
      }
    } catch {
      setErr("保存失败");
    } finally {
      setSavingId(null);
    }
  };

  const n = (v: unknown) => (v === "" || v === null || v === undefined ? 0 : Number(v));
  const totalOf = (p: Payslip) => {
    return n(p.base_salary) + n(p.diligence_bonus) + n(p.skill_allowance) + n(p.bonus) + n(p.commission) + n(p.overtime);
  };
  const deductionOf = (p: Payslip) => {
    return n(p.social_security) + n(p.late_deduction) + n(p.personal_leave_deduction) + n(p.sick_leave_deduction) + n(p.withholding_tax);
  };

  const statusClass: Record<string, string> = {
    "草稿": "bg-slate-500/15 text-slate-600",
    "待确认": "bg-blue-500/15 text-blue-600",
    "已确认": "bg-green-500/15 text-green-600",
    "已发放": "bg-emerald-500/15 text-emerald-600",
    "打回": "bg-red-500/15 text-red-600",
  };

  const flowAction = async (id: number, action: string, reason?: string) => {
    setErr("");
    try {
      const r = await fetchWithAuth("/api/payslips/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.id) {
        setPayslips((prev) => prev.map((p) => (p.id === id ? { ...p, status: d.status, reject_reason: d.reject_reason } : p)));
      } else {
        setErr(d?.error || "操作失败");
      }
    } catch {
      setErr("操作失败");
    }
  };

  const exportExcel = async () => {
    if (!month) return;
    setErr("");
    try {
      const r = await fetchWithAuth(`/api/payslips/export?month=${month}`, {});
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `payslips_${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        setErr("导出失败");
      }
    } catch {
      setErr("导出失败");
    }
  };

  // ── 考勤汇总操作 ──
  const generateSummaries = async () => {
    if (!month) return;
    setAttGenerating(true);
    setAttErr("");
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
        setAttErr(d?.error || "生成失败");
      }
    } catch {
      setAttErr("生成失败");
    } finally {
      setAttGenerating(false);
    }
  };

  const attLates = attDetail ? parseJson<LateDetail[]>(attDetail.late_details, []) : [];
  const attEarlies = attDetail ? parseJson<LateDetail[]>(attDetail.early_details, []) : [];
  const attLeaves = attDetail ? parseJson<LeaveDetail[]>(attDetail.leave_details, []) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">工资单</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">月度工资核算 · 考勤汇总</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      {/* 标签页：工资单 / 考勤汇总 */}
      <div className="flex items-center gap-4 border-b border-[var(--border)]">
        <button
          onClick={() => setTab("payslips")}
          className={cn("pb-2 text-sm font-medium transition-colors border-b-2 -mb-px", tab === "payslips" ? "border-[var(--foreground)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}
        >
          工资单
        </button>
        <button
          onClick={() => setTab("attendance")}
          className={cn("pb-2 text-sm font-medium transition-colors border-b-2 -mb-px", tab === "attendance" ? "border-[var(--foreground)] text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}
        >
          考勤汇总
        </button>
      </div>

      {tab === "payslips" ? (
        !isAdmin ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">仅管理员可查看工资单</div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(-1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
                <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(1)}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>
              <Button size="sm" className="h-9" onClick={generate} disabled={generating || !month}>
                <Wallet className="size-3.5" />
                {generating ? "生成中…" : "生成工资单"}
              </Button>
              <Button size="sm" variant="outline" className="h-9" onClick={exportExcel} disabled={!month || payslips.length === 0}>
                <Download className="size-3.5" />
                导出 Excel
              </Button>
              {genMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{genMsg}</span>}
              {err && <span className="text-xs text-red-500">{err}</span>}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">改完「工资设置」后，请重新点「生成工资单」：底薪 / 勤奋奖 / 技能津贴会按最新档案刷新（奖金、佣金等手动项不变）。</p>

            {loading ? (
              <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
            ) : payslips.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-10 text-center text-sm text-[var(--muted-foreground)]">
                该月份还没有工资单，点上方「生成工资单」生成。
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                        <th className="py-3 px-4 text-left text-xs font-medium">员工</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">底薪</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">勤奋奖</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">技能津贴</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">奖金</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">佣金</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">加班费</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">收入合计</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">社保</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">迟到</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">事假</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">病假</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">预扣税</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">净收入</th>
                        <th className="py-3 px-3 text-center text-xs font-medium">状态</th>
                        <th className="py-3 px-3 text-right text-xs font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payslips.map((p) => (
                        <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                          <td className="py-2.5 px-4 font-medium whitespace-nowrap text-[var(--foreground)]">{p.employee_name}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{p.base_salary}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{p.diligence_bonus}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums">{p.skill_allowance}</td>
                          <td className="py-2.5 px-3 text-right">
                            <input type="number" min="0" step="0.01" value={p.bonus ?? ""} onChange={(e) => updateField(p.id, "bonus", e.target.value)} className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-right text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input type="number" min="0" step="0.01" value={p.commission ?? ""} onChange={(e) => updateField(p.id, "commission", e.target.value)} className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-right text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <input type="number" min="0" step="0.01" value={p.overtime ?? ""} onChange={(e) => updateField(p.id, "overtime", e.target.value)} className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-right text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{totalOf(p).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--muted-foreground)]">{(p.social_security || 0).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--muted-foreground)]">{(p.late_deduction || 0).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--muted-foreground)]">{(p.personal_leave_deduction || 0).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-[var(--muted-foreground)]">{(p.sick_leave_deduction || 0).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right">
                            <input type="number" min="0" step="0.01" value={p.withholding_tax ?? ""} onChange={(e) => updateField(p.id, "withholding_tax", e.target.value)} className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-right text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums font-semibold text-emerald-600">{(totalOf(p) - deductionOf(p)).toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", statusClass[p.status] || "bg-slate-500/15 text-slate-600")} title={p.reject_reason || ""}>
                              {p.status}
                            </span>
                            {p.status === "打回" && p.reject_reason && (
                              <p className="mt-1 text-[0.6rem] text-red-500">意见：{p.reject_reason}</p>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetail(p)}>详情</Button>
                            <Button size="sm" className="h-7 text-xs ml-1" onClick={() => saveRow(p.id)} disabled={savingId === p.id}>
                              {savingId === p.id ? "保存中…" : "保存"}
                            </Button>
                            {p.status === "草稿" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs ml-1" onClick={() => flowAction(p.id, "send")}>发送</Button>
                            )}
                            {p.status === "打回" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs ml-1" onClick={() => flowAction(p.id, "send")}>重发</Button>
                            )}
                            {p.status === "已确认" && (
                              <Button size="sm" className="h-7 text-xs ml-1" onClick={() => flowAction(p.id, "pay")}>发放</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 工资单详情：底部显示考勤汇总 */}
            {detail && (() => {
              const s = (() => { try { return JSON.parse(detail.summary || "{}"); } catch { return {}; } })();
              const lates: { date: string; minutes: number }[] = Array.isArray(s.late_details) ? s.late_details : [];
              const leaves: { type: string; days: number; hours: number; has_certificate: boolean; images: string[] }[] = Array.isArray(s.leave_details) ? s.leave_details : [];
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
                  <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-[var(--foreground)]">{detail.employee_name} · {detail.month} 工资单</h3>
                      <button onClick={() => setDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
                    </div>

                    <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">考勤汇总</p>
                    <div className="rounded-md border border-[var(--border)] p-3">
                      <p className="text-sm text-[var(--foreground)]">出勤天数：<span className="font-semibold">{s.attendance_days ?? 0}</span></p>

                      <p className="mt-2 text-xs font-medium text-[var(--muted-foreground)]">迟到明细</p>
                      {lates.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">无迟到</p>
                      ) : (
                        <div className="space-y-0.5">
                          {lates.map((l, i) => (
                            <p key={i} className="text-xs text-[var(--foreground)]"><span className="text-amber-600">{l.date}</span> 迟到 {l.minutes} 分钟</p>
                          ))}
                        </div>
                      )}

                      <p className="mt-2 text-xs font-medium text-[var(--muted-foreground)]">请假明细</p>
                      {leaves.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">无请假</p>
                      ) : (
                        <div className="space-y-1.5">
                          {leaves.map((l, i) => (
                            <div key={i}>
                              <p className="text-xs text-[var(--foreground)]">
                                {l.type} {l.days} 天
                                {l.type === "事假" && l.days === 1 ? `（${l.hours} 小时）` : ""}
                                {l.type === "病假" && (l.has_certificate ? "（有医院证明）" : "（无医院证明）")}
                              </p>
                              {l.images?.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-2">
                                  {l.images.map((img, j) => (
                                    <button key={j} onClick={() => setLightbox(img)} className="overflow-hidden rounded-md border border-[var(--border)]">
                                      <img src={fileUrl(img)} alt="医院证明" className="h-16 w-16 object-cover" />
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
              );
            })()}
          </>
        )
      ) : (
        <>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(-1)}><ChevronLeft className="size-4" /></Button>
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]" />
                <Button size="sm" variant="outline" className="h-9 px-2" onClick={() => shiftMonth(1)}><ChevronRight className="size-4" /></Button>
              </div>
              <Button size="sm" className="h-9" onClick={generateSummaries} disabled={attGenerating || !month}>
                <Calendar className="size-3.5" />
                {attGenerating ? "生成中…" : "生成考勤汇总"}
              </Button>
              {attErr && <span className="text-xs text-red-500">{attErr}</span>}
            </div>
          )}

          {attLoading ? (
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
                      <th className="py-3 px-4 text-center text-xs font-medium">早退</th>
                      <th className="py-3 px-4 text-center text-xs font-medium">工作时间</th>
                      <th className="py-3 px-4 text-center text-xs font-medium">缺勤</th>
                      <th className="py-3 px-4 text-center text-xs font-medium">请假</th>
                      <th className="py-3 px-4 text-right text-xs font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaries.map((s) => {
                      const lates = parseJson<LateDetail[]>(s.late_details, []);
                      const earlies = parseJson<LateDetail[]>(s.early_details, []);
                      const leaves = parseJson<LeaveDetail[]>(s.leave_details, []);
                      const lateMins = lates.reduce((a, l) => a + l.minutes, 0);
                      const earlyMins = earlies.reduce((a, l) => a + l.minutes, 0);
                      return (
                        <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                          <td className="py-3 px-4 font-medium whitespace-nowrap text-[var(--foreground)]">{s.employee_name}</td>
                          <td className="py-3 px-4 text-center tabular-nums">{s.month}</td>
                          <td className="py-3 px-4 text-center tabular-nums font-semibold">{s.attendance_days}</td>
                          <td className={cn("py-3 px-4 text-center tabular-nums", lates.length > 0 ? "text-amber-600" : "text-[var(--muted-foreground)]")}>
                            {lates.length > 0 ? `${lates.length} 次 · ${lateMins} 分` : "—"}
                          </td>
                          <td className={cn("py-3 px-4 text-center tabular-nums", earlies.length > 0 ? "text-orange-600" : "text-[var(--muted-foreground)]")}>
                            {earlies.length > 0 ? `${earlies.length} 次 · ${earlyMins} 分` : "—"}
                          </td>
                          <td className="py-3 px-4 text-center tabular-nums">{(s.work_hours || 0)} 小时</td>
                          <td className={cn("py-3 px-4 text-center tabular-nums", (s.absence_days || 0) > 0 ? "text-red-600 font-semibold" : "text-[var(--muted-foreground)]")}>
                            {(s.absence_days || 0)} 天
                          </td>
                          <td className={cn("py-3 px-4 text-center tabular-nums", leaves.length > 0 ? "text-blue-600" : "text-[var(--muted-foreground)]")}>
                            {leaves.length > 0 ? `${leaves.length} 次` : "—"}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAttDetail(s)}>查看详情</Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 考勤汇总详情弹窗 */}
          {attDetail && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAttDetail(null)}>
              <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-[var(--foreground)]">{attDetail.employee_name} · {attDetail.month} 考勤汇总</h3>
                  <button onClick={() => setAttDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
                </div>

                <div className="mb-3 flex items-center gap-2 rounded-md bg-[var(--muted)]/40 px-3 py-2">
                  <span className="text-xs text-[var(--muted-foreground)]">出勤天数</span>
                  <span className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{attDetail.attendance_days}</span>
                </div>

                <div className="mb-3 flex items-center gap-4 rounded-md bg-[var(--muted)]/40 px-3 py-2 text-sm">
                  <span className="text-[var(--foreground)]">工作时间 <span className="font-semibold tabular-nums">{(attDetail.work_hours || 0)}</span> 小时</span>
                  <span className="text-[var(--foreground)]">缺勤 <span className="font-semibold tabular-nums">{(attDetail.absence_days || 0)}</span> 天</span>
                </div>

                <div className="mb-3">
                  <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">迟到明细</p>
                  {attLates.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">无迟到</p>
                  ) : (
                    <div className="space-y-1">
                      {attLates.map((l, i) => (
                        <p key={i} className="text-sm text-[var(--foreground)]">
                          <span className="text-amber-600">{l.date}</span> 迟到 {l.minutes} 分钟
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mb-3">
                  <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">早退明细</p>
                  {attEarlies.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">无早退</p>
                  ) : (
                    <div className="space-y-1">
                      {attEarlies.map((l, i) => (
                        <p key={i} className="text-sm text-[var(--foreground)]">
                          <span className="text-orange-600">{l.date}</span> 早退 {l.minutes} 分钟
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">请假明细</p>
                  {attLeaves.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">无请假</p>
                  ) : (
                    <div className="space-y-2">
                      {attLeaves.map((l, i) => (
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
        </>
      )}

      {/* 医院证明大图（工资单详情 / 考勤汇总详情共用） */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <img src={fileUrl(lightbox)} alt="医院证明大图" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button onClick={() => setLightbox(null)} className="absolute right-4 top-4 text-white/80 hover:text-white"><X className="size-6" /></button>
        </div>
      )}
    </div>
  );
}
