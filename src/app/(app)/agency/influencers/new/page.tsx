"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";

const categories = ["美妆", "服饰", "食品", "家居", "3C数码", "母婴", "运动", "宠物", "其他"];

export default function NewInfluencerPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    tiktok_link: "",
    category: "",
    contact: "",
    contact_phone: "",
    followers: "",
    avg_views: "",
    gmv_range: "",
    notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("请填写达人名称"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/influencers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      router.push(`/agency/influencers/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">添加达人</h1>
      </div>

      {error && (
        <div className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-[var(--foreground)]">达人名称 <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={e => update("name", e.target.value)} placeholder="例如: @beauty_thai" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" autoFocus />
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--foreground)]">TikTok 链接</label>
          <input value={form.tiktok_link} onChange={e => update("tiktok_link", e.target.value)} placeholder="https://tiktok.com/@username" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">品类</label>
            <select value={form.category} onChange={e => update("category", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
              <option value="">请选择</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">粉丝量</label>
            <input value={form.followers} onChange={e => update("followers", e.target.value)} placeholder="例如: 10万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">联系人</label>
            <input value={form.contact} onChange={e => update("contact", e.target.value)} className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">联系方式</label>
            <input value={form.contact_phone} onChange={e => update("contact_phone", e.target.value)} placeholder="电话/WhatsApp)" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">平均观看</label>
            <input value={form.avg_views} onChange={e => update("avg_views", e.target.value)} placeholder="例如: 50万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
          </div>
          <div>
            <label className="text-sm font-medium text-[var(--foreground)]">GMV区间</label>
            <input value={form.gmv_range} onChange={e => update("gmv_range", e.target.value)} placeholder="例如: ฿5-10万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--foreground)]">备注</label>
          <textarea value={form.notes} onChange={e => update("notes", e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? <><Loader2 className="size-3.5 animate-spin" />创建中...</> : "创建达人"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>取消</Button>
        </div>
      </form>
    </div>
  );
}
