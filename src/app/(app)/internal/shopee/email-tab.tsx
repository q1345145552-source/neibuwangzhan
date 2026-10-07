"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { toThaiTime } from "@/lib/utils";
import { Plus, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

interface EmailFlow {
  id: number;
  type: "增加" | "减少";
  qty: number;
  note: string;
  operator: string;
  created_at: string;
}

const TYPE_BADGE: Record<EmailFlow["type"], string> = {
  增加: "bg-emerald-500/15 text-emerald-600",
  减少: "bg-red-500/15 text-red-600",
};

export function EmailTab() {
  const [remaining, setRemaining] = useState(0);
  const [flows, setFlows] = useState<EmailFlow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "增加" as EmailFlow["type"], qty: "", note: "" });
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const res = await fetchWithAuth("/api/email-stock", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setRemaining(data.remaining_qty ?? 0);
      setFlows(data.flows ?? []);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const openForm = (type: EmailFlow["type"]) => {
    setForm({ type, qty: "", note: "" });
    setErr("");
    setShowForm(true);
  };

  const submit = async () => {
    const n = Number(form.qty);
    if (!Number.isInteger(n) || n <= 0) { setErr("数量必须是正整数"); return; }
    const ok = await apiCall("/api/email-stock", {
      method: "POST",
      body: { type: form.type, qty: n, note: form.note.trim() },
      onError: (m) => setErr(m),
    });
    if (ok) { setShowForm(false); setErr(""); load(); }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 剩余数量 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
        <div className="text-xs text-[var(--muted-foreground)]">剩余可用邮箱数量</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-[var(--foreground)]">{remaining}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openForm("增加")}><ArrowDownToLine className="size-3.5" />增加</Button>
          <Button size="sm" variant="outline" onClick={() => openForm("减少")}><ArrowUpFromLine className="size-3.5" />减少</Button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">{form.type}邮箱库存</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">数量</label>
              <input value={form.qty} onChange={(e) => setForm((p) => ({ ...p, qty: e.target.value }))}
                type="number" min="1" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">用途备注</label>
              <input value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="选填"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submit}>确认{form.type}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      {/* 流水 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-medium">增减流水</div>
        {flows.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">暂无流水记录</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">时间</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">数量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">用途备注</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 text-[var(--muted-foreground)] whitespace-nowrap">{toThaiTime(f.created_at) || f.created_at}</td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[f.type]}`}>{f.type}</span>
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">{f.qty}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{f.note || "—"}</td>
                    <td className="py-2.5 px-4">{f.operator || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {flows.map((f) => (
                <div key={f.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[f.type]}`}>{f.type}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{toThaiTime(f.created_at) || f.created_at}</span>
                  </div>
                  <div className="mt-2 text-lg font-semibold tabular-nums">{f.qty}</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">用途备注</span><span className="text-right">{f.note || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">操作人</span><span>{f.operator || "—"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
