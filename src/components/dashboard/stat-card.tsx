import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  change?: { value: number; direction: "up" | "down" | "flat" };
}

export function StatCard({ label, value, change }: StatCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)] transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
      <span className="text-xs font-medium text-[var(--muted-foreground)] tracking-wide">
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums text-[var(--foreground)]">
        {typeof value === "number" ? value.toLocaleString("zh-CN") : value}
      </span>
      {change && (
        <div className="flex items-center gap-1">
          {change.direction === "up" ? (
            <TrendingUp className="size-3 text-[var(--success)]" />
          ) : change.direction === "down" ? (
            <TrendingDown className="size-3 text-[var(--destructive)]" />
          ) : (
            <Minus className="size-3 text-[var(--muted-foreground)]" />
          )}
          <span
            className={cn(
              "text-xs tabular-nums",
              change.direction === "up" && "text-[var(--success)]",
              change.direction === "down" && "text-[var(--destructive)]",
              change.direction === "flat" && "text-[var(--muted-foreground)]"
            )}
          >
            {change.value > 0 && "+"}
            {change.value}%
          </span>
          <span className="text-xs text-[var(--muted-foreground)]">
            较昨日
          </span>
        </div>
      )}
    </div>
  );
}
