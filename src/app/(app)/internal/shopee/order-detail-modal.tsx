"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { X, Plus, Trash2, Ban } from "lucide-react";

interface OrderRef {
  id: number;
  customer_name: string;
}

interface ShopeeStore {
  id: number;
  store_code: string;
  store_name: string;
  status: string;
  sold: string;
}

interface ShopeeOrderItem {
  id: number;
  order_id: number;
  store_id: number;
  store_code: string;
  store_name: string;
  process_status: string;
  ban_status: string;
  ban_reason: string;
}

const PROCESS_OPTIONS = ["等待处理", "正在准备资料", "已交付", "保修期限"] as const;
const BAN_OPTIONS = ["可以处理", "无法处理", "已处理", "已更换店铺"] as const;

const PROCESS_BADGE: Record<string, string> = {
  等待处理: "bg-[var(--muted)] text-[var(--muted-foreground)]",
  正在准备资料: "bg-amber-500/15 text-amber-600",
  已交付: "bg-emerald-500/15 text-emerald-600",
  保修期限: "bg-blue-500/15 text-blue-600",
};

const BAN_BADGE: Record<string, string> = {
  可以处理: "bg-amber-500/15 text-amber-600",
  无法处理: "bg-red-500/15 text-red-600",
  已处理: "bg-emerald-500/15 text-emerald-600",
  已更换店铺: "bg-blue-500/15 text-blue-600",
};

export function OrderDetailModal({ order, onClose }: { order: OrderRef; onClose: () => void }) {
  const [items, setItems] = useState<ShopeeOrderItem[]>([]);
  const [stores, setStores] = useState<ShopeeStore[]>([]);
  const [addStoreId, setAddStoreId] = useState("");
  const [err, setErr] = useState("");
  const [banItemId, setBanItemId] = useState<number | null>(null);
  const [banForm, setBanForm] = useState({ status: "可以处理", reason: "" });

  const loadItems = async () => {
    try {
      const res = await fetchWithAuth(`/api/shopee-order-items?order_id=${order.id}`, { cache: "no-store" });
      if (!res.ok) return;
      setItems(await res.json());
    } catch {}
  };

  const loadStores = async () => {
    try {
      const res = await fetchWithAuth("/api/shopee-stores", { cache: "no-store" });
      if (!res.ok) return;
      setStores(await res.json());
    } catch {}
  };

  useEffect(() => { loadItems(); loadStores(); }, [order.id]);

  const availableStores = stores.filter((s) => s.status === "可售" && s.sold === "未出售");

  const addStore = async () => {
    if (!addStoreId) { setErr("请选择要添加的店铺"); return; }
    const ok = await apiCall("/api/shopee-order-items", {
      method: "POST",
      body: { order_id: order.id, store_id: Number(addStoreId) },
      onError: (m) => setErr(m),
    });
    if (ok) { setErr(""); setAddStoreId(""); loadItems(); loadStores(); }
  };

  const changeProcess = async (item: ShopeeOrderItem, status: string) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, process_status: status } : i)));
    const ok = await apiCall("/api/shopee-order-items", { method: "PATCH", body: { id: item.id, process_status: status } });
    if (!ok) loadItems();
  };

  const openBan = (item: ShopeeOrderItem) => {
    setBanItemId(item.id);
    setBanForm({ status: item.ban_status || "可以处理", reason: item.ban_reason || "" });
    setErr("");
  };

  const submitBan = async () => {
    if (!banItemId) return;
    const ok = await apiCall("/api/shopee-order-items", {
      method: "PATCH",
      body: { id: banItemId, ban_status: banForm.status, ban_reason: banForm.reason.trim() },
      onError: (m) => setErr(m),
    });
    if (ok) { setBanItemId(null); setErr(""); loadItems(); loadStores(); }
  };

  const removeStore = async (item: ShopeeOrderItem) => {
    if (!confirm(`确定把店铺「${item.store_name}」从订单移除？移除后台账会恢复为可售。`)) return;
    const ok = await apiCall(`/api/shopee-order-items?id=${item.id}`, { method: "DELETE" });
    if (ok) { loadItems(); loadStores(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 max-w-2xl w-full max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">店铺明细</h2>
            <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">订单客户：{order.customer_name}</p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭"><X className="size-4" /></Button>
        </div>

        {/* 添加店铺 */}
        <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
          <div className="text-xs font-medium mb-2">添加店铺（从台账选可售店铺）</div>
          {availableStores.length === 0 ? (
            <p className="text-xs text-[var(--muted-foreground)]">当前没有可售店铺可选</p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={addStoreId} onChange={(e) => setAddStoreId(e.target.value)}
                className="h-9 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                <option value="">请选择店铺…</option>
                {availableStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.store_code} · {s.store_name}</option>
                ))}
              </select>
              <Button size="sm" onClick={addStore}><Plus className="size-3.5" />添加</Button>
            </div>
          )}
        </div>

      {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}

        {/* 店铺列表 */}
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">该订单还没有店铺</div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--foreground)]">{item.store_name}</span>
                    <span className="ml-2 font-mono text-xs text-[var(--muted-foreground)]">{item.store_code}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {item.ban_status ? (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${BAN_BADGE[item.ban_status] || "bg-[var(--muted)]"}`}>{item.ban_status}</span>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => openBan(item)}><Ban className="size-3" />记封禁</Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => removeStore(item)}><Trash2 className="size-3" /></Button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="text-xs text-[var(--muted-foreground)]">处理状态</label>
                  <select value={item.process_status} onChange={(e) => changeProcess(item, e.target.value)}
                    className={`h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)] ${PROCESS_BADGE[item.process_status] || ""}`}>
                    {PROCESS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {item.ban_status && item.ban_reason && (
                    <span className="text-xs text-[var(--muted-foreground)]">封禁原因：{item.ban_reason}</span>
                  )}
                </div>

                {banItemId === item.id && (
                  <div className="mt-2 rounded-md border border-[var(--border)] p-3">
                    <div className="text-xs font-medium mb-2">记封禁处理</div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select value={banForm.status} onChange={(e) => setBanForm((p) => ({ ...p, status: e.target.value }))}
                        className="h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
                        {BAN_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input value={banForm.reason} onChange={(e) => setBanForm((p) => ({ ...p, reason: e.target.value }))}
                        placeholder="封禁原因（选填）"
                        className="h-9 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={submitBan}>保存封禁</Button>
                      <Button variant="ghost" size="sm" onClick={() => setBanItemId(null)}>取消</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
