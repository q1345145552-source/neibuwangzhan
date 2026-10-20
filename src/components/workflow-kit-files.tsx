"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { fetchWithAuth, openAuthedFile } from "@/lib/api";
import { cn } from "@/lib/utils";

type KitFile = { id: number; kind: "说明书" | "资料收集表"; name: string; ext: string; file_url: string };
const KINDS = ["说明书", "资料收集表"] as const;

/**
 * 流程设置：这套流程给客户的固定资料（2026-10-20 老板 2A）。说明书、资料收集表每种业务一份，
 * 这种业务的订单客户在业务系统打开就能看到（新单老单都一样）；换了文件客户看到的跟着换。
 */
export function WorkflowKitFiles({ templateId }: { templateId: number }) {
  const [files, setFiles] = useState<KitFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // 只认这套流程的返回：切到别的流程后，旧流程的清单晚回来也不能显示在新流程下（父页另按流程换新组件）
  const load = useCallback(() => {
    let alive = true;
    fetchWithAuth(`/api/workflows/${templateId}/files`)
      .then(r => r.json())
      .then((d: { files?: KitFile[] }) => { if (alive) setFiles(d.files || []); })
      .catch(() => { if (alive) setFiles([]); });
    return () => { alive = false; };
  }, [templateId]);
  useEffect(() => load(), [load]);

  const upload = async (kind: typeof KINDS[number], file: File) => {
    setBusy(kind); setMessage(null);
    try {
      const form = new FormData(); form.append("file", file);
      const up = await fetchWithAuth("/api/upload", { method: "POST", body: form });
      const u = await up.json().catch(() => ({})) as { url?: string; error?: string };
      if (!up.ok || !u.url) throw new Error(u.error || "上传失败");
      const res = await fetchWithAuth(`/api/workflows/${templateId}/files`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name: file.name, file_url: u.url }),
      });
      const d = await res.json().catch(() => ({})) as { files?: KitFile[]; error?: string };
      if (!res.ok) throw new Error(d.error || "保存失败");
      setFiles(d.files || []);
      setMessage({ ok: true, text: `已加${kind}，这种业务的客户打开订单就能看到` });
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "上传失败" }); }
    finally { setBusy(null); }
  };

  const remove = async (f: KitFile) => {
    if (!window.confirm(`删掉${f.kind}「${f.name}」？客户那边也不再显示。`)) return;
    setBusy(`del-${f.id}`); setMessage(null);
    try {
      const res = await fetchWithAuth(`/api/workflows/${templateId}/files?file_id=${f.id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({})) as { files?: KitFile[]; error?: string };
      if (!res.ok) throw new Error(d.error || "删除失败");
      setFiles(d.files || []);
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "删除失败" }); }
    finally { setBusy(null); }
  };

  return (
    <div className="border-t border-[var(--border)] px-5 py-4">
      <h3 className="text-xs font-medium text-[var(--foreground)]">给客户的资料</h3>
      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">这种业务的订单，客户在业务系统打开订单就能看到、下载（新单老单都一样）。合同每单不同，在订单的「文档」里上传。</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {KINDS.map(kind => {
          const list = files.filter(f => f.kind === kind);
          return (
            <div key={kind} className="rounded-lg border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">{kind}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{list.length ? `${list.length} 份` : "还没有"}</span>
                <label className={cn("ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]", busy && "pointer-events-none opacity-50")}>
                  {busy === kind ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}上传
                  <input ref={el => { inputs.current[kind] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(kind, f); }} />
                </label>
              </div>
              {list.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {list.map(f => (
                    <li key={f.id} className="flex items-center gap-2 text-xs">
                      <FileText className="size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                      <button type="button" onClick={() => openAuthedFile(f.file_url)} className="min-w-0 flex-1 truncate text-left text-[var(--primary)] hover:underline" title={f.name}>{f.name}</button>
                      <button type="button" onClick={() => remove(f)} disabled={!!busy} title="删掉" aria-label={`删掉${f.kind}${f.name}`} className="rounded p-1 text-[var(--destructive)] hover:bg-[var(--muted)] disabled:opacity-40"><Trash2 className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {message && <p className={cn("mt-2 text-xs", message.ok ? "text-[var(--success)]" : "text-[var(--destructive)]")}>{message.text}</p>}
    </div>
  );
}
