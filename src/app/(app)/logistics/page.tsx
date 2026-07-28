"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Plus, Package, MapPin, User, Clock, TrendingUp, Calendar, AlertTriangle, Truck, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShippingOrder {
  id: number;
  cabinet_number: string;
  warehouse: string;
  progress: string;
  creator: string;
  created_at: string;
}

interface DashboardStats {
  total: number;
  inProgress: number;
  thisWeek: number;
  whCounts: Record<string, number>;
  avgDelay: number;
  delayCount: number;
  overdueOrders: number[];
}

const WAREHOUSES = ["义乌", "深圳", "广州", "东莞", "揭阳"];
const WH_COLORS: Record<string, string> = {
  "义乌": "bg-blue-500", "深圳": "bg-emerald-500", "广州": "bg-amber-500",
  "东莞": "bg-purple-500", "揭阳": "bg-rose-500",
};

export default function LogisticsPage() {
  const [orders, setOrders] = useState<ShippingOrder[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ cabinet_number: "", warehouse: "义乌" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [resOrders, resStats] = await Promise.all([
        fetchWithAuth("/api/logistics"),
        fetchWithAuth("/api/logistics?action=stats"),
      ]);
      if (resOrders.ok) {
        const data = await resOrders.json();
        setOrders(Array.isArray(data) ? data : []);
      }
      if (resStats.ok) {
        setStats(await resStats.json());
      }
    } catch { setOrders([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.cabinet_number.trim()) { setError("请输入柜号"); return; }
    setSaving(true);
    setError("");
    try {
      const res = await fetchWithAuth("/api/logistics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const e = await res.json(); setError(e.error || "创建失败"); return; }
      setShowNew(false);
      setForm({ cabinet_number: "", warehouse: "义乌" });
      load();
    } catch { setError("网络错误"); }
    finally { setSaving(false); }
  };

  const formatTime = (t: string) => {
    if (!t) return "—";
    return new Date(t.replace(" ", "T") + "+07:00").toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  };

  const maxWh = Math.max(1, ...Object.values(stats?.whCounts || {}));

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">物流 · 轨迹更新</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">管理集装箱轨迹，跟踪每柜八步流程</p>
        </div>
        <Button onClick={() => { setShowNew(true); setError(""); }}>
          <Plus className="size-4 mr-1.5" />新建订单
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* ── 看板五卡片 ── */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <Package className="size-4 text-blue-500 mb-2" />
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.total}</p>
            <p className="text-xs text-[var(--muted-foreground)]">全部柜号</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <TrendingUp className="size-4 text-amber-500 mb-2" />
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.inProgress}</p>
            <p className="text-xs text-[var(--muted-foreground)]">进行中</p>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <Calendar className="size-4 text-emerald-500 mb-2" />
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.thisWeek}</p>
            <p className="text-xs text-[var(--muted-foreground)]">本周新增</p>
          </div>
          <div className={cn("rounded-xl border p-4", stats.avgDelay > 0 && stats.overdueOrders.length > 0 ? "border-orange-300 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/10" : "border-[var(--border)] bg-[var(--card)]")}>
            <AlertTriangle className={cn("size-4 mb-2", stats.avgDelay > 0 && stats.overdueOrders.length > 0 ? "text-orange-500" : "text-[var(--muted-foreground)]")} />
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.avgDelay}<span className="text-sm font-normal text-[var(--muted-foreground)]">天</span></p>
            <p className="text-xs text-[var(--muted-foreground)]">拆派仓平均延迟</p>
            {stats.overdueOrders.length > 0 && (
              <p className="mt-1 text-[0.6rem] text-orange-600 dark:text-orange-400">
                警告：{stats.overdueOrders.length} 个柜号超过均值的150%
              </p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <Truck className="size-4 text-purple-500 mb-2" />
            <p className="text-2xl font-bold text-[var(--foreground)]">{stats.total}</p>
            <p className="text-xs text-[var(--muted-foreground)]">5个仓库</p>
          </div>
        </div>
      )}

      {/* ── 仓库分布 ── */}
      {stats && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <h3 className="mb-3 text-sm font-medium text-[var(--foreground)] flex items-center gap-2">
            <BarChart3 className="size-4 text-[var(--muted-foreground)]" />各仓库柜号分布
          </h3>
          <div className="grid gap-3 sm:grid-cols-5">
            {WAREHOUSES.map(w => {
              const c = stats.whCounts[w] || 0;
              const pct = maxWh > 0 ? Math.round(c / maxWh * 100) : 0;
              return (
                <div key={w} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--foreground)]">{w}</span>
                    <span className="font-medium text-[var(--foreground)]">{c}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--muted)] overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", WH_COLORS[w] || "bg-slate-400")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* New order form */}
      {showNew && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="mb-4 text-sm font-medium text-[var(--foreground)]">新建轨迹订单</h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">柜号</label>
              <input
                value={form.cabinet_number}
                onChange={e => setForm(p => ({ ...p, cabinet_number: e.target.value }))}
                placeholder="如 TGHU1234567"
                className="h-9 w-48 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-[var(--muted-foreground)]">发货仓库</label>
              <select
                value={form.warehouse}
                onChange={e => setForm(p => ({ ...p, warehouse: e.target.value }))}
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]"
              >
                {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "创建中…" : "创建"}
            </Button>
            <Button variant="outline" onClick={() => setShowNew(false)}>取消</Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-sm text-[var(--muted-foreground)]">
          <Package className="size-8 mx-auto mb-2 opacity-30" />
          暂无轨迹记录，点击「新建订单」开始
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">柜号</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">仓库</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">进度</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]/30 transition-colors">
                  <td className="py-3 px-5 font-medium text-[var(--foreground)]">
                    <Link href={`/logistics/${o.id}`} className="hover:underline">{o.cabinet_number}</Link>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-xs">
                      <MapPin className="size-3 text-[var(--muted-foreground)]" />{o.warehouse}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={cn(
                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      o.progress === "已完成" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}>{o.progress}</span>
                  </td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1"><User className="size-3" />{o.creator || "—"}</span>
                  </td>
                  <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3" />{formatTime(o.created_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
