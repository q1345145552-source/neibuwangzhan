"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Send, ExternalLink, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
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
  "已入池": "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  "已停止": "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  "已完成": "bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200",
};

interface DiscoveryTask {
  id: number; task_number: string; category: string; creator: string;
  status: string; inf_count: number; created_at: string; completed_at: string | null;
}

interface Influencer {
  id: number; name: string; tiktok_link: string; category: string;
  followers: string; status: string; created_at: string;
}

const categories = ["美妆", "服饰", "食品", "家居", "3C数码", "母婴", "运动", "宠物", "其他"];

export default function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [task, setTask] = useState<DiscoveryTask | null>(null);
  const [infList, setInfList] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: "", tiktok_link: "", category: "", followers: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [taskRes, infsRes] = await Promise.all([
        fetch(`/api/discovery-tasks/${id}`, { cache: "no-store" }),
        fetch(`/api/discovery-tasks/${id}/influencers`, { cache: "no-store" }),
      ]);
      const [taskData, infsData] = await Promise.all([taskRes.json(), infsRes.json()]);
      setTask(taskData.error ? null : taskData);
      setInfList(Array.isArray(infsData) ? infsData : []);
    } catch (err) { console.error("加载失败:", err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [id]);

  const handleAddInfluencer = async () => {
    if (!form.name.trim()) { setError("请填写达人名称"); return; }
    if (!form.tiktok_link.trim()) { setError("请填写TikTok链接"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/discovery-tasks/${id}/influencers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "添加失败");
      setForm({ name: "", tiktok_link: "", category: "", followers: "" });
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally { setSaving(false); }
  };

  const handleDeleteInf = async (infId: number) => {
    if (!confirm("确认删除此达人？")) return;
    await fetch(`/api/discovery-tasks/${id}/influencers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ influencer_id: infId }),
    });
    load();
  };

  const handleSubmitForEval = async () => {
    if (!confirm(`确认提交评估？任务下 ${infList.length} 位达人将进入 Ploy 的评估池。`)) return;
    setSubmitting(true);
    try {
      await fetch("/api/discovery-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: Number(id), status: "completed" }),
      });
      load(); // 刷新页面，不跳走
    } catch (err) { console.error(err); }
    finally { setSubmitting(false); }
  };

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (!task) return <div className="py-20 text-center text-sm text-[var(--destructive)]">任务不存在</div>;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency/influencers/tasks")}>
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">
              {task.task_number}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-[var(--muted-foreground)]">
              <span>{task.category || "不限品类"}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><Users className="size-3" />{infList.length} 位达人</span>
              <span>·</span>
              <span>{task.creator}</span>
              <span>·</span>
              <span>{new Date(task.created_at + "Z").toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}</span>
            </div>
          </div>
        </div>
        {task.status === "active" && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="size-3.5" />添加达人</Button>
            <Button size="sm" className="gap-1" onClick={handleSubmitForEval} disabled={submitting || infList.length === 0}>
              <Send className="size-3.5" />
              {submitting ? "提交中..." : "提交评估"}
            </Button>
          </div>
        )}
        {task.status === "completed" && (
          <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium",
            "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300")}>
            ✅ 已提交评估
            {task.completed_at && (
              <span className="text-xs opacity-70">
                {new Date(task.completed_at + "Z").toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Add influencer form */}
      {showAdd && task.status === "active" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-3">添加达人</h2>
          {error && <div className="mb-3 text-sm text-[var(--destructive)]">{error}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">达人名称 <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="@username" autoFocus
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">TikTok 链接 <span className="text-red-500">*</span></label>
              <input value={form.tiktok_link} onChange={e => setForm(p => ({ ...p, tiktok_link: e.target.value }))}
                placeholder="https://tiktok.com/@username"
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">品类</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm">
                <option value="">请选择</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">粉丝量</label>
              <input value={form.followers} onChange={e => setForm(p => ({ ...p, followers: e.target.value }))}
                placeholder="例如: 10万"
                className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={handleAddInfluencer} disabled={saving}>{saving ? "添加中..." : "添加"}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setError(""); }}>取消</Button>
          </div>
        </div>
      )}

      {/* Influencer list — always visible */}
      {infList.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)] rounded-xl border border-dashed border-[var(--border)]">
          {task.status === "active" ? <>暂无达人，点击"添加达人"开始</> : "此任务下暂无达人记录"}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">达人名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">品类</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">粉丝量</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">评估状态</th>
                {task.status === "active" && <th className="py-3 px-4 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {infList.map(inf => (
                <tr key={inf.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
                  <td className="py-3 px-4">
                    <Link href={`/agency/influencers/${inf.id}`} className="font-medium text-[var(--foreground)] hover:underline">
                      {inf.name}
                    </Link>
                    {inf.tiktok_link && (
                      <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex text-[var(--muted-foreground)] hover:text-[var(--primary)] ml-1">
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{inf.category || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{inf.followers || "-"}</td>
                  <td className="py-3 px-4">
                    <span className={cn(
                      "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                      statusClass[inf.status] || statusClass["待评估"]
                    )}>{inf.status}</span>
                  </td>
                  {task.status === "active" && (
                    <td className="py-3 px-4">
                      <button onClick={() => handleDeleteInf(inf.id)} className="text-[var(--muted-foreground)] hover:text-red-500">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
