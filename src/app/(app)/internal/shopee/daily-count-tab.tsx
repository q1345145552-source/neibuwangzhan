"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { bangkokToday } from "@/lib/time";
import { Plus, Trash2, Edit3 } from "lucide-react";

interface DailyRecord {
  id: number;
  date: string;
  qty: number;
  created_by: string;
  created_at: string;
}

interface DailyCountTabProps {
  apiPath: string;
  countLabel: string;
  emptyText: string;
  addTitle: string;
}

export function DailyCountTab({ apiPath, countLabel, emptyText, addTitle }: DailyCountTabProps) {
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ date: "", qty: "" });
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const res = await fetchWithAuth(apiPath, { cache: "no-store" });
      if (!res.ok) return;
      setRecords(await res.json());
    } catch {}
  };

  useEffect(() => { load(); }, [apiPath]);

  const openCreate = () => {
    setEditId(null);
    setForm({ date: bangkokToday(), qty: "" });
    setErr("");
    setShowForm(true);
  };

  const openEdit = (r: DailyRecord) => {
    setEditId(r.id);
    setForm({ date: r.date, qty: String(r.qty) });
    setErr("");
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.date) { setErr("请选择日期"); return; }
    const n = Number(form.qty);
    if (!Number.isInteger(n) || n < 0) { setErr(`${countLabel}必须是非负整数`); return; }
    const ok = await apiCall(apiPath, {
      method: editId ? "PATCH" : "POST",
      body: editId ? { id: editId, date: form.date, qty: n } : { date: form.date, qty: n },
      onError: (m) => setErr(m),
    });
    if (ok) { setShowForm(false); setErr(""); load(); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除这条记录？")) return;
    const ok = await apiCall(`${apiPath}?id=${id}`, { method: "DELETE" });
    if (ok) load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="size-3.5" />{addTitle}</Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">{editId ? "编辑记录" : addTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">日期</label>
              <input value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                type="date"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">{countLabel}</label>
              <input value={form.qty} onChange={(e) => setForm((p) => ({ ...p, qty: e.target.value }))}
                type="number" min="0" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submit}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        {records.length === 0 ? (
          <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">{emptyText}</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">日期</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">{countLabel}</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 tabular-nums">{r.date}</td>
                    <td className="py-2.5 px-4 tabular-nums font-medium">{r.qty}</td>
                    <td className="py-2.5 px-4 flex gap-1.5">
                      <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(r)}><Edit3 className="size-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(r.id)}><Trash2 className="size-3" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {records.map((r) => (
                <div key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular-nums font-medium text-[var(--foreground)]">{r.date}</span>
                    <span className="text-lg font-semibold tabular-nums">{r.qty}</span>
                  </div>
                  <div className="mt-3 flex justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => openEdit(r)}><Edit3 className="size-3" /></Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs text-red-500" onClick={() => handleDelete(r.id)}><Trash2 className="size-3" /></Button>
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
