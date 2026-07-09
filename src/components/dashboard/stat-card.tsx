import { Minus } from "lucide-react";
import Link from "next/link";

interface StatCardProps {
  label: string;
  value: string | number;
  href?: string;
}

export function StatCard({ label, value, href }: StatCardProps) {
  const card = (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
      <span className="text-xs font-medium text-[var(--muted-foreground)] tracking-wide">{label}</span>
      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--foreground)]">
        {typeof value === "number" ? value.toLocaleString("zh-CN") : value}
      </span>
    </div>
  );

  if (href) {
    return <Link href={href}>{card}</Link>;
  }
  return card;
}
