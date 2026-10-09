"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Ticket, ListTodo, BookOpen, Bell, EyeOff } from "lucide-react";

interface Notice {
  id: number;
  type: string;
  title: string;
  body: string;
  related_id: string;
  related_type: string;
  is_read: number;
  created_at: string;
}

// 消息中心几类通知的图标与跳转目标
const TYPE_META: Record<string, { label: string; icon: typeof Ticket; href: (n: Notice) => string }> = {
  工单指派: { label: "工单", icon: Ticket, href: (n) => `/issues?open=${n.related_id}` },
  工单完成: { label: "工单", icon: Ticket, href: (n) => `/issues?open=${n.related_id}` },
  待办指派: { label: "待办", icon: ListTodo, href: (n) => `/todos?todo=${n.related_id}` },
  待办完成: { label: "待办", icon: ListTodo, href: (n) => `/todos?todo=${n.related_id}` },
  规则更新: { label: "规则", icon: BookOpen, href: () => `/rules` },
  老板通知: { label: "老板通知", icon: Bell, href: () => `/announcements` },
};

export default function NotificationsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

  const handleClick = (n: Notice) => {
    // 点哪条标哪条已读
    if (!n.is_read) {
      fetchWithAuth("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    }
    const meta = TYPE_META[n.type];
    if (meta) router.push(meta.href(n));
  };

  const handleHide = (e: React.MouseEvent, n: Notice) => {
    e.stopPropagation();
    fetchWithAuth("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, hide: true }),
    })
      .then((r) => { if (r.ok) setItems((prev) => prev.filter((x) => x.id !== n.id)); })
      .catch(() => {});
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">消息中心</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">工单、待办、规则、老板通知的系统提醒都在这</p>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无通知</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const meta = TYPE_META[n.type];
            const Icon = meta?.icon || Bell;
            const unread = !n.is_read;
            return (
              <div
                key={n.id}
                className={cn(
                  "group rounded-xl border border-[var(--border)] bg-[var(--background)] transition-colors hover:border-[var(--primary)]",
                  unread && "border-[var(--primary)]/40 bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)]"
                )}
              >
                <div className="flex items-stretch">
                  <button onClick={() => handleClick(n)} className="flex min-w-0 flex-1 items-start gap-3 p-4 text-left">
                    <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md", unread ? "bg-[var(--primary)]/15 text-[var(--primary)]" : "bg-[var(--muted)]/40 text-[var(--muted-foreground)]")}>
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-[var(--muted-foreground)]">{meta?.label || n.type}</span>
                        {unread && <span className="size-1.5 rounded-full bg-red-500" />}
                      </span>
                      <span className={cn("mt-0.5 block truncate text-sm text-[var(--foreground)]", unread && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">{n.body}</span>}
                      <span className="mt-1 block text-xs text-[var(--muted-foreground)]/70">{toThaiTime(n.created_at)}</span>
                    </span>
                  </button>
                  <button
                    onClick={(e) => handleHide(e, n)}
                    title="隐藏"
                    className="shrink-0 px-3 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--foreground)] group-hover:opacity-100"
                  >
                    <EyeOff className="size-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
