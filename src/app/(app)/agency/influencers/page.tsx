"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, ExternalLink, ListTodo, ClipboardCheck, Star, Upload, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

const statusClass: Record<string, string> = {
  "待评估": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  "评估中": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  "已评估": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  "已推荐给老板": "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  "已联系": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  "签约中": "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  "已签约": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  "品牌孵化中": "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  "已完成": "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
  "已停止": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "已入池": "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
};

const ratingBadge = (r: string) => {
  const base = r?.replace("+", "");
  const map: Record<string, string> = { A: "bg-emerald-500", B: "bg-blue-500", C: "bg-amber-500", D: "bg-red-500" };
  return map[base] || "bg-slate-400";
};
const ratingColors: Record<string, string> = {
  A: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  D: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const tabs = [
  { key: "discovery", label: "达人发现" },
  { key: "evaluating", label: "待评估" },
  { key: "evaluated", label: "待推荐" },
  { key: "recommended", label: "老板推荐" },
];

interface Influencer {
  id: number; name: string; tiktok_link: string; category: string;
  contact: string; contact_phone: string; followers: string;
  avg_views: string; gmv_range: string; notes: string;
  code: string; status: string; phase: string; monthly_gmv: string; live_stream_ratio: string;
  latest_rating: string | null; created_at: string;
}

export default function InfluencersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("discovery");

  // Evaluation modal
  const [evalModal, setEvalModal] = useState<Influencer | null>(null);
  const [evalForm, setEvalForm] = useState({
    gmv: "", gmv_amount: "", gmv_tier: "",
    live_duration_tier: "", live_frequency_tier: "",
    professionalism_tier: "", liveRatio: "", notes: ""
  });
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalError, setEvalError] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);

  // Rating filter for 待推荐 tab
  const [ratingFilter, setRatingFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let url: string;
      if (activeTab === "evaluating") {
        url = "/api/influencers?status=评估中";
      } else if (activeTab === "evaluated") {
        url = "/api/influencers?status=已评估,已推荐给老板";
      } else if (activeTab === "recommended") {
        url = "/api/influencers?status=已推荐给老板";
      } else {
        url = `/api/influencers?phase=${activeTab}`;
      }
      const res = await fetchWithAuth(url, { cache: "no-store" });
      setInfluencers(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [activeTab]);


// 评估评分规则
const GMV_TIER_LABELS = [
  { value: ">30万", label: ">30万泰铢", score: 29 },
  { value: "20-30万", label: "20-30万泰铢", score: 25 },
  { value: "10-20万", label: "10-20万泰铢", score: 19 },
  { value: "5-10万", label: "5-10万泰铢", score: 11 },
  { value: "<5万", label: "<5万泰铢 → 直接C级", score: 0 },
];
const DURATION_TIERS = [
  { value: ">3小时", label: ">3小时", score: 14 },
  { value: "2-3小时", label: "2-3小时", score: 11 },
  { value: "1-2小时", label: "1-2小时", score: 8 },
  { value: "<1小时", label: "<1小时", score: 5 },
];
const FREQUENCY_TIERS = [
  { value: ">5次/周", label: ">5次/周", score: 14 },
  { value: "4-5次/周", label: "4-5次/周", score: 11 },
  { value: "2-3次/周", label: "2-3次/周", score: 8 },
  { value: "<2次/周", label: "<2次/周", score: 5 },
];
const PROF_TIERS = [
  { value: "高", label: "内容质量高，配合度好", score: 5 },
  { value: "中", label: "表现中等，需要培养", score: 3 },
  { value: "低", label: "质量较低，配合度差", score: 1 },
];

function findScore(tiers: {value:string,score:number}[], val: string) { return tiers.find(t => t.value === val)?.score || 0; }
function getTotalScore() {
  return findScore(GMV_TIER_LABELS, evalForm.gmv_tier) +
    findScore(DURATION_TIERS, evalForm.live_duration_tier) +
    findScore(FREQUENCY_TIERS, evalForm.live_frequency_tier) +
    findScore(PROF_TIERS, evalForm.professionalism_tier);
}
function getPreviewGrade() {
  const s = getTotalScore();
  if (evalForm.gmv_tier === "<5万") return "C";
  let g = s >= 50 ? "A" : s >= 20 ? "B" : "C";
  const ratio = parseInt(evalForm.liveRatio?.replace(/%/g, "")) || 0;
  if (ratio >= 50) g += "+";
  return g;
}

  useEffect(() => { load(); }, [load]);

  // ── Evaluation submission ──
  const handleStartEval = (inf: Influencer) => {
    setEvalModal(inf);
    setEvalForm({ gmv: inf.monthly_gmv || "", gmv_amount: "", gmv_tier: "", live_duration_tier: "", live_frequency_tier: "", professionalism_tier: "", liveRatio: inf.live_stream_ratio || "", notes: "" });
    setEvalError("");
  };

  const handleSaveEval = async () => {
    if (!evalModal) return;
    setEvalSaving(true);
    setEvalError("");
    try {
      // 评估前先确认各维度都已选择
      const res = await fetchWithAuth("/api/influencers/evaluations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          influencer_id: evalModal.id,
          gmv: evalForm.gmv,
          gmv_amount: evalForm.gmv_amount,
          gmv_tier: evalForm.gmv_tier,
          live_duration_tier: evalForm.live_duration_tier,
          live_frequency_tier: evalForm.live_frequency_tier,
          professionalism_tier: evalForm.professionalism_tier,
          live_stream_ratio: evalForm.liveRatio,
          notes: evalForm.notes,
          evaluated_by: user?.name || "Ploy",
        }),
      });
      if (!res.ok) throw new Error("保存评估失败");

      await fetchWithAuth("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: evalModal.id, status: "已评估" }),
      });

      setEvalModal(null);
      load();
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "保存失败");
    } finally { setEvalSaving(false); }
  };

  // ── CSV import ──
  const handleCsvImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetchWithAuth("/api/influencers/evaluations/import", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        alert(`导入完成: ${data.imported} 条成功${data.skipped?.length ? `, ${data.skipped.length} 条跳过` : ""}`);
        load();
      } else {
        alert("导入失败: " + (data.error || "未知错误"));
      }
    } catch (err) {
      alert("导入失败: " + (err instanceof Error ? err.message : "网络错误"));
    }
  };

  // ── Recommend to boss ──
  const handleRecommend = async (infId: number) => {
    if (!confirm("确认推荐给老板？")) return;
    try {
      await fetchWithAuth("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: infId, status: "已推荐给老板" }),
      });
      load();
    } catch (err) { console.error(err); }
  };

  const filtered = influencers.filter(i => {
    if (ratingFilter !== "all" && (i.latest_rating || "").replace("+", "") !== ratingFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s) || (i.contact || "").toLowerCase().includes(s) || (i.code || "").toLowerCase().includes(s);
  });

  const getDisplayStatus = (inf: Influencer) => {
    if (inf.status === "评估中" && activeTab === "evaluating") return "待评估";
    if (inf.phase === "completed_discovery") return "已入池";
    return inf.status;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">达人发现</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              共 {influencers.length} 位达人
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agency/influencers/tasks">
            <Button size="sm"><ListTodo className="size-3.5" />添加任务</Button>
          </Link>
          {activeTab === "evaluating" && (
            <Button size="sm" variant="outline" onClick={() => csvRef.current?.click()}>
              <Upload className="size-3.5" />导入CSV
            </Button>
          )}
          <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={handleCsvImport} />
        </div>
      </div>

      {/* Phase tabs */}
      <div className="flex gap-1 rounded-lg bg-[var(--secondary)] p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setSearch(""); setRatingFilter("all"); }}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              activeTab === tab.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {tab.key === "evaluated" && <Star className="size-3.5 inline mr-1.5" />}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input placeholder="搜索名称、品类、编号..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
        </div>
        {activeTab === "evaluated" && (
          <div className="flex rounded-lg bg-[var(--secondary)] p-0.5">
            {[{ k: "all", l: "全部" }, { k: "A", l: "A / A+" }, { k: "B", l: "B / B+" }, { k: "C", l: "C / C+" }].map(r => (
              <button key={r.k} onClick={() => setRatingFilter(r.k)}
                className={cn("px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  ratingFilter === r.k ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                {r.l}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">编号</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">品类</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">粉丝量</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">GMV区间</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">联系方式</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
                {(activeTab === "evaluating" || activeTab === "evaluated" || activeTab === "recommended") && (
                  <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map(inf => (
                <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/agency/influencers/${inf.id}`} className="flex items-center gap-2 hover:underline">
                      <span className="font-medium text-[var(--foreground)]">{inf.name}</span>
                      {inf.latest_rating && (
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white ${ratingBadge(inf.latest_rating)}`}>
                          {inf.latest_rating}
                        </span>
                      )}
                    </Link>
                    {inf.tiktok_link && (
                      <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer" className="inline-flex text-[var(--muted-foreground)] hover:text-[var(--primary)] ml-1" onClick={e => e.stopPropagation()}>
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.code || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.followers || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.gmv_range || inf.monthly_gmv || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">
                    {inf.contact ? `${inf.contact}${inf.contact_phone ? ` / ${inf.contact_phone}` : ""}` : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[getDisplayStatus(inf)] || statusClass["待评估"])}>
                      {getDisplayStatus(inf)}
                    </span>
                  </td>
                  {(activeTab === "evaluating" || activeTab === "evaluated" || activeTab === "recommended") && (
                    <td className="py-3 px-4">
                      {activeTab === "evaluating" && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleStartEval(inf)}>
                          <ClipboardCheck className="size-3" />开始评估
                        </Button>
                      )}
                      {activeTab === "evaluated" && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => handleRecommend(inf.id)}>
                          <Star className="size-3" />推荐给老板
                        </Button>
                      )}
                      {activeTab === "recommended" && (
                        <Link href={`/agency/influencers/${inf.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            查看详情
                          </Button>
                        </Link>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              {activeTab === "discovery" ? "暂无发现阶段的达人" : activeTab === "evaluating" ? "暂无待评估的达人" : activeTab === "evaluated" ? "暂无已评估的达人" : "暂无待老板确认的达人"}
            </div>
          )}
        </div>
      )}

      {/* Evaluation Modal */}
      {evalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setEvalModal(null)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-[var(--foreground)]">
                <ClipboardCheck className="size-5 inline mr-2 text-blue-500" />
                评估 {evalModal.name}
              </h3>
              <span className="text-xs text-[var(--muted-foreground)]">{evalModal.category || ""}</span>
            </div>

            {evalError && <div className="mb-4 text-sm text-[var(--destructive)] rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2">{evalError}</div>}

            <div className="flex flex-col gap-4">
              {/* 维度一：月度 GMV（30分） */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">月度 GMV <span className="text-xs text-[var(--muted-foreground)]">（满分 30 分）</span></label>
                  {evalForm.gmv_tier && (
                    <span className="text-xs font-semibold text-[var(--primary)]">{findScore(GMV_TIER_LABELS, evalForm.gmv_tier)} 分</span>
                  )}
                </div>
                <select value={evalForm.gmv_tier} onChange={e => setEvalForm(p => ({ ...p, gmv_tier: e.target.value }))}
                  className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="">请选择 GMV 档位</option>
                  {GMV_TIER_LABELS.map(t => <option key={t.value} value={t.value}>{t.label} — {t.score}分</option>)}
                </select>
              </div>

              {/* 维度二：平均直播时长（15分） */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">平均直播时长 <span className="text-xs text-[var(--muted-foreground)]">（满分 15 分）</span></label>
                  {evalForm.live_duration_tier && (
                    <span className="text-xs font-semibold text-[var(--primary)]">{findScore(DURATION_TIERS, evalForm.live_duration_tier)} 分</span>
                  )}
                </div>
                <select value={evalForm.live_duration_tier} onChange={e => setEvalForm(p => ({ ...p, live_duration_tier: e.target.value }))}
                  className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="">请选择时长档位</option>
                  {DURATION_TIERS.map(t => <option key={t.value} value={t.value}>{t.label} — {t.score}分</option>)}
                </select>
              </div>

              {/* 维度三：直播频率（15分） */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">直播频率 <span className="text-xs text-[var(--muted-foreground)]">（满分 15 分）</span></label>
                  {evalForm.live_frequency_tier && (
                    <span className="text-xs font-semibold text-[var(--primary)]">{findScore(FREQUENCY_TIERS, evalForm.live_frequency_tier)} 分</span>
                  )}
                </div>
                <select value={evalForm.live_frequency_tier} onChange={e => setEvalForm(p => ({ ...p, live_frequency_tier: e.target.value }))}
                  className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="">请选择频率档位</option>
                  {FREQUENCY_TIERS.map(t => <option key={t.value} value={t.value}>{t.label} — {t.score}分</option>)}
                </select>
              </div>

              {/* 维度四：创作者专业度（5分） */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">创作者专业度 <span className="text-xs text-[var(--muted-foreground)]">（满分 5 分）</span></label>
                  {evalForm.professionalism_tier && (
                    <span className="text-xs font-semibold text-[var(--primary)]">{findScore(PROF_TIERS, evalForm.professionalism_tier)} 分</span>
                  )}
                </div>
                <select value={evalForm.professionalism_tier} onChange={e => setEvalForm(p => ({ ...p, professionalism_tier: e.target.value }))}
                  className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="">请选择专业度档位</option>
                  {PROF_TIERS.map(t => <option key={t.value} value={t.value}>{t.label} — {t.score}分</option>)}
                </select>
              </div>

              {/* 加分项：直播 GMV 占比 */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">直播间 GMV 占比 <span className="text-xs text-[var(--muted-foreground)]">（≥50% 评级+加号）</span></label>
                  <span className="text-xs text-[var(--muted-foreground)]">加分规则</span>
                </div>
                <input value={evalForm.liveRatio} onChange={e => setEvalForm(p => ({ ...p, liveRatio: e.target.value }))}
                  placeholder="例如: 70%"
                  className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              {/* 实时总分 + 等级预览 */}
              {(evalForm.gmv_tier || evalForm.live_duration_tier || evalForm.live_frequency_tier || evalForm.professionalism_tier) && (
                <div className="flex items-center justify-between rounded-lg bg-[var(--secondary)] px-4 py-3">
                  <div>
                    <span className="text-xs text-[var(--muted-foreground)]">总分</span>
                    <p className="text-lg font-semibold tabular-nums text-[var(--foreground)]">{getTotalScore()} / 65</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-[var(--muted-foreground)]">预计等级</span>
                    <p className={`text-lg font-bold ${getPreviewGrade().startsWith("A") ? "text-emerald-600" : getPreviewGrade().startsWith("B") ? "text-blue-600" : "text-amber-600"}`}>
                      {getPreviewGrade()}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-medium">备注</label>
                <textarea value={evalForm.notes} onChange={e => setEvalForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="补充说明..." rows={2}
                  className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEvalModal(null)}>取消</Button>
              <Button size="sm" onClick={handleSaveEval} disabled={evalSaving}>
                {evalSaving ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                保存评估
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
