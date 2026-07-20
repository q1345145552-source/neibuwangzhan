"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Trophy, TrendingUp, RefreshCw, X, Medal, Crown, AlertCircle, MessageSquare, Heart, ThumbsUp, ThumbsDown, Calendar } from "lucide-react";
import Link from "next/link";
import { bangkokMonthKey, bangkokDateStr } from "@/lib/time";

interface Ranking {
  name: string; total_points: number; bonus: number; penalty: number;
}
interface PointsRecord {
  id: number; employee_name: string; points: number; reason: string;
  rule_key: string; is_manual: number; is_appealed: number;
  appeal_reason: string; appeal_status: string; status: string;
  created_by: string; created_at: string;
  undone_by?: string; undone_at?: string;
}
interface Employee { name: string; }
interface PeerVote {
  id: number; voter: string; nominee: string; reason: string; month: string; created_at: string;
}
interface ClientFeedback {
  id: number; order_id: string; responsible_person: string;
  overall: number; attitude: number; speed: number; professionalism: number;
  comment: string; created_at: string;
}
interface Quarter { label: string; value: string; }

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex text-xs" style={{ color: "#f59e0b" }}>
      {"★".repeat(Math.max(0, Math.min(5, n || 0)))}
      <span style={{ color: "#d1d5db" }}>{"★".repeat(5 - Math.max(0, Math.min(5, n || 0)))}</span>
    </span>
  );
}

