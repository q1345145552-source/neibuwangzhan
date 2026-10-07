"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { bangkokToday } from "@/lib/time";
import { Plus, Trash2, Edit3, Search, Store } from "lucide-react";
import { OrderDetailModal } from "./order-detail-modal";

interface ShopeeOrder {
  id: number;
  order_date: string;
  customer_name: string;
  store_qty: number;
  status: "有可售店铺" | "等待扫描验证资料" | "暂无可售店铺";
  created_by: string;
  created_at: string;
}

const STATUS_OPTIONS: ShopeeOrder["status"][] = ["有可售店铺", "等待扫描验证资料", "暂无可售店铺"];

const STATUS_BADGE: Record<ShopeeOrder["status"], string> = {
  有可售店铺: "bg-emerald-500/15 text-emerald-600",
  等待扫描验证资料: "bg-amber-500/15 text-amber-600",
  暂无可售店铺: "bg-red-500/15 text-red-600",
};

export function OrdersTab() {
  const [orders, setOrders] = useState<ShopeeOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ order_date: "", customer_name: "", store_qty: "", status: "有可售店铺" as ShopeeOrder["status"] });
  const [err, setErr] = useState("");
  const [detailOrder, setDetailOrder] = useState<{ id: number; customer_name: string } | null>(null);

  const load = async (status = statusFilter, q = search) => {
    try {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (q && q.trim()) params.set("q", q.trim());
      const qs = params.toString();
      const res = await fetchWithAuth(`/api/shopee-orders${qs ? "?" + qs : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      setOrders(await res.json());
    } catch {}
  };

  useEffect(() => { load(statusFilter, search); }, [statusFilter]);
  // 搜索客户名称：300ms 防抖
  useEffect(() => {
    const t = setTimeout(() => load(statusFilter, search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const openCreate = () => {
    setEditId(null);
    setForm({ order_date: bangkokToday(), customer_name: "", store_qty: "", status: "有可售店铺" });
    setErr("");
    setShowForm(true);
  };

  const openEdit = (o: ShopeeOrder) => {
    setEditId(o.id);
    setForm({ order_date: o.order_date, customer_name: o.customer_name, store_qty: String(o.store_qty), status: o.status });
    setErr("");
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.order_date) { setErr("请选择下单日期"); return; }
    if (!form.customer_name.trim()) { setErr("请填写客户名称"); return; }
    const n = Number(form.store_qty);
    if (!Number.isInteger(n) || n < 1) { setErr("购买店铺数量必须是正整数"); return; }
    const ok = await apiCall("/api/shopee-orders", {
      method: editId ? "PATCH" : "POST",
      body: editId
        ? { id: editId, order_date: form.order_date, customer_name: form.customer_name.trim(), store_qty: n, status: form.status }
        : { order_date: form.order_date, customer_name: form.customer_name.trim(), store_qty: n, status: form.status },
      onError: (m) => setErr(m),
    });
    if (ok) { setShowForm(false); setErr(""); load(); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除该订单？删除后无法恢复。")) return;
    const ok = await apiCall(`/api/shopee-orders?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  const changeStatus = async (o: ShopeeOrder, status: ShopeeOrder["status"]) => {
    if (o.status === status) return;
    const ok = await apiCall("/api/shopee-orders", { method: "PATCH", body: { id: o.id, status } });
    if (ok) load();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 筛选 + 新增 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索客户名称"
            className="h-9 w-44 rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-3 text-sm outline-none focus:border-[var(--ring)]"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]">
          <option value="all">全部状态</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="ml-auto">
          <Button size="sm" onClick={openCreate}><Plus className="size-3.5" />新增订单</Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">{editId ? "编辑订单" : "新增订单"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">下单日期</label>
              <input value={form.order_date} onChange={(e) => setForm((p) => ({ ...p, order_date: e.target.value }))}
                type="date"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">客户名称</label>
              <input value={form.customer_name} onChange={(e) => setForm((p) => ({ ...p, customer_name: e.target.value }))}
                placeholder="例如：张先生"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">购买店铺数量</label>
              <input value={form.store_qty} onChange={(e) => setForm((p) => ({ ...p, store_qty: e.target.value }))}
                type="number" min="1" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">订单状态</label>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as ShopeeOrder["status"] }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submit}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        {orders.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无订单</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">下单日期</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">客户名称</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">购买店铺数量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">订单状态</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 tabular-nums">{o.order_date}</td>
                    <td className="py-2.5 px-4 font-medium">{o.customer_name}</td>
                    <td className="py-2.5 px-4 tabular-nums">{o.store_qty}</td>
                    <td className="py-2.5 px-4">
                      <select
                        value={o.status}
                        onChange={(e) => changeStatus(o, e.target.value as ShopeeOrder["status"])}
                        className={`h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)] ${STATUS_BADGE[o.status]}`}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 px-4 flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setDetailOrder({ id: o.id, customer_name: o.customer_name })}><Store className="size-3" />明细</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(o)}><Edit3 className="size-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(o.id)}><Trash2 className="size-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {orders.map((o) => (
                <div key={o.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--foreground)]">{o.customer_name}</div>
                      <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">下单日期 {o.order_date}</div>
                    </div>
                    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${STATUS_BADGE[o.status]}`}>{o.status}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-[var(--muted-foreground)]">购买店铺数量</span>
                    <span className="text-lg font-semibold tabular-nums">{o.store_qty}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <select
                      value={o.status}
                      onChange={(e) => changeStatus(o, e.target.value as ShopeeOrder["status"])}
                      className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--ring)]"
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setDetailOrder({ id: o.id, customer_name: o.customer_name })}><Store className="size-3" />明细</Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(o)}><Edit3 className="size-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(o.id)}><Trash2 className="size-3" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {detailOrder && <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />}
    </div>
  );
}
