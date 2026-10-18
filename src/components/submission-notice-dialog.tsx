"use client";

import { useEffect, useRef, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { toThaiTime } from "@/lib/utils";

interface SubmissionNotice {
  id: number; title: string; body: string; created_at: string; is_read: number;
}

export function SubmissionNoticeDialog({ notice, href, onClose, onConfirmed }: {
  notice: SubmissionNotice; href: string; onClose: () => void; onConfirmed: (id: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function confirm() {
    if (inFlight.current || notice.is_read) return;
    inFlight.current = true; setSaving(true); setError("");
    try {
      const response = await fetchWithAuth("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: notice.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "确认观看失败，请重试");
      onConfirmed(notice.id);
    } catch (e) { setError(e instanceof Error ? e.message : "确认观看失败，请重试"); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <dialog ref={dialogRef} aria-labelledby="submission-notice-title" aria-describedby="submission-notice-hint"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}
    style={{ width: "calc(100% - 2rem)" }}
    className="m-auto max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 text-[var(--foreground)] shadow-2xl backdrop:bg-black/40">
    <div className="flex items-start justify-between gap-3">
      <h2 id="submission-notice-title" className="pt-2 text-lg font-semibold">这条通知已观看</h2>
      <button type="button" autoFocus onClick={onClose} aria-label="关闭通知弹窗" className="flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-[var(--muted)]"><X aria-hidden="true" className="size-5" /></button>
    </div>
    <p id="submission-notice-hint" className="mt-2 text-sm text-[var(--muted-foreground)]">只有点击“确认观看”才会标记已观看；关闭弹窗或去处理不会自动确认。</p>
    <div className="my-4 min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold [overflow-wrap:anywhere]">{notice.title}</h3>
      <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{notice.body}</p>
      <p className="text-xs text-[var(--muted-foreground)]">通知时间：<time dateTime={notice.created_at}>{toThaiTime(notice.created_at)}</time></p>
    </div>
    {notice.is_read ? <p role="status" className="mb-3 text-sm text-emerald-600">已确认观看</p> : null}
    {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <Button type="button" disabled={saving || !!notice.is_read} onClick={() => void confirm()} className="min-h-11">{notice.is_read ? "已确认观看" : saving ? "确认中…" : "确认观看"}</Button>
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]">去处理<ExternalLink aria-hidden="true" className="size-4" /></a>
    </div>
  </dialog>;
}
