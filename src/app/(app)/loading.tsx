export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="animate-pulse">
        <div className="mb-2 h-7 w-24 rounded-md bg-[var(--muted)]" />
        <div className="h-4 w-48 rounded-md bg-[var(--muted)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-7 w-24 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-3 w-20 animate-pulse rounded bg-[var(--muted)]" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-5">
        <div className="mb-4 h-4 w-36 animate-pulse rounded bg-[var(--muted)]" />
        <div className="h-[280px] animate-pulse rounded-md bg-[var(--muted)]" />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-5">
        <div className="mb-4 h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-[var(--border)] py-3"
          >
            <div className="h-4 flex-1 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-[var(--muted)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
