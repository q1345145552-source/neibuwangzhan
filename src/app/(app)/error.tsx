"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex size-12 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)]">
        <span className="text-xl text-[var(--destructive)]">!</span>
      </div>
      <h2 className="mt-4 text-lg font-medium text-[var(--foreground)]">
        加载失败
      </h2>
      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
        数据加载出错，请稍后重试。
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => reset()}
      >
        重新加载
      </Button>
    </div>
  );
}
