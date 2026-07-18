"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchWithAuth } from "@/lib/api";
import { bangkokDateStr } from "@/lib/time";
import { useAuth } from "@/components/auth-provider";
import { Search, FileText, Clock, AlertCircle, Play, ArrowLeft, FileEdit, ExternalLink, Download, Trash2, RotateCcw, Trash, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { startPhase } from "@/lib/api";

const payClass: Record<string, string> = {
  "未付": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "部分付": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  "已付": "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};

interface Contract {
  id: number;
  influencer_id: number;
  influencer_name: string;
  influencer_code: string;
  influencer_category: string;
  influencer_followers: string;
  influencer_phone: string;
  influencer_line: string;
  influencer_status: string;
  influencer_phase: string;
  influencer_created_by?: string;
  latest_gmv: string;
  base_salary: string;
  commission: string;
  live_sessions: string;
  live_duration: string;
  video_count: string;
  contract_url: string;
  file_count: number;
  payment_status: string;
  start_date: string;
  end_date: string;
  notes: string;
  created_at: string;
  deleted?: number;
  deleted_at?: string;
  deleted_by?: string;
}

interface Influencer {
  id: number; name: string; phase: string; status: string; category: string;
  tiktok_link: string; followers: string; created_at: string;
  code: string; contact_phone: string; line_id: string; monthly_gmv: string;
  latest_rating: string | null;
  notes?: string;
}


function getPhaseLabel(phase: string): string {
  const map: Record<string, string> = {
    discovery: "达人发现", completed_discovery: "待签约",
    contract: "签约中", completed_contract: "已完成",
    incubation: "品牌孵化中", completed_incubation: "已完成孵化",
  };
  return map[phase] || phase;
}


function getGmvDisplay(inf: any): string {
  return inf.monthly_gmv || inf.latest_gmv || "-";
}

function getOverdueLabel(createdAt: string): { label: string; cls: string } | null {
  if (!createdAt) return null;
  const created = new Date(createdAt + "Z");
  const now = new Date();
  const days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  if (days >= 5) return { label: "已超时", cls: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" };
  if (days >= 2) return { label: "需跟进", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" };
  return null;
}

function getOverdueRowClass(createdAt: string, paymentStatus: string): string {
  if (paymentStatus === "已付") return "";
  const overdue = getOverdueLabel(createdAt);
  if (!overdue) return "";
  if (overdue.label === "已超时") return "bg-red-50/50 dark:bg-red-950/20";
  return "bg-amber-50/50 dark:bg-amber-950/20";
}

export default function ContractsPage() {
  const router = useRouter();
  const { user, token } = useAuth();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [poolInfs, setPoolInfs] = useState<Influencer[]>([]);
  const [activeInfs, setActiveInfs] = useState<Influencer[]>([]);
  const [completedInfs, setCompletedInfs] = useState<Influencer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [trashContracts, setTrashContracts] = useState<Contract[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [nosignInfs, setNosignInfs] = useState<Influencer[]>([]);
  const [showNosign, setShowNosign] = useState(false);
  const [nosignModal, setNosignModal] = useState<Influencer | null>(null);
  const [nosignReason, setNosignReason] = useState("");
  const [nosignSaving, setNosignSaving] = useState(false);
  const [startingPhases, setStartingPhases] = useState<Record<number, boolean>>({});
  const [contractModal, setContractModal] = useState<{ influencer: Influencer } | null>(null);
  const [contractForm, setContractForm] = useState({ base_salary: "", commission: "", live_sessions: "", live_duration: "", video_count: "" });
  const [contractFormError, setContractFormError] = useState("");
  const searchParams = useSearchParams();
  const overdueFilter = searchParams.get("overdue");

  const load = async () => {
    // token 没就绪时不发请求，等 useAuth 初始化完
    if (!token) return;
    try {
      const [cr, ir] = await Promise.all([
        fetchWithAuth("/api/contracts", { cache: "no-store" }),
        fetchWithAuth("/api/influencers?phase=contract", { cache: "no-store" }),
      ]);
      const [cd, allInfs] = await Promise.all([cr.json(), ir.json()]);
      setContracts(Array.isArray(cd) ? cd : []);
      const infs = Array.isArray(allInfs) ? allInfs : [];
      setPoolInfs(infs.filter((i: Influencer) => i.phase === "completed_discovery"));
      // 签约中：排除已有合同的达人（合同已在合同列表中显示）
      const contractIds = new Set((Array.isArray(cd) ? cd : []).map((c: Contract) => c.influencer_id));
      setActiveInfs(infs.filter((i: Influencer) => i.phase === "contract" && !contractIds.has(i.id)));
      setCompletedInfs(infs.filter((i: Influencer) => i.phase === "completed_contract"));
      // 不签约的达人（已入池但被取消的）
      setNosignInfs(infs.filter((i: Influencer) => i.phase === "completed_discovery" && i.status === "不签约"));
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [token]);

  const loadTrash = async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth("/api/contracts?trash=1", { cache: "no-store" });
      const data = await res.json();
      setTrashContracts(Array.isArray(data) ? data : []);
    } catch (e) { console.error("加载回收站失败", e); }
  };

  const handleSoftDelete = async (c: Contract) => {
    if (!confirm(`确认将「${c.influencer_name}」的合同移入回收站？`)) return;
    try {
      await fetchWithAuth(`/api/contracts?id=${c.id}`, { method: "DELETE" });
      load();
    } catch (e) { console.error("删除合同失败", e); }
  };

  const handleRestore = async (c: Contract) => {
    if (!confirm(`确认恢复「${c.influencer_name}」的合同？`)) return;
    try {
      await fetchWithAuth("/api/contracts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, restore: true }),
      });
      load();
      loadTrash();
    } catch (e) { console.error("恢复合同失败", e); }
  };

  const handlePermanentDelete = async (c: Contract) => {
    if (!confirm(`⚠️ 彻底删除「${c.influencer_name}」的合同？

此操作不可撤销，数据无法恢复。`)) return;
    try {
      await fetchWithAuth(`/api/contracts?id=${c.id}&permanent=1`, { method: "DELETE" });
      loadTrash();
    } catch (e) { console.error("彻底删除合同失败", e); }
  };

  // 从签约已完成列表删除（按 influencer_id 找到对应合同再软删除）
  const handleDeleteCompleted = async (inf: Influencer) => {
    if (!confirm(`确认将「${inf.name}」的合同移入回收站？`)) return;
    try {
      // 查找该达人对应的合同
      const res = await fetchWithAuth(`/api/contracts?trash=0`, { cache: "no-store" });
      const data = await res.json();
      const allContracts: Contract[] = Array.isArray(data) ? data : [];
      const contract = allContracts.find((c: Contract) => c.influencer_id === inf.id);
      if (!contract) { alert("未找到对应合同记录，可能已被删除"); return; }
      await fetchWithAuth(`/api/contracts?id=${contract.id}`, { method: "DELETE" });
      // 立即从列表中移除，避免重复 load 时仍显示
      setCompletedInfs(prev => prev.filter(i => i.id !== inf.id));
      setContracts(prev => prev.filter(c => c.id !== contract.id));
      loadTrash();
    } catch (e) { console.error("删除已完成合同失败", e); alert("删除失败，请重试"); }
  };

  const handleNosign = async () => {
    if (!nosignModal || !nosignReason.trim()) { alert("请填写不签约的原因"); return; }
    setNosignSaving(true);
    try {
      const cancelNote = "不签约原因: " + nosignReason.trim() + " (" + new Date(Date.now() + 7*60*60*1000).toLocaleString("th-TH") + ")";
      const getRes = await fetchWithAuth("/api/influencers/" + nosignModal.id, { cache: "no-store" });
      const inf = getRes.ok ? await getRes.json() : { notes: "" };
      const prevNotes = inf.notes || "";
      const mergedNotes = prevNotes ? prevNotes + "\n" + cancelNote : cancelNote;
      await fetchWithAuth("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: nosignModal.id, status: "不签约", phase: "completed_discovery", notes: mergedNotes }),
      });
      setNosignModal(null);
      setNosignReason("");
      load();
    } catch (err) { console.error("不签约操作失败", err); alert("操作失败"); }
    setNosignSaving(false);
  };

  const handleRestoreNosign = async (inf: Influencer) => {
    if (!confirm(`确认恢复「${inf.name}」回签约中？`)) return;
    try {
      await fetchWithAuth("/api/influencers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inf.id, status: "已入池", notes: inf.notes }),
      });
      load();
    } catch (e) { console.error("恢复失败", e); }
  };

  const openContractForm = (inf: Influencer) => {
    setContractModal({ influencer: inf });
    setContractForm({ base_salary: "", commission: "", live_sessions: "", live_duration: "", video_count: "" });
    setContractFormError("");
  };

  const handleSubmitContract = async () => {
    if (!contractModal) return;
    const { live_sessions, live_duration, video_count } = contractForm;
    if (!live_sessions.trim() || !live_duration.trim() || !video_count.trim()) {
      setContractFormError("月直播场次、每次直播时长、月视频数量为必填项");
      return;
    }
    setContractFormError("");
    const infId = contractModal.influencer.id;
    setStartingPhases(p => ({ ...p, [infId]: true }));
    try {
      await startPhase(infId, "contract");
      await fetchWithAuth("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          influencer_id: infId,
          base_salary: contractForm.base_salary,
          commission: contractForm.commission,
          live_sessions: contractForm.live_sessions,
          live_duration: contractForm.live_duration,
          video_count: contractForm.video_count,
          created_by: user?.name || "",
        }),
      });
      setContractModal(null);
      load();
    } catch (err) { console.error(err); }
    setStartingPhases(p => ({ ...p, [infId]: false }));
  };

  const paymentCycle: Record<string, string> = { "未付": "部分付", "部分付": "已付", "已付": "未付" };
  const handleTogglePayment = async (contractId: number, currentStatus: string) => {
    const nextStatus = paymentCycle[currentStatus] || "未付";
    try {
      await fetchWithAuth("/api/contracts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: contractId, payment_status: nextStatus }),
      });
      load();
    } catch (err) { console.error(err); }
  };

  const filtered = contracts.filter((c) => {
    if (overdueFilter) {
      const overdue = getOverdueLabel(c.created_at);
      if (!overdue) return false;
      if (overdueFilter === "5" && overdue.label !== "已超时") return false;
      if (overdueFilter === "2" && overdue.label === "已超时") return false;
      if (overdueFilter === "2" && overdue.label !== "需跟进") return false;
    }
    if (!search) return true;
    const s = search.toLowerCase();
    return c.influencer_name?.toLowerCase().includes(s) || c.payment_status.includes(s);
  });

  const filterInf = (list: Influencer[]) => {
    if (!search) return list;
    const s = search.toLowerCase();
    return list.filter(i => i.name.toLowerCase().includes(s) || i.category.toLowerCase().includes(s));
  };

  const overdue2d = contracts.filter(c => getOverdueLabel(c.created_at)?.label === "需跟进").length;
  const overdue5d = contracts.filter(c => getOverdueLabel(c.created_at)?.label === "已超时").length;

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;

  const handleExport = () => {
    const cols: ExportColumn<Contract>[] = [
      { header: "达人编号", render: (r) => r.influencer_code || "—" },
      { header: "达人名称", key: "influencer_name" },
      { header: "底薪", key: "base_salary" },
      { header: "佣金", key: "commission" },
      { header: "月直播场次", key: "live_sessions" },
      { header: "每次直播时长", key: "live_duration" },
      { header: "月视频数量", key: "video_count" },
      { header: "付款状态", key: "payment_status" },
      { header: "创建时间", key: "created_at" },
    ];
    const filtered_ = search
      ? contracts.filter(c => (c.influencer_name || "").toLowerCase().includes(search.toLowerCase()))
      : contracts;
    exportToExcel(filtered_, cols, `合同列表_${bangkokDateStr()}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)] flex items-center gap-2">
              <FileEdit className="size-5 text-blue-500" />签约跟进
            </h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              待签约 {poolInfs.length} 位 · 签约中 {activeInfs.length} 位 · 已完成 {completedInfs.length} 位
              {(overdue2d > 0 || overdue5d > 0) && (
                <span className="ml-2">
                  {overdue5d > 0 && <span className="text-red-500 font-medium">{overdue5d} 个已超时</span>}
                  {overdue5d > 0 && overdue2d > 0 && " · "}
                  {overdue2d > 0 && <span className="text-amber-500 font-medium">{overdue2d} 个需跟进</span>}
                </span>
              )}
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={handleExport}><Download className="size-3.5" />导出</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="搜索达人名称..." value={search} onChange={e => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
      </div>

      {/* 已入池待签约 */}
      {poolInfs.length > 0 && (
        <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-950/10 p-4">
          <h2 className="text-sm font-medium text-teal-700 dark:text-teal-400 mb-3 flex items-center gap-2">
            <Play className="size-3.5" />已入池，待签约 ({poolInfs.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-3 text-left text-xs font-medium">编号</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">达人</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-lg:hidden">品类</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">GMV区间</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">粉丝量</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">电话</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">LINE</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filterInf(poolInfs).map(inf => (
                  <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]">
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] tabular-nums">{inf.code || "-"}</td>
                    <td className="py-2.5 px-3">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline">{inf.name}</Link>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-lg:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{getGmvDisplay(inf)}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.followers || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.contact_phone || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.line_id || "-"}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="h-7 text-xs gap-1"
                          onClick={() => openContractForm(inf)}
                          disabled={startingPhases[inf.id]}>
                          <Play className="size-3" />
                          {startingPhases[inf.id] ? "启动中..." : "开始签约"}
                        </Button>
                        <button onClick={() => { setNosignModal(inf); setNosignReason(""); }} className="text-[var(--muted-foreground)] hover:text-red-500 p-0.5 text-xs inline-flex items-center gap-1" title="不签约">
                          <X className="size-3" />不签约
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 签约中 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">签约中 ({filterInf(activeInfs).length})</h2>
        </div>
        {filterInf(activeInfs).length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无签约中的达人</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-3 text-left text-xs font-medium">编号</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">达人</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-lg:hidden">品类</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">GMV区间</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">粉丝量</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">电话</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">LINE</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {filterInf(activeInfs).map(inf => (
                  <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]">
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] tabular-nums">{inf.code || "-"}</td>
                    <td className="py-2.5 px-3">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline">{inf.name}</Link>
                    </td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-lg:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{getGmvDisplay(inf)}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.followers || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.contact_phone || "-"}</td>
                    <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{inf.line_id || "-"}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">签约中</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 签约已完成 */}
      {completedInfs.length > 0 && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50/20 dark:bg-green-950/10">
          <div className="px-4 py-3 border-b border-green-200 dark:border-green-800">
            <h2 className="text-sm font-medium text-green-700 dark:text-green-400">签约已完成 ({completedInfs.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-green-200 dark:border-green-800">
                  <th className="py-2.5 px-3 text-left text-xs font-medium">编号</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">达人</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-lg:hidden">品类</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">GMV区间</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">粉丝量</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">电话</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">LINE</th>
                  <th className="py-2.5 px-3 text-left text-xs font-medium">状态</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {completedInfs.map(inf => (
                  <tr key={inf.id} className="border-b border-green-200 dark:border-green-800 hover:bg-[var(--secondary)]">
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 tabular-nums">{inf.code || "-"}</td>
                    <td className="py-2.5 px-3">
                      <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline text-green-700 dark:text-green-400">{inf.name}</Link>
                    </td>
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 max-lg:hidden">{inf.category || "-"}</td>
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 max-xl:hidden">{getGmvDisplay(inf)}</td>
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 max-xl:hidden">{inf.followers || "-"}</td>
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 max-xl:hidden">{inf.contact_phone || "-"}</td>
                    <td className="py-2.5 px-3 text-green-700/60 dark:text-green-400/60 max-xl:hidden">{inf.line_id || "-"}</td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-700">已完成</span>
                    </td>
                    <td className="py-2.5 px-2">
                      <button onClick={() => handleDeleteCompleted(inf)} className="text-[var(--muted-foreground)] hover:text-red-500 p-0.5" title="移入回收站">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 合同列表 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-4 py-3 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">合同列表 ({filtered.length})</h2>
        </div>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无合同数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-2 text-left text-xs font-medium">编号</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-xl:hidden">来源</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium">达人</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-xl:hidden">品类</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-xl:hidden">GMV</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-md:hidden">底薪</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-md:hidden">佣金</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-xl:hidden">电话</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-lg:hidden">场次/时长</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-md:hidden">文件</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium max-md:hidden">合同</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium">付款</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium">提醒</th>
                  <th className="py-2.5 px-2 text-left text-xs font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const overdue = getOverdueLabel(c.created_at);
                  const rowClass = getOverdueRowClass(c.created_at, c.payment_status);
                  return (
                  <tr key={c.id} className={cn("border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors", rowClass)}>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] tabular-nums">{c.influencer_code || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] text-xs max-xl:hidden">{c.influencer_created_by || "—"}</td>
                    <td className="py-2.5 px-2">
                      <Link href={`/agency/influencers/${c.influencer_id}`} className="font-medium hover:underline">{c.influencer_name || "-"}</Link>
                    </td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-xl:hidden">{c.influencer_category || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-xl:hidden">{c.latest_gmv || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-md:hidden">{c.base_salary || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-md:hidden">{c.commission || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-xl:hidden">{c.influencer_phone || "-"}</td>
                    <td className="py-2.5 px-2 text-[var(--muted-foreground)] max-lg:hidden">
                      {c.live_sessions ? `${c.live_sessions}场` : "-"}{c.live_duration ? ` / ${c.live_duration}h` : ""}
                    </td>
                    <td className="py-2.5 px-2 max-md:hidden">
                      <span className="tabular-nums">{c.file_count ?? 0}</span>
                    </td>
                    <td className="py-2.5 px-2 max-md:hidden">
                      {c.contract_url ? (
                        <a href={c.contract_url && token ? `${c.contract_url}${c.contract_url.includes("?")?"&":"?"}token=${encodeURIComponent(token)}` : c.contract_url || "#"} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline">
                          <FileText className="size-3" />查看
                        </a>
                      ) : "-"}
                    </td>
                    <td className="py-2.5 px-2">
                      <button
                        onClick={() => handleTogglePayment(c.id, c.payment_status)}
                        className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity", payClass[c.payment_status] || payClass["未付"])}
                        title="点击切换付款状态"
                      >
                        {c.payment_status}
                      </button>
                    </td>
                    <td className="py-2.5 px-2">
                      {overdue && c.payment_status !== "已付" ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", overdue.cls)}>
                          {overdue.label === "已超时" ? <AlertCircle className="size-3" /> : <Clock className="size-3" />}
                          {overdue.label}
                        </span>
                      ) : <span className="text-xs text-[var(--muted-foreground)]">—</span>}
                    </td>
                    <td className="py-2.5 px-2">
                      <button onClick={() => handleSoftDelete(c)} className="text-[var(--muted-foreground)] hover:text-red-500 p-0.5" title="移入回收站">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* 不签约 */}
      <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/10 dark:bg-red-950/10">
        <button
          onClick={() => { setShowNosign(!showNosign); }}
          className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors"
        >
          <span className="font-medium text-red-700 dark:text-red-400 inline-flex items-center gap-2">
            <X className="size-4" />
            不签约 ({nosignInfs.length})
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">{showNosign ? "收起" : "展开"}</span>
        </button>
        {showNosign && (
          nosignInfs.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无不签约的达人</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-red-200 dark:border-red-800">
                    <th className="py-2.5 px-3 text-left text-xs font-medium">编号</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium">达人</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium max-lg:hidden">品类</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium">原因</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {nosignInfs.map((inf) => (
                    <tr key={inf.id} className="border-b border-red-200 dark:border-red-800 hover:bg-[var(--secondary)]">
                      <td className="py-2.5 px-3 text-red-700/60 dark:text-red-400/60 tabular-nums">{inf.code || "-"}</td>
                      <td className="py-2.5 px-3">
                        <Link href={`/agency/influencers/${inf.id}`} className="font-medium hover:underline text-red-700 dark:text-red-400">{inf.name}</Link>
                      </td>
                      <td className="py-2.5 px-3 text-red-700/60 dark:text-red-400/60 max-lg:hidden">{inf.category || "-"}</td>
                      <td className="py-2.5 px-3 text-xs text-[var(--muted-foreground)] max-w-[200px] truncate">
                        {(inf.notes || "").split("\n").filter((l: string) => l.includes("不签约原因")).pop()?.replace("不签约原因: ", "") || "-"}
                      </td>
                      <td className="py-2.5 px-3">
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleRestoreNosign(inf)}>
                          <RotateCcw className="size-3 mr-1" />恢复
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* 回收站 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <button
          onClick={() => { setShowTrash(!showTrash); if (!showTrash) loadTrash(); }}
          className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-[var(--muted)]/30 transition-colors"
        >
          <span className="font-medium text-[var(--muted-foreground)] inline-flex items-center gap-2">
            <Trash className="size-4" />
            回收站
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">{showTrash ? "收起" : "展开"}</span>
        </button>
        {showTrash && (
          trashContracts.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">回收站为空</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2.5 px-3 text-left text-xs font-medium">达人</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium">底薪/佣金</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">删除时间</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium max-xl:hidden">删除人</th>
                    <th className="py-2.5 px-3 text-left text-xs font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {trashContracts.map((c) => (
                    <tr key={c.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]">
                      <td className="py-2.5 px-3 font-medium">{c.influencer_name || "-"}</td>
                      <td className="py-2.5 px-3 text-[var(--muted-foreground)]">{c.base_salary || "-"} / {c.commission || "-"}</td>
                      <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{c.deleted_at || "-"}</td>
                      <td className="py-2.5 px-3 text-[var(--muted-foreground)] max-xl:hidden">{c.deleted_by || "-"}</td>
                      <td className="py-2.5 px-3 flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleRestore(c)}>
                          <RotateCcw className="size-3 mr-1" />恢复
                        </Button>
                        <button onClick={() => handlePermanentDelete(c)} className="text-[var(--muted-foreground)] hover:text-red-500 p-0.5" title="彻底删除">
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

    {/* 不签约原因弹窗 */}
    {nosignModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!nosignSaving) setNosignModal(null); }}>
        <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">不签约确认</h3>
          <p className="text-xs text-[var(--muted-foreground)] mb-4">
            达人 <span className="font-medium text-[var(--foreground)]">{nosignModal.name}</span> 将从待签约列表移除，请填写原因：
          </p>
          <textarea
            value={nosignReason}
            onChange={e => setNosignReason(e.target.value)}
            placeholder="请填写不签约的原因..."
            rows={3}
            className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none mb-4"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setNosignModal(null)} disabled={nosignSaving} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
              取消
            </button>
            <button onClick={handleNosign} disabled={nosignSaving} className="rounded-md bg-[var(--destructive)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50">
              {nosignSaving ? "处理中..." : "确认不签约"}
            </button>
          </div>
        </div>
      </div>
    )}

    {contractModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setContractModal(null)}>
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
          <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">
            创建合同 · {contractModal.influencer.name}
          </h3>
          {contractFormError && <p className="mb-3 text-xs text-[var(--destructive)]">{contractFormError}</p>}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--foreground)] mb-1">底薪</label>
              <input
                value={contractForm.base_salary}
                onChange={e => setContractForm(p => ({ ...p, base_salary: e.target.value }))}
                placeholder="如 15000"
                className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--foreground)] mb-1">佣金</label>
              <input
                value={contractForm.commission}
                onChange={e => setContractForm(p => ({ ...p, commission: e.target.value }))}
                placeholder="如 10%"
                className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
              />
            </div>
            <div className="border-t border-[var(--border)] pt-3">
              <p className="text-xs font-medium text-[var(--foreground)] mb-2">工作量（必填）</p>
              <div className="space-y-2.5">
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-0.5">月直播场次 <span className="text-[var(--destructive)]">*</span></label>
                  <input
                    value={contractForm.live_sessions}
                    onChange={e => setContractForm(p => ({ ...p, live_sessions: e.target.value }))}
                    placeholder="如 20"
                    className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-0.5">每次直播时长（小时） <span className="text-[var(--destructive)]">*</span></label>
                  <input
                    value={contractForm.live_duration}
                    onChange={e => setContractForm(p => ({ ...p, live_duration: e.target.value }))}
                    placeholder="如 3"
                    className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--muted-foreground)] mb-0.5">月视频数量 <span className="text-[var(--destructive)]">*</span></label>
                  <input
                    value={contractForm.video_count}
                    onChange={e => setContractForm(p => ({ ...p, video_count: e.target.value }))}
                    placeholder="如 8"
                    className="w-full h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2 justify-end">
            <button onClick={() => setContractModal(null)} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
              取消
            </button>
            <button
              onClick={handleSubmitContract}
              disabled={startingPhases[contractModal.influencer.id]}
              className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
            >
              {startingPhases[contractModal.influencer.id] ? "创建中..." : "创建合同并开始签约"}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
