export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-pulse">
        <div className="mb-2 h-7 w-28 rounded bg-[var(--muted)]" />
        <div className="h-4 w-40 rounded bg-[var(--muted)]" />
      </div>
      <div className="h-9 w-28 animate-pulse rounded-lg bg-[var(--muted)]" />
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, c) => (
          <div key={c} className="rounded-xl border border-[var(--border)] p-4">
            <div className="mb-3 h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
            {[...Array(3)].map((_, i) => (
              <div key={i} className="mb-2 rounded-lg border border-[var(--border)] p-3">
                <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-[var(--muted)]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--muted)]" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
