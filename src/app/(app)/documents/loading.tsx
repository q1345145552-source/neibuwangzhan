export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-pulse">
        <div className="mb-2 h-7 w-28 rounded-md bg-[var(--muted)]" />
        <div className="h-4 w-40 rounded-md bg-[var(--muted)]" />
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="h-4 w-24 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 flex-1 animate-pulse rounded bg-[var(--muted)]" />
              <div className="h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
