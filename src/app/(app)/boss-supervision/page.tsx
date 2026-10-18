"use client";

import { useAuth } from "@/components/auth-provider";

export default function BossSupervisionPage() {
  const { user } = useAuth();
  if (!user) return <p>检查登录状态…</p>;
  if (user.role !== "admin") return <p role="alert">无权访问监督看板，仅管理员可查看。</p>;

  return <div className="min-w-0 space-y-5">
    <h1 className="text-2xl font-bold">监督看板</h1>
    <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 text-sm text-[var(--muted-foreground)]">暂无内容。</p>
  </div>;
}
