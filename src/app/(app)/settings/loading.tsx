export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="animate-pulse">
        <div className="mb-2 h-7 w-28 rounded bg-[var(--muted)]" />
        <div className="h-4 w-36 rounded bg-[var(--muted)]" />
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-0">
        {[...Array(7)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-[var(--border)] px-4 py-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--muted)]" />
            <div className="h-4 w-20 animate-pulse rounded bg-[var(--muted)]" />
            <div className="h-4 w-16 animate-pulse rounded bg-[var(--muted)]" />
            <div className="ml-auto h-5 w-14 animate-pulse rounded-full bg-[var(--muted)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
