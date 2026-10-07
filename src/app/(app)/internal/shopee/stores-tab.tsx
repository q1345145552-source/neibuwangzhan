"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { Plus, Trash2, Edit3 } from "lucide-react";

interface ShopeeStore {
  id: number;
  store_code: string;
  store_name: string;
  platform: "Shopee" | "TikTok";
  source: "自营" | "外购";
  supplier: string;
  cost: number;
  purchase_date: string;
  sell_price: number;
  status: "可售" | "等待扫描" | "被封";
  sold: "已出售" | "未出售";
  ban_reason: string;
  created_by: string;
  created_at: string;
}

const STATUS_BADGE: Record<ShopeeStore["status"], string> = {
  可售: "bg-emerald-500/15 text-emerald-600",
  等待扫描: "bg-amber-500/15 text-amber-600",
  被封: "bg-red-500/15 text-red-600",
};

const SOLD_BADGE: Record<ShopeeStore["sold"], string> = {
  已出售: "bg-blue-500/15 text-blue-600",
  未出售: "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

const PLATFORM_BADGE: Record<ShopeeStore["platform"], string> = {
  Shopee: "bg-orange-500/15 text-orange-600",
  TikTok: "bg-slate-500/15 text-slate-600",
};

const SOURCE_BADGE: Record<ShopeeStore["source"], string> = {
  自营: "bg-emerald-500/15 text-emerald-600",
  外购: "bg-purple-500/15 text-purple-600",
};

export function StoreLedgerTab() {
  const [stores, setStores] = useState<ShopeeStore[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({
    platform: "Shopee" as ShopeeStore["platform"],
    store_name: "",
    source: "自营" as ShopeeStore["source"],
    supplier: "",
    cost: "",
    purchase_date: "",
    sell_price: "",
    status: "可售" as ShopeeStore["status"],
    sold: "未出售" as ShopeeStore["sold"],
    ban_reason: "",
  });
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/shopee-stores", { cache: "no-store" });
      if (!res.ok) return;
      setStores(await res.json());
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditId(null);
    setForm({ platform: "Shopee", store_name: "", source: "自营", supplier: "", cost: "", purchase_date: "", sell_price: "", status: "可售", sold: "未出售", ban_reason: "" });
    setErr("");
    setShowForm(true);
  };

  const openEdit = (s: ShopeeStore) => {
    setEditId(s.id);
    setForm({
      platform: s.platform || "Shopee",
      store_name: s.store_name,
      source: s.source || "自营",
      supplier: s.supplier || "",
      cost: s.cost != null ? String(s.cost) : "",
      purchase_date: s.purchase_date || "",
      sell_price: s.sell_price != null ? String(s.sell_price) : "",
      status: s.status,
      sold: s.sold,
      ban_reason: s.ban_reason || "",
    });
    setErr("");
    setShowForm(true);
  };

  const handleSave = async () => {
    const name = form.store_name.trim();
    if (!name) { setErr("请填写店铺名称"); return; }
    if (form.status === "被封" && !form.ban_reason.trim()) { setErr("店铺被封时必须填写封禁原因"); return; }
    if (form.source === "外购") {
      if (!form.supplier.trim()) { setErr("外购店铺必须填写供应商"); return; }
      if (!form.purchase_date) { setErr("外购店铺必须填写拿货日期"); return; }
      const costNum = Number(form.cost);
      if (form.cost === "" || !Number.isFinite(costNum) || costNum < 0) { setErr("外购店铺必须填写有效的拿货成本"); return; }
      const priceNum = Number(form.sell_price);
      if (form.sell_price === "" || !Number.isFinite(priceNum) || priceNum < 0) { setErr("外购店铺必须填写有效的卖价"); return; }
    }
    const payload = {
      platform: form.platform,
      store_name: name,
      source: form.source,
      supplier: form.source === "外购" ? form.supplier.trim() : "",
      cost: form.source === "外购" ? Number(form.cost) : 0,
      purchase_date: form.source === "外购" ? form.purchase_date : "",
      sell_price: form.source === "外购" ? Number(form.sell_price) : 0,
      status: form.status,
      sold: form.sold,
      ban_reason: form.status === "被封" ? form.ban_reason.trim() : "",
    };
    const ok = await apiCall("/api/shopee-stores", {
      method: editId ? "PATCH" : "POST",
      body: editId ? { id: editId, ...payload } : payload,
      onError: (m) => setErr(m),
    });
    if (ok) {
      setShowForm(false);
      setErr("");
      load();
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除该店铺？删除后无法恢复。")) return;
    const ok = await apiCall(`/api/shopee-stores?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  const available = stores.filter((s) => s.status === "可售").length;
  const waiting = stores.filter((s) => s.status === "等待扫描").length;
  const banned = stores.filter((s) => s.status === "被封").length;
  const bannedSold = stores.filter((s) => s.status === "被封" && s.sold === "已出售").length;
  const bannedUnsold = stores.filter((s) => s.status === "被封" && s.sold === "未出售").length;

  const stats = [
    { label: "可售店铺", value: available, className: "text-emerald-600" },
    { label: "等待扫描", value: waiting, className: "text-amber-600" },
    { label: "被封店铺", value: banned, className: "text-red-600" },
    { label: "被封 · 已出售", value: bannedSold, className: "text-blue-600" },
    { label: "被封 · 未出售", value: bannedUnsold, className: "text-[var(--foreground)]" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="size-3.5" />新增店铺</Button>
      </div>

      {/* 顶部统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-xs text-[var(--muted-foreground)]">{s.label}</div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${s.className}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">{editId ? "编辑店铺" : "新增店铺"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">平台</label>
              <select value={form.platform} onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value as ShopeeStore["platform"] }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="Shopee">Shopee</option>
                <option value="TikTok">TikTok</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">店铺名称</label>
              <input value={form.store_name} onChange={(e) => setForm((p) => ({ ...p, store_name: e.target.value }))}
                placeholder="例如：XX旗舰店"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">来源</label>
              <select value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value as ShopeeStore["source"] }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="自营">自营</option>
                <option value="外购">外购</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">店铺状态</label>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ShopeeStore["status"], ban_reason: e.target.value === "被封" ? p.ban_reason : "" }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="可售">可售</option>
                <option value="等待扫描">等待扫描</option>
                <option value="被封">被封</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">是否已售</label>
              <select value={form.sold} onChange={(e) => setForm((p) => ({ ...p, sold: e.target.value as ShopeeStore["sold"] }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="未出售">未出售</option>
                <option value="已出售">已出售</option>
              </select>
            </div>

            {form.source === "外购" && (
              <>
                <div>
                  <label className="text-xs font-medium">供应商</label>
                  <input value={form.supplier} onChange={(e) => setForm((p) => ({ ...p, supplier: e.target.value }))}
                    placeholder="从哪里拿货"
                    className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">拿货成本</label>
                  <input value={form.cost} onChange={(e) => setForm((p) => ({ ...p, cost: e.target.value }))}
                    type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                    className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">拿货日期</label>
                  <input value={form.purchase_date} onChange={(e) => setForm((p) => ({ ...p, purchase_date: e.target.value }))}
                    type="date"
                    className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">卖价</label>
                  <input value={form.sell_price} onChange={(e) => setForm((p) => ({ ...p, sell_price: e.target.value }))}
                    type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00"
                    className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              </>
            )}

            {form.status === "被封" && (
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">封禁原因</label>
                <textarea value={form.ban_reason} onChange={(e) => setForm((p) => ({ ...p, ban_reason: e.target.value }))} rows={3}
                  placeholder="请填写被封的原因"
                  className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            )}
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleSave}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        {stores.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无店铺，点击右上角「新增店铺」录入</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">店铺编号</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">店铺名称</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">平台</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">来源</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">店铺状态</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">是否已售</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">封禁原因</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 font-mono">{s.store_code}</td>
                    <td className="py-2.5 px-4 font-medium">{s.store_name}</td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${PLATFORM_BADGE[s.platform] || "bg-[var(--muted)]"}`}>{s.platform || "Shopee"}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-col">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${SOURCE_BADGE[s.source] || "bg-[var(--muted)]"} w-fit`}>{s.source || "自营"}</span>
                        {s.source === "外购" && s.supplier && (
                          <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{s.supplier}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${SOLD_BADGE[s.sold]}`}>{s.sold}</span>
                    </td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{s.ban_reason || "—"}</td>
                    <td className="py-2.5 px-4 flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(s)}><Edit3 className="size-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(s.id)}><Trash2 className="size-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {stores.map((s) => (
                <div key={s.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--foreground)]">{s.store_name}</div>
                      <div className="mt-0.5 font-mono text-xs text-[var(--muted-foreground)]">{s.store_code}</div>
                    </div>
                    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${PLATFORM_BADGE[s.platform] || "bg-[var(--muted)]"}`}>{s.platform || "Shopee"}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${SOURCE_BADGE[s.source] || "bg-[var(--muted)]"}`}>{s.source || "自营"}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${SOLD_BADGE[s.sold]}`}>{s.sold}</span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">封禁原因</span><span className="text-right">{s.ban_reason || "—"}</span></div>
                    {s.source === "外购" && (
                      <>
                        <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">供应商</span><span className="text-right">{s.supplier || "—"}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">拿货成本</span><span className="tabular-nums">{s.cost != null ? s.cost : "—"}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">拿货日期</span><span>{s.purchase_date || "—"}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">卖价</span><span className="tabular-nums">{s.sell_price != null ? s.sell_price : "—"}</span></div>
                      </>
                    )}
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(s)}><Edit3 className="size-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(s.id)}><Trash2 className="size-3" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
