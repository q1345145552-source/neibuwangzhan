"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trophy, TrendingUp, TrendingDown, Plus, Minus, RefreshCw, X, Medal, Crown, Star } from "lucide-react";

interface Ranking {
  name: string;
  total_points: number;
  bonus: number;
  penalty: number;
}

interface PointsRecord {
  id: number;
  employee_name: string;
  points: number;
  reason: string;
  rule_key: string;
  is_manual: number;
  is_appealed: number;
  created_by: string;
  created_at: string;
}

interface Employee {
  name: string;
}

export default function RewardsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [records, setRecords] = useState<PointsRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  // Manual form
  const [form, setForm] = useState({ employee_name: "", points: "", reason: "" });
  const [formErr, setFormErr] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      let url = `/api/internal/points?month=${month}`;
      if (filterEmployee) url += `&employee=${encodeURIComponent(filterEmployee)}`;
      const res = await fetchWithAuth(url, { cache: "no-store" });
      const data = await res.json();
      setRankings(data.rankings || []);
      setRecords(data.records || []);
      setEmployees(data.employees || []);
    } catch (e) {
      console.error("[奖惩] 加载失败", e);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [month, filterEmployee]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      await fetchWithAuth(`/api/internal/points?month=${month}&refresh=1`, { cache: "no-store" });
      load();
    } catch (e) {
      console.error("[奖惩] 刷新积分失败", e);
    }
    setComputing(false);
  };

  const handleSubmit = async () => {
    const pts = Number(form.points);
    if (!form.employee_name || !pts || !form.reason.trim()) {
      setFormErr("请填写完整信息");
      return;
    }
    setFormErr("");
    try {
      const res = await fetchWithAuth("/api/internal/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: form.employee_name, points: pts, reason: form.reason }),
      });
      if (!res.ok) throw new Error("提交失败");
      setForm({ employee_name: "", points: "", reason: "" });
      load();
    } catch (e) {
      setFormErr("提交失败，请重试");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这条记录？")) return;
    try {
      await fetchWithAuth("/api/internal/points", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      load();
    } catch {}
  };

  const rankMedal = (idx: number) => {
    if (idx === 0) return <Crown className="size-4 text-amber-500" />;
    if (idx === 1) return <Medal className="size-4 text-slate-400" />;
    if (idx === 2) return <Medal className="size-4 text-amber-700" />;
    return <span className="text-xs text-[var(--muted-foreground)] w-4 text-center">{idx + 1}</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight">奖惩制度</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">积分排名与奖惩记录</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="h-9 rounded border border-[var(--border)] px-3 text-sm bg-[var(--background)]"
          />
          <Button size="sm" variant="outline" className="h-9" onClick={handleCompute} disabled={computing}>
            <RefreshCw className={cn("size-3.5 mr-1.5", computing && "animate-spin")} />
            刷新积分
          </Button>
        </div>
      </div>

      {/* ── 积分排名榜 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium flex items-center gap-2"><Trophy className="size-4" />积分排名 · {month}</h2>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
        ) : rankings.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无数据，点击右上角刷新积分</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-5 text-left text-xs font-medium w-10">#</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>
                  <th className="py-2.5 px-4 text-center text-xs font-medium">总积分</th>
                  <th className="py-2.5 px-4 text-center text-xs font-medium text-green-600">加分</th>
                  <th className="py-2.5 px-4 text-center text-xs font-medium text-red-500">扣分</th>
                </tr>
              </thead>
              <tbody>
                {rankings.map((r, idx) => (
                  <tr key={r.name} className={cn(
                    "border-b border-[var(--border)]",
                    idx === 0 && "bg-amber-50/30 dark:bg-amber-950/10",
                    idx === 1 && "bg-slate-50/30 dark:bg-slate-950/10",
                    idx === 2 && "bg-orange-50/20 dark:bg-orange-950/10"
                  )}>
                    <td className="py-2.5 px-5">{rankMedal(idx)}</td>
                    <td className={cn("py-2.5 px-4 font-medium", idx < 3 && "font-semibold")}>{r.name}</td>
                    <td className={cn(
                      "py-2.5 px-4 text-center font-semibold tabular-nums",
                      r.total_points > 0 ? "text-green-600" : r.total_points < 0 ? "text-red-500" : "text-[var(--muted-foreground)]"
                    )}>
                      {r.total_points > 0 ? "+" : ""}{r.total_points}
                    </td>
                    <td className="py-2.5 px-4 text-center text-green-600 tabular-nums">+{r.bonus}</td>
                    <td className="py-2.5 px-4 text-center text-red-500 tabular-nums">-{r.penalty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 积分变动记录 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><TrendingUp className="size-4" />积分变动记录</h2>
          {isAdmin && (
            <select
              value={filterEmployee}
              onChange={e => setFilterEmployee(e.target.value)}
              className="h-8 rounded border border-[var(--border)] px-2 text-xs"
            >
              <option value="">全部员工</option>
              {employees.map(e => (
                <option key={e.name} value={e.name}>{e.name}</option>
              ))}
            </select>
          )}
        </div>
        {records.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {isAdmin && <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>}
                  <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                  <th className="py-2.5 px-4 text-center text-xs font-medium">积分</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">时间</th>
                  {isAdmin && <th className="py-2.5 px-4 text-center text-xs font-medium">操作</th>}
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} className="border-b border-[var(--border)]">
                    {isAdmin && <td className="py-2.5 px-4 font-medium">{r.employee_name}</td>}
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-w-xs truncate">
                      {r.reason}
                      {r.is_manual === 1 && <span className="ml-1.5 text-xs text-blue-500">[手动]</span>}
                      {r.is_appealed === 1 && <span className="ml-1.5 text-xs text-amber-500">[已申诉]</span>}
                    </td>
                    <td className={cn(
                      "py-2.5 px-4 text-center font-semibold tabular-nums",
                      r.points > 0 ? "text-green-600" : "text-red-500"
                    )}>
                      {r.points > 0 ? "+" : ""}{r.points}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{r.created_at?.slice(0, 16)}</td>
                    {isAdmin && (
                      <td className="py-2.5 px-4 text-center">
                        {r.is_manual === 1 && (
                          <button onClick={() => handleDelete(r.id)} className="text-red-400 hover:text-red-600 text-xs">
                            <X className="size-3.5" />
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 老板手动奖惩 ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><Plus className="size-4" />手动奖惩</h2>
          </div>
          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium">员工</label>
                <select
                  value={form.employee_name}
                  onChange={e => setForm(p => ({ ...p, employee_name: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm"
                >
                  <option value="">选择员工</option>
                  {employees.map(e => (
                    <option key={e.name} value={e.name}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">积分（正数加分，负数扣分）</label>
                <input
                  type="number"
                  value={form.points}
                  onChange={e => setForm(p => ({ ...p, points: e.target.value }))}
                  placeholder="如 +5 或 -3"
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium">原因</label>
                <input
                  value={form.reason}
                  onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                  placeholder="奖惩原因..."
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm"
                />
              </div>
            </div>
            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-3">
              <Button size="sm" onClick={handleSubmit}>提交记录</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
