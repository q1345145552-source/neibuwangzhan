export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-pulse">
        <div className="mb-2 h-7 w-28 rounded bg-[var(--muted)]" />
        <div className="h-4 w-48 rounded bg-[var(--muted)]" />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="h-9 w-40 animate-pulse rounded-lg bg-[var(--muted)]" />
        <div className="h-9 w-24 animate-pulse rounded-lg bg-[var(--muted)]" />
        <div className="h-9 w-28 animate-pulse rounded-lg bg-[var(--muted)]" />
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-0">
        <div className="space-y-0">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-[var(--border)] px-4 py-3">
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 w-32 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
