"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";

type Rating = { id: string; source_order_no: string; internal_order_id: string | null; step_order: number; step_name: string; public_name: string;
  assignee: string; stars: number; comment: string; points: number; customer_name: string; rated_at: string };
type Person = { person: string; count: number; avg: number; points: number; low: number };
type Gift = { source_order_no: string; customer_name: string; qualified_at: string; sent_at: string | null; sent_by: string; order_id: string | null; rating_count: number; avg_stars: number | null };

const th = "py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap";
const td = "py-3 px-4 align-top text-sm";
const starText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/**
 * 客户评价（2026-10-20 老板：加个员工评价表，每一个小流程都可以打分，打分送泰国特产）。
 * 每步评价：客户在业务系统给每一步打的分，按经办人加减积分（≥4 星 +3、≤2 星 -3）；管理员看全部，员工看评到自己的。
 * 特产待送：一张单每一步都评完送一份，送了点「已送出」。
 */
export default function CustomerRatingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"ratings" | "gifts">("ratings");
  const [data, setData] = useState<{ ratings: Rating[]; summary: Person[]; is_admin: boolean } | null>(null);
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    setError("");
    fetchWithAuth("/api/customer-ratings", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "加载失败"); return r.json(); })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : "加载失败"));
    fetchWithAuth("/api/customer-ratings/gifts", { cache: "no-store" })
      .then(r => r.json())
      .then((d: { gifts?: Gift[] }) => setGifts(d.gifts || []))
      .catch(() => setGifts([]));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const markSent = async (g: Gift) => {
    if (!window.confirm(`确认已经给 ${g.customer_name || "这位客户"} 送了泰国特产？`)) return;
    setBusy(g.source_order_no);
    try {
      const r = await fetchWithAuth("/api/customer-ratings/gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_order_no: g.source_order_no }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "操作失败");
      load();
    } catch (e) { window.alert(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(""); }
  };

  const pending = (gifts || []).filter(g => !g.sent_at).length;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">客户评价</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">客户在业务系统里，每一步办完都可以打 1～5 星。按那一步的经办人加减积分（4、5 星 +3，1、2 星 -3）；一张单每一步都评完，送一份泰国特产。</p>
      </div>
      <div className="flex w-fit rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5 text-sm">
        <button onClick={() => setTab("ratings")} className={cn("rounded-md px-3 py-1.5", tab === "ratings" ? "bg-[var(--background)] shadow-sm" : "text-[var(--muted-foreground)]")}>每步评价</button>
        <button onClick={() => setTab("gifts")} className={cn("rounded-md px-3 py-1.5", tab === "gifts" ? "bg-[var(--background)] shadow-sm" : "text-[var(--muted-foreground)]")}>
          特产待送{pending > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{pending}</span>}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--destructive)]">{error}</p>}

      {tab === "ratings" && data && (
        <>
          {data.summary.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <table className="w-full">
                <thead><tr className="border-b border-[var(--border)]"><th className={th}>员工</th><th className={th}>被评次数</th><th className={th}>平均星级</th><th className={th}>差评（1～2 星）</th><th className={th}>积分合计</th></tr></thead>
                <tbody>
                  {data.summary.map(p => (
                    <tr key={p.person} className="border-b border-[var(--border)] last:border-0">
                      <td className={td}>{p.person}</td><td className={td}>{p.count}</td>
                      <td className={td}><span className="text-[oklch(0.70_0.16_75)]">★</span> {p.avg}</td>
                      <td className={cn(td, p.low > 0 && "text-[var(--destructive)]")}>{p.low}</td>
                      <td className={cn(td, "font-mono", p.points < 0 && "text-[var(--destructive)]")}>{p.points > 0 ? `+${p.points}` : p.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
            {data.ratings.length === 0 ? <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">{data.is_admin ? "还没有客户评价" : "还没有评到你的客户评价"}</p> : (
              <table className="w-full">
                <thead><tr className="border-b border-[var(--border)]"><th className={th}>时间</th><th className={th}>客户</th><th className={th}>步骤（客户看到的）</th><th className={th}>经办人</th><th className={th}>评分</th><th className={th}>客户说</th><th className={th}>积分</th></tr></thead>
                <tbody>
                  {data.ratings.map(r => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className={cn(td, "whitespace-nowrap text-xs text-[var(--muted-foreground)]")}>{toThaiTime(r.rated_at)}</td>
                      <td className={td}>{r.customer_name || "—"}<span className="block text-xs text-[var(--muted-foreground)]">{r.internal_order_id ? <Link href={`/orders/${r.internal_order_id}`} className="hover:underline">{r.source_order_no}</Link> : r.source_order_no}</span></td>
                      <td className={td}>第 {r.step_order} 步 {r.public_name}{r.step_name && r.step_name !== r.public_name && <span className="block text-xs text-[var(--muted-foreground)]">{r.step_name}</span>}</td>
                      <td className={td}>{r.assignee || <span className="text-[var(--muted-foreground)]">没写</span>}</td>
                      <td className={cn(td, "whitespace-nowrap", r.stars <= 2 ? "text-[var(--destructive)]" : "text-[oklch(0.70_0.16_75)]")}>{starText(r.stars)}</td>
                      <td className={td}>{r.comment || <span className="text-[var(--muted-foreground)]">—</span>}</td>
                      <td className={cn(td, "font-mono", r.points < 0 && "text-[var(--destructive)]")}>{r.assignee ? (r.points > 0 ? `+${r.points}` : r.points) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "gifts" && gifts && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {gifts.length === 0 ? <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">还没有客户把一张单每一步都评完</p> : (
            <table className="w-full">
              <thead><tr className="border-b border-[var(--border)]"><th className={th}>客户</th><th className={th}>客户站单号</th><th className={th}>评完时间</th><th className={th}>评价</th><th className={th}>特产</th></tr></thead>
              <tbody>
                {gifts.map(g => (
                  <tr key={g.source_order_no} className="border-b border-[var(--border)] last:border-0">
                    <td className={td}>{g.customer_name || "—"}</td>
                    <td className={td}>{g.order_id ? <Link href={`/orders/${g.order_id}`} className="text-[var(--primary)] hover:underline">{g.source_order_no}</Link> : g.source_order_no}</td>
                    <td className={cn(td, "whitespace-nowrap text-xs")}>{toThaiTime(g.qualified_at)}</td>
                    <td className={td}>{g.rating_count} 步 · 平均 {g.avg_stars ?? "—"} 星</td>
                    <td className={td}>
                      {g.sent_at ? <span className="text-xs text-[var(--success)]">已送出 · {g.sent_by} {toThaiTime(g.sent_at)}</span>
                        : <button onClick={() => markSent(g)} disabled={busy === g.source_order_no} className="rounded-md bg-[var(--primary)] px-3 py-1 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50">已送出</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