export default function RewardsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [salesRanking, setSalesRanking] = useState<{name:string;total_points:number}[]>([]);
  const [records, setRecords] = useState<PointsRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [appeals, setAppeals] = useState<PointsRecord[]>([]);
  const [peerVotes, setPeerVotes] = useState<PeerVote[]>([]);
  const [clientFeedback, setClientFeedback] = useState<ClientFeedback[]>([]);
  const [quarters, setQuarters] = useState<Quarter[]>([]);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [month, setMonth] = useState(bangkokMonthKey());
  const [quarter, setQuarter] = useState("");
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  // Form states
  const [form, setForm] = useState({ employee_name: "", points: "", reason: "" });
  const [formErr, setFormErr] = useState("");
  const [appealTarget, setAppealTarget] = useState<PointsRecord | null>(null);
  const [appealReason, setAppealReason] = useState("");

  // Peer vote
  const [voteNominee, setVoteNominee] = useState("");
  const [voteReason, setVoteReason] = useState("");
  const [hasVoted, setHasVoted] = useState(false);
  const [voteMsg, setVoteMsg] = useState("");

  // 独立加载员工列表（不依赖 points API 返回）
  useEffect(() => {
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const empList = (Array.isArray(data) ? data : []).map((e: any) => ({ id: e.id, name: e.name, role: e.role }));
        if (empList.length > 0) setEmployees(empList);
      })
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      let url = `/api/internal/points?month=${month}`;
      if (quarter) url += `&quarter=${encodeURIComponent(quarter)}`;
      if (filterEmployee) url += `&employee=${encodeURIComponent(filterEmployee)}`;
      const res = await fetchWithAuth(url, { cache: "no-store" });
      const data = await res.json();
      setRankings(data.rankings || []);
      setSalesRanking(data.salesRanking || []);
      setRecords(data.records || []);
      // employees 由独立 useEffect 加载，不从 points API 取
      setAppeals(data.appeals || []);
      setPeerVotes(data.peerVotes || []);
      setClientFeedback(data.clientFeedback || []);
      setQuarters(data.quarters || []);
      // hasVoted no longer checked (unlimited votes)
    } catch (e) { console.error("[奖惩] 加载失败", e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [month, filterEmployee, quarter]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      await fetchWithAuth(`/api/internal/points?month=${month}&refresh=1`, { cache: "no-store" });
      load();
    } catch (e) { console.error("[奖惩] 刷新失败", e); }
    setComputing(false);
  };

  const handleSubmit = async () => {
    const pts = Number(form.points);
    if (!form.employee_name || !pts || !form.reason.trim()) { setFormErr("请填写完整信息"); return; }
    setFormErr("");
    try {
      await fetchWithAuth("/api/internal/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee_name: form.employee_name, points: pts, reason: form.reason }) });
      setForm({ employee_name: "", points: "", reason: "" });
      load();
    } catch { setFormErr("提交失败"); }
  };

  const handleUndo = async (id: number) => {
    if (!confirm("确定撤销这条积分记录吗？撤销后对应分数将从总分中扣除，排名也会更新。")) return;
    await fetchWithAuth("/api/internal/points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "undo", id }) });
    load();
  };

  const handleRestore = async (id: number) => {
    if (!confirm("确定恢复这条已撤销的积分记录吗？分数将重新加到总分中。")) return;
    await fetchWithAuth("/api/internal/points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", id }) });
    load();
  };

  const handleAppeal = async () => {
    if (!appealTarget || !appealReason.trim()) return;
    await fetchWithAuth("/api/internal/points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "appeal", id: appealTarget.id, reason: appealReason }) });
    setAppealTarget(null); setAppealReason(""); load();
  };

  const handleApproveAppeal = async (id: number) => {
    await fetchWithAuth("/api/internal/points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approve_appeal", id }) });
    load();
  };

  const handleRejectAppeal = async (id: number) => {
    await fetchWithAuth("/api/internal/points", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reject_appeal", id }) });
    load();
  };

  const handlePeerVote = async () => {
    if (!voteNominee) { setVoteMsg("请选择同事"); return; }
    setVoteMsg("");
    const res = await fetchWithAuth("/api/internal/points", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "peer_vote", nominee: voteNominee, reason: voteReason }) });
    const d = await res.json();
    if (d.error) { setVoteMsg(d.error); return; }
    setVoteNominee(""); setVoteReason("");
    load();
  };

  const rankMedal = (idx: number) => {
    if (idx === 0) return <Crown className="size-4 text-amber-500" />;
    if (idx === 1) return <Medal className="size-4 text-slate-400" />;
    if (idx === 2) return <Medal className="size-4 text-amber-700" />;
    return <span className="text-xs text-[var(--muted-foreground)] w-4 text-center">{idx + 1}</span>;
  };

  const title = quarter ? `奖惩制度 · ${quarter}` : `奖惩制度 · ${month}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight">奖惩制度</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{quarter ? `季度排名: ${quarter}` : "积分排名与奖惩记录"}</p>
        </div>
        <div className="flex items-center gap-3">
          {!quarter && (
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              className="h-9 rounded border border-[var(--border)] px-3 text-sm bg-[var(--background)]" />
          )}
          {quarters.length > 0 && (
            <select value={quarter} onChange={e => setQuarter(e.target.value)}
              className="h-9 rounded border border-[var(--border)] px-2 text-sm bg-[var(--background)]">
              <option value="">按月查看</option>
              {quarters.map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
          )}
          {!quarter && (
            <Button size="sm" variant="outline" className="h-9" onClick={handleCompute} disabled={computing}>
              <RefreshCw className={cn("size-3.5 mr-1.5", computing && "animate-spin")} />刷新积分
            </Button>
          )}
        </div>
      </div>

      {/* ── 积分排名榜（仅管理员可见）── */}
      {isAdmin && (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium flex items-center gap-2"><Trophy className="size-4" />积分排名 · {title}</h2>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
        ) : rankings.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无数据，点击右上角刷新积分</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-5 text-left text-xs font-medium w-10">#</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">总积分</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-green-600">加分</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-red-500">扣分</th>
              </tr></thead>
              <tbody>
                {rankings.map((r, idx) => (
                  <tr key={r.name} className={cn("border-b border-[var(--border)]",
                    idx === 0 && "bg-amber-50/30 dark:bg-amber-950/10",
                    idx === 1 && "bg-slate-50/30 dark:bg-slate-950/10",
                    idx === 2 && "bg-orange-50/20 dark:bg-orange-950/10"
                  )}>
                    <td className="py-2.5 px-5">{rankMedal(idx)}</td>
                    <td className={cn("py-2.5 px-4 font-medium", idx < 3 && "font-semibold")}>{r.name}</td>
                    <td className={cn("py-2.5 px-4 text-center font-bold tabular-nums",
                      r.total_points > 0 ? "text-green-600" : r.total_points < 0 ? "text-red-500" : "text-[var(--muted-foreground)]")}>
                      {r.total_points > 0 ? "+" : ""}{r.total_points}
                    </td>
                    <td className="py-2.5 px-4 text-center text-green-600 tabular-nums">+{r.bonus}</td>
                    <td className="py-2.5 px-4 text-center text-red-500 tabular-nums">{r.penalty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── 销售排行 ── */}
      {isAdmin && (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium flex items-center gap-2"><TrendingUp className="size-4" />销售积分排行 · {title}</h2>
        </div>
        {salesRanking.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无销售积分数据，录入客户并跟进后显示</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-5 text-left text-xs font-medium w-10">#</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">销售积分</th>
              </tr></thead>
              <tbody>
                {salesRanking.slice(0, 20).map((r, idx) => (
                  <tr key={r.name} className={cn("border-b border-[var(--border)]",
                    idx === 0 && "bg-amber-50/30 dark:bg-amber-950/10",
                    idx === 1 && "bg-slate-50/30 dark:bg-slate-950/10",
                    idx === 2 && "bg-orange-50/20 dark:bg-orange-950/10"
                  )}>
                    <td className="py-2.5 px-5">{rankMedal(idx)}</td>
                    <td className={cn("py-2.5 px-4 font-medium", idx < 3 && "font-semibold")}>{r.name}</td>
                    <td className="py-2.5 px-4 text-center font-bold text-green-600 tabular-nums">+{r.total_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── 同事互评 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium flex items-center gap-2"><Heart className="size-4" />同事互评</h2>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium">点赞对象</label>
                <select value={voteNominee} onChange={e => setVoteNominee(e.target.value)}
                  className="mt-1 h-9 rounded border border-[var(--border)] px-3 text-sm min-w-[120px]">
                  <option value="">选择同事</option>
                  {employees.filter(e => e.name !== user?.name).map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">点赞理由 <span className="text-red-500">*</span></label>
                <input value={voteReason} onChange={e => setVoteReason(e.target.value)} placeholder="Ta 哪里做得好，必填..."
                  className="mt-1 h-9 rounded border border-[var(--border)] px-3 text-sm w-64" />
              </div>
              <Button size="sm" onClick={handlePeerVote} disabled={!voteReason.trim()}><Heart className="size-3.5 mr-1" />送出点赞 (+2分)</Button>
              {voteMsg && <span className="text-xs text-red-500 ml-2">{voteMsg}</span>}
            </div>

          {peerVotes.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-4">
              <h3 className="text-xs font-medium text-[var(--muted-foreground)] mb-2">{isAdmin ? "完整投票记录" : "收到的赞"} ({peerVotes.length})</h3>
              <div className="space-y-1.5">
                {peerVotes.map(v => (
                  <div key={v.id} className="flex items-center gap-2 text-sm">
                    {isAdmin && <span className="font-medium">{v.voter}</span>}
                    {isAdmin && <span className="text-[var(--muted-foreground)]">→</span>}
                    <span className="font-medium text-green-600">{v.nominee}</span>
                    {v.reason && <span className="text-xs text-[var(--muted-foreground)]">— {v.reason}</span>}
                    {!isAdmin && (v as any).anonymous && <span className="text-xs text-[var(--muted-foreground)]/50">（来自同事）</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 申诉列表（管理员） ── */}
      {isAdmin && appeals.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><AlertCircle className="size-4 text-amber-500" />申诉待处理 · {appeals.length} 条</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">原记录</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">申诉理由</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">操作</th>
              </tr></thead>
              <tbody>
                {appeals.map(a => (
                  <tr key={a.id} className="border-b border-[var(--border)]">
                    <td className="py-2.5 px-4 font-medium">{a.employee_name}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{a.reason}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{a.appeal_reason}</td>
                    <td className="py-2.5 px-4 text-center flex gap-1.5 justify-center">
                      <Button size="sm" className="h-6 text-xs bg-green-500 hover:bg-green-600" onClick={() => handleApproveAppeal(a.id)}>通过</Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs text-red-500" onClick={() => handleRejectAppeal(a.id)}>驳回</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 积分变动记录 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><TrendingUp className="size-4" />积分变动记录</h2>
          {isAdmin && (
            <select value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}
              className="h-8 rounded border border-[var(--border)] px-2 text-xs">
              <option value="">全部员工</option>
              {employees.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
            </select>
          )}
        </div>
        {records.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无记录</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                {isAdmin && <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>}
                <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">积分</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">时间</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">操作</th>
              </tr></thead>
              <tbody>
                {records.map(r => {
                  const tagClass = (() => {
                    if (r.status === "已撤销") return "line-through opacity-40";
                    if (r.status === "已救回") return "bg-green-50/30 dark:bg-green-950/10";
                    return "";
                  })();
                  const badges: string[] = [];
                  if (r.is_manual === 1) badges.push("手动");
                  if (r.status === "已救回") badges.push("已救回");
                  if (r.status === "已撤销") badges.push("已撤销");
                  if (r.rule_key === "peer_vote") badges.push("互评");
                  if (r.rule_key === "client_feedback") badges.push("客户反馈");
                  if (r.is_appealed === 1 && r.appeal_status === "申诉中") badges.push("申诉中");
                  if (r.appeal_status === "已驳回") badges.push("申诉已驳回");
                  if (r.status === "已撤销" && r.undone_by) badges.push(`${r.undone_by} 于 ${(r.undone_at || '').slice(0, 16)} 撤销`);

                  return (
                    <tr key={r.id} className={cn("border-b border-[var(--border)]", tagClass)}>
                      {isAdmin && <td className="py-2.5 px-4 font-medium">{r.employee_name}</td>}
                      <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-w-xs truncate">
                        {r.reason}
                        {badges.map(b => {
                          const c = b === "已救回" || b === "互评" ? "text-green-600" :
                                    b === "已撤销" ? "text-red-400" :
                                    b === "客户反馈" ? "text-blue-500" :
                                    b === "申诉中" ? "text-amber-500" : "text-blue-500";
                          return <span key={b} className={cn("ml-1.5 text-xs", c)}>[{b}]</span>;
                        })}
                      </td>
                      <td className={cn("py-2.5 px-4 text-center font-semibold tabular-nums", r.points > 0 ? "text-green-600" : "text-red-500")}>
                        {r.points > 0 ? "+" : ""}{r.points}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{r.created_at?.slice(0, 16)}</td>
                      <td className="py-2.5 px-4 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          {!isAdmin && r.is_manual === 0 && r.points < 0 && r.is_appealed === 0 && r.status === "有效" && (
                            <button onClick={() => { setAppealTarget(r); setAppealReason(""); }}
                              className="text-amber-500 hover:text-amber-700 text-xs flex items-center gap-0.5">
                              <MessageSquare className="size-3" />申诉
                            </button>
                          )}
                          {/* 管理员撤销/恢复 */}
                          {isAdmin && r.status !== "已撤销" && (
                            <button onClick={() => handleUndo(r.id)} className="text-red-400 hover:text-red-700 text-xs border border-red-200 rounded px-2 py-0.5"
                              title="撤销此积分记录">撤销</button>
                          )}
                          {isAdmin && r.status === "已撤销" && (
                            <button onClick={() => handleRestore(r.id)} className="text-green-500 hover:text-green-700 text-xs border border-green-200 rounded px-2 py-0.5"
                              title="恢复此积分记录">恢复</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 客户反馈记录 ── */}
      {clientFeedback.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><ThumbsUp className="size-4" />客户反馈记录</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-4 text-left text-xs font-medium">订单</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">负责人</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">综合</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">态度</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">速度</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium">专业</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">意见</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">时间</th>
              </tr></thead>
              <tbody>
                {clientFeedback.map(fb => (
                  <tr key={fb.id} className="border-b border-[var(--border)]">
                    <td className="py-2.5 px-4 font-mono text-xs"><Link href={"/orders/" + fb.order_id} className="text-blue-600 hover:underline">{fb.order_id}</Link></td>
                    <td className="py-2.5 px-4">{fb.responsible_person}</td>
                    <td className="py-2.5 px-4 text-center">
                      <Stars n={fb.overall} />
                    </td>
                    <td className="py-2.5 px-4 text-center"><Stars n={fb.attitude} /></td>
                    <td className="py-2.5 px-4 text-center"><Stars n={fb.speed} /></td>
                    <td className="py-2.5 px-4 text-center"><Stars n={fb.professionalism} /></td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)] max-w-[150px] truncate">{fb.comment || "—"}</td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{fb.created_at?.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 老板手动奖惩 ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]"><h2 className="text-sm font-medium">手动奖惩</h2></div>
          <div className="p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium">员工</label>
                <select value={form.employee_name} onChange={e => setForm(p => ({ ...p, employee_name: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="">选择员工</option>
                  {employees.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">积分（正加分，负扣分）</label>
                <input type="number" value={form.points} onChange={e => setForm(p => ({ ...p, points: e.target.value }))}
                  placeholder="如 +5 或 -3" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">原因</label>
                <input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                  placeholder="奖惩原因..." className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
            </div>
            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-3"><Button size="sm" onClick={handleSubmit}>提交记录</Button></div>
          </div>
        </div>
      )}

      {/* ── 申诉弹窗 ── */}
      {appealTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAppealTarget(null)}>
          <div className="bg-[var(--background)] rounded-xl shadow-2xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-medium">申诉扣分</h2>
              <button onClick={() => setAppealTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">扣分记录：</p>
                <p className="text-sm font-medium mt-1">{appealTarget.reason}</p>
                <p className="text-xs text-red-500 mt-0.5">{appealTarget.points} 分</p>
              </div>
              <div>
                <label className="text-xs font-medium">申诉理由</label>
                <textarea value={appealReason} onChange={e => setAppealReason(e.target.value)} placeholder="填写申诉理由..." rows={3}
                  className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm resize-none" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAppeal} disabled={!appealReason.trim()}>提交申诉</Button>
                <Button variant="ghost" size="sm" onClick={() => setAppealTarget(null)}>取消</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
