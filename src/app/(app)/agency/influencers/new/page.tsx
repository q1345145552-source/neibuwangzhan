"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { ArrowLeft, Loader2 } from "lucide-react";

const categories = ["美妆 (Beauty)", "测评 (Review/Try-on)", "生活 (Lifestyle)", "时尚 (Fashion)",
    "美食 (Food)", "3C (Electronics)", "日用品 (Daily Items)", "母婴 (Mom & Baby)",
    "健康保健品 (Health Supplement)", "健康 (Health)", "家具 (Furniture)", "运动户外 (Sports & Outdoor)",
    "汽摩 (Auto & Motor)", "牛仔裤 (Jeans)", "包包 (Bags)", "衣服 (Clothing)",
    "睡衣 (Sleepwear)", "内衣 (Underwear)", "家电 (Appliances)", "便携风扇 (Portable Fan)",
    "电宝 (Power Bank)", "露营 (Camping)", "钱包 (Wallets)", "鞋子 (Shoes)",
    "微胖女生 (Plus Size Women)", "男士裤子 (Men's Pants)", "手机配件 (Phone Accessories)",
    "耳机 (Earphones)", "音箱 (Speakers)", "家装建材 (Home Improvement)", "农业品类 (Agriculture)",
    "泳衣 (Swimwear)", "太阳能灯 (Solar Lights)", "健身器材 (Fitness Equipment)", "眼镜 (Eyewear)",
    "玩具 (Toys)"];

export default function NewInfluencerPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    tiktok_link: "",
    contact_phone: "",
    line_id: "",
    category: "",
    monthly_gmv: "",
    live_stream_ratio: "",
    followers: "",
    avg_views: "",
    gmv_range: "",
    code: "",
    notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("请填写达人名称"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithAuth("/api/influencers", {
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
    <div className="flex flex-col gap-6 max-w-xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency/influencers")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">添加达人</h1>
      </div>

      {error && (
        <div className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* 基本信息 */}
        <fieldset className="rounded-xl border border-[var(--border)] p-5">
          <legend className="text-sm font-medium text-[var(--foreground)] px-1">基本信息</legend>
          <div className="mt-2 flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">达人姓名 / 昵称 <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={e => update("name", e.target.value)} placeholder="例如: @beauty_thai" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" autoFocus />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">达人编号</label>
              <input value={form.code} onChange={e => update("code", e.target.value)} placeholder="例如: INF-001，可手动输入" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>

            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">TikTok 主页链接</label>
              <input value={form.tiktok_link} onChange={e => update("tiktok_link", e.target.value)} placeholder="https://tiktok.com/@username" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[var(--foreground)]">电话号码</label>
                <input value={form.contact_phone} onChange={e => update("contact_phone", e.target.value)} placeholder="电话 / WhatsApp" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-sm font-medium text-[var(--foreground)]">LINE ID</label>
                <input value={form.line_id} onChange={e => update("line_id", e.target.value)} placeholder="Line ID" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-[var(--foreground)]">产品品类</label>
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

            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">平均观看</label>
              <input value={form.avg_views} onChange={e => update("avg_views", e.target.value)} placeholder="例如: 50万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
        </fieldset>

        {/* 评估数据（可选） */}
        <fieldset className="rounded-xl border border-[var(--border)] p-5">
          <legend className="text-sm font-medium text-[var(--foreground)] px-1">评估数据 <span className="text-xs text-[var(--muted-foreground)]">（选填，第三步可再补充）</span></legend>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">月度 GMV</label>
              <input value={form.monthly_gmv} onChange={e => update("monthly_gmv", e.target.value)} placeholder="例如: ฿10-20万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">直播间 GMV 占比</label>
              <input value={form.live_stream_ratio} onChange={e => update("live_stream_ratio", e.target.value)} placeholder="例如: 70%" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-sm font-medium text-[var(--foreground)]">GMV区间</label>
              <input value={form.gmv_range} onChange={e => update("gmv_range", e.target.value)} placeholder="例如: ฿5-10万" className="mt-1 w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
        </fieldset>

        {/* 联系信息（创建时默认待联系，后续更新） */}
        <fieldset className="rounded-xl border border-[var(--border)] p-5">
          <legend className="text-sm font-medium text-[var(--foreground)] px-1">联系信息 <span className="text-xs text-[var(--muted-foreground)]">（创建后默认待联系）</span></legend>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">联系时间和回复状态由 Prae / Namcha 在第六步联系达人后更新</p>
        </fieldset>

        <div>
          <label className="text-sm font-medium text-[var(--foreground)]">备注</label>
          <textarea value={form.notes} onChange={e => update("notes", e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? <><Loader2 className="size-3.5 animate-spin" />创建中...</> : "创建达人"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/agency/influencers")}>取消</Button>
        </div>
      </form>
    </div>
  );
}
