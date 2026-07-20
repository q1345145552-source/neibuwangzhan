"use client";

import { useState, useEffect, use } from "react";
import { useAuth } from "@/components/auth-provider";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Building2, Tag, User, Calendar, DollarSign, Edit3, Save, X, Send, Plus,
  Clock, MessageSquare, Star, TrendingUp
} from "lucide-react";

interface CustomerDetail {
  id: number;
  company_name: string;
  industry: string;
  company_type: string;
  founded_at: string;
  source_channel: string;
  owner_name: string;
  owner_wechat: string;
  handler_name: string;
  handler_wechat: string;
  willingness: string;
  demand_tags: string;
  status: string;
  claimed_by: string;
  total_deal_amount: number;
  created_at: string;
  updated_at: string;
  follow_ups: any[];
  points: any[];
}

const statusColor: Record<string, string> = {
  "潜在": "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "跟进中": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "已合作": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "沉睡": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { user } = useAuth();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [editingClaimedBy, setEditingClaimedBy] = useState(false);
  const [newClaimedBy, setNewClaimedBy] = useState("");
  const [followUpContent, setFollowUpContent] = useState("");
  const [followUpNext, setFollowUpNext] = useState("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetchWithAuth(`/api/customers/${id}`);
        const data = await res.json();
        if (data.error) { setLoading(false); return; }
        setCustomer(data);
      } catch {} finally { setLoading(false); }
    }
    load();
  }, [id]);

  const reload = async () => {
    try {
      const res = await fetchWithAuth(`/api/customers/${id}`);
      const data = await res.json();
      if (!data.error) setCustomer(data);
    } catch {}
  };

  const handleAddFollowUp = async () => {
    if (!followUpContent.trim()) return;
    setSavingFollowUp(true);
    const res = await fetchWithAuth("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "follow_up", customer_id: Number(id), content: followUpContent.trim(), next_contact_at: followUpNext }),
    });
    setSavingFollowUp(false);
    if (res.ok) { setFollowUpContent(""); setFollowUpNext(""); reload(); }
  };

  const handleReassign = async () => {
    const res = await fetchWithAuth("/api/customers", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: Number(id), claimed_by: newClaimedBy }),
    });
    if (res.ok) {
      const updated = await res.json();
      setCustomer(prev => prev ? { ...prev, claimed_by: updated.claimed_by } : null);
      setEditingClaimedBy(false);
    }
  };

  if (loading) return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-40 rounded bg-[var(--muted)]" />
      <div className="h-64 rounded-xl bg-[var(--muted)]" />
    </div>
  );

  if (!customer) return (
    <div className="flex flex-col items-center justify-center py-20">
      <p className="text-sm text-[var(--muted-foreground)]">客户不存在或已删除</p>
      <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/customers")}>返回列表</Button>
    </div>
  );

  const tags = customer.demand_tags ? customer.demand_tags.split(/[,，\s]+/).filter(Boolean) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/customers")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{customer.company_name}</h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", statusColor[customer.status] || "")}>{customer.status}</span>
            {customer.industry && <span className="text-xs text-[var(--muted-foreground)]">{customer.industry}</span>}
            <span className="text-xs text-[var(--muted-foreground)]">· 创建于 {customer.created_at?.slice(0, 10)}</span>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left — Info */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium flex items-center gap-2">
              <Building2 className="size-4 text-[var(--muted-foreground)]" />基本信息
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">认领人</dt>
                <dd className="mt-1 text-sm flex items-center gap-2">
                  {customer.claimed_by ? (
                    <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2 py-0.5 text-xs font-medium text-[var(--primary)]">{customer.claimed_by}</span>
                  ) : "—"}
                  {user?.role === "admin" && !editingClaimedBy && (
                    <button onClick={() => { setNewClaimedBy(customer.claimed_by || ""); setEditingClaimedBy(true); }} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><Edit3 className="size-3" /></button>
                  )}
                  {editingClaimedBy && (
                    <div className="flex items-center gap-1">
                      <input value={newClaimedBy} onChange={e => setNewClaimedBy(e.target.value)}
                        className="w-24 h-7 text-xs rounded border border-[var(--border)] px-2 outline-none focus:border-[var(--ring)]" placeholder="员工名" />
                      <button onClick={handleReassign} className="text-green-600 hover:text-green-700"><Save className="size-3" /></button>
                      <button onClick={() => setEditingClaimedBy(false)} className="text-[var(--muted-foreground)]"><X className="size-3" /></button>
                    </div>
                  )}
                </dd>
              </div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">公司性质</dt><dd className="mt-1 text-sm">{customer.company_type || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">成立时间</dt><dd className="mt-1 text-sm">{customer.founded_at || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">来源渠道</dt><dd className="mt-1 text-sm">{customer.source_channel || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">合作意愿度</dt><dd className="mt-1 text-sm">{customer.willingness || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">成交总额</dt><dd className="mt-1 text-sm font-mono">{customer.total_deal_amount > 0 ? customer.total_deal_amount.toLocaleString() + " ฿" : "—"}</dd></div>
            </dl>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium flex items-center gap-2">
              <User className="size-4 text-[var(--muted-foreground)]" />联系人
            </h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div><dt className="text-xs text-[var(--muted-foreground)]">老板姓名</dt><dd className="mt-1 text-sm">{customer.owner_name || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">老板微信</dt><dd className="mt-1 text-sm font-mono">{customer.owner_wechat || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">经办人姓名</dt><dd className="mt-1 text-sm">{customer.handler_name || "—"}</dd></div>
              <div><dt className="text-xs text-[var(--muted-foreground)]">经办人微信</dt><dd className="mt-1 text-sm font-mono">{customer.handler_wechat || "—"}</dd></div>
            </dl>
          </div>

          {/* Follow-up logs placeholder */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium flex items-center gap-2">
              <MessageSquare className="size-4 text-[var(--muted-foreground)]" />跟进记录
            </h3>
            {/* Follow-up input */}
            <div className="mb-4 flex flex-col gap-2">
              <textarea value={followUpContent} onChange={e => setFollowUpContent(e.target.value)}
                className="w-full min-h-[60px] rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none resize-none focus:border-[var(--ring)]"
                placeholder="写跟进记录... (+2 积分)" />
              <div className="flex items-center gap-2">
                <input type="date" value={followUpNext} onChange={e => setFollowUpNext(e.target.value)}
                  className="h-8 rounded border border-[var(--border)] px-2 text-xs outline-none focus:border-[var(--ring)]" placeholder="下次联系" />
                <div className="flex-1" />
                <Button size="xs" onClick={handleAddFollowUp} disabled={savingFollowUp || !followUpContent.trim()} className="gap-1">
                  <Send className="size-3" />{savingFollowUp ? "发送中..." : "发送"}
                </Button>
              </div>
            </div>

            {customer.follow_ups?.length ? (
              <div className="space-y-3">
                {customer.follow_ups.map((f: any) => (
                  <div key={f.id} className="border-l-2 border-[var(--border)] pl-4 py-1">
                    <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] mb-1">
                      <span className="font-medium text-[var(--foreground)]">{f.employee_name}</span>
                      <span>·</span>
                      <span>{f.created_at?.slice(0, 16)}</span>
                      {f.next_contact_at && <><span>·</span><span>下次联系: {f.next_contact_at}</span></>}
                    </div>
                    <p className="text-sm">{f.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">暂无跟进记录</p>
            )}
          </div>
        </div>

        {/* Right — Tags & Points */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-3 text-sm font-medium flex items-center gap-2">
              <Tag className="size-4 text-[var(--muted-foreground)]" />需求标签
            </h3>
            {tags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t, i) => (
                  <span key={i} className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary)]">{t}</span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">无标签</p>
            )}
          </div>

          {/* Points summary */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-3 text-sm font-medium flex items-center gap-2">
              <Star className="size-4 text-[var(--muted-foreground)]" />积分记录
            </h3>
            {customer.points?.length ? (
              <div className="space-y-2">
                {customer.points.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="text-xs text-[var(--muted-foreground)]">{p.point_type}</span>
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">{p.employee_name}</span>
                    </div>
                    <span className={cn("font-mono font-medium", p.points > 0 ? "text-green-600" : "text-[var(--destructive)]")}>
                      {p.points > 0 ? "+" : ""}{p.points}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">暂无积分记录</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
