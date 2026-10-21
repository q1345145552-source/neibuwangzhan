"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";
import { fetchWithAuth } from "@/lib/api";
import { notifyOpenChat } from "@/lib/chat-nav";
import type { TaskMessageResponse, TaskMessageResult, TaskMessageType } from "@/lib/chat-task-message-types";

/** ownerNames仅用于隐藏自己的按钮；真实收件人始终由服务端核定。 */
export function TaskMessageButton({ type, id, ownerNames, ownerId }: {
  type: TaskMessageType; id: number; ownerNames: string[]; ownerId?: number | null;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const dialogTitleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const lock = useRef(false);
  const action = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<TaskMessageResult[]>([]);
  const [multiple, setMultiple] = useState(false);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  if (!user || user.role === "client") return null;
  const owners = [...new Set(ownerNames.map(name => name.trim()).filter(Boolean))];
  const self = type === "notice" && ownerId != null ? ownerId === user.id : owners.length === 1 && owners[0] === user.name;
  if (self) return null;

  const enter = (result: TaskMessageResult) => {
    if (result.status !== "sent" || !result.messageId) return;
    notifyOpenChat({ kind: "direct", name: result.name, messageId: result.messageId });
    setOpen(false);
    router.push("/messages");
  };
  const send = async (fresh: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setOpen(true); setError("");
    try {
      if (fresh || !action.current) {
        action.current = crypto.randomUUID();
        setResults([]);
      }
      const response = await fetchWithAuth("/api/chat/task-message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id, action: action.current }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "发送失败，请重试本次发送");
      const data = body as TaskMessageResponse;
      if (!Array.isArray(data.results) || !data.results.length) throw new Error("未收到发送结果，请重试本次发送");
      setResults(data.results); setMultiple(data.multiple);
      if (!data.multiple && data.results[0].status === "sent") enter(data.results[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络异常，请重试本次发送");
    } finally { lock.current = false; setBusy(false); }
  };
  const failed = results.some(result => result.status === "failed");
  return <>
    <button type="button" className="min-h-11 min-w-16 rounded-md border border-blue-500/30 px-3 text-sm text-blue-600 hover:bg-blue-500/10 disabled:opacity-50" disabled={busy} onClick={event => {
      event.preventDefault(); event.stopPropagation();
      if (action.current) setOpen(true);
      else void send(true);
    }}>消息</button>
    <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby={dialogTitleId} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-[var(--foreground)] shadow-xl backdrop:bg-black/50" onClick={event => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={dialogTitleId} className="font-semibold">任务消息</h2>
        <button type="button" className="min-h-11 px-3 text-sm" onClick={() => setOpen(false)}>关闭</button>
      </div>
      {busy && <p role="status" className="mt-3 text-sm">正在发送，请稍候…</p>}
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-600">{error}</p>}
      {!!results.length && <ul className="mt-3 space-y-3">
        {results.map(result => <li key={result.key} className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <p className="break-words font-medium">{result.name}</p>
          <p className={`mt-1 break-words ${result.status === "sent" ? "text-green-600" : "text-red-600"}`}>{result.status === "sent" ? "已发送" : result.error}</p>
          {result.status === "sent" && <button type="button" disabled={busy} className="mt-2 min-h-11 rounded-md border border-blue-500/30 px-3 text-blue-600" onClick={() => enter(result)}>进入与{result.name}的聊天</button>}
        </li>)}
      </ul>}
      {multiple && <p className="mt-3 text-sm text-[var(--muted-foreground)]">{results.some(result => result.status === "sent") ? "请从已发送的负责人中选择要进入的聊天。" : "尚未发送成功，请核对错误后重试。"}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {(failed || error) && <button type="button" disabled={busy} className="min-h-11 rounded-md bg-blue-600 px-3 text-sm text-white disabled:opacity-50" onClick={() => void send(false)}>{results.some(result => result.status === "sent") ? "重试失败项" : "重试本次发送"}</button>}
        {!!results.length && !busy && <button type="button" className="min-h-11 rounded-md border border-[var(--border)] px-3 text-sm" onClick={() => void send(true)}>{multiple ? "重新发送给全部" : "重新发送"}</button>}
      </div>
    </dialog>
  </>;
}
