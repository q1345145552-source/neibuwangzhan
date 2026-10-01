"use client";

export default function ProjectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">我的项目</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">我的项目列表</p>
      </div>

      {/* 空骨架：后续轮次填充列表内容 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-medium text-[var(--foreground)]">项目列表</h2>
        </div>
        <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
          项目列表（建设中）
        </div>
      </div>
    </div>
  );
}
