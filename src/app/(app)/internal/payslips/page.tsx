"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { ArrowLeft, Wallet } from "lucide-react";

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
}

// 当前曼谷月份 YYYY-MM
function currentMonthKey(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
}

export default function PayslipsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [month, setMonth] = useState(currentMonthKey());
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [err, setErr] = useState("");

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

  if (!isAdmin) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">仅管理员可查看工资单</div>
    );
  }

  const generate = async () => {
    if (!month) return;
    setGenerating(true);
    setErr("");
    try {
      const r = await fetchWithAuth("/api/payslips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setPayslips(Array.isArray(d.payslips) ? d.payslips : payslips);
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">工资单</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">月度工资核算 · 底薪 / 勤奋奖 / 技能津贴自动读取，奖金 / 佣金 / 加班费手动填写</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-base text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        />
        <Button size="sm" className="h-9" onClick={generate} disabled={generating || !month}>
          <Wallet className="size-3.5" />
          {generating ? "生成中…" : "生成工资单"}
        </Button>
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

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
                    <td className="py-2.5 px-3 text-right">
                      <Button size="sm" className="h-7 text-xs" onClick={() => saveRow(p.id)} disabled={savingId === p.id}>
                        {savingId === p.id ? "保存中…" : "保存"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
