"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, CalendarClock } from "lucide-react";

interface Meeting {
  id: number;
  title: string;
  meeting_date: string;
  meeting_time: string;
  agenda: string;
  participants: string;
  creator: string;
  created_at: string;
}

interface EmpOption { id: number; name: string; }

function parseParticipants(s: string): string[] {
  try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.map((x) => String(x)) : []; } catch { return []; }
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  // 发起会议表单
  const [formOpen, setFormOpen] = useState(false);
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formAgenda, setFormAgenda] = useState("");
  const [formParticipants, setFormParticipants] = useState<string[]>([]);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/meetings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMeetings(Array.isArray(d) ? d : []))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

  const openCreate = () => {
    setFormTitle("");
    setFormDate("");
    setFormTime("");
    setFormAgenda("");
    setFormParticipants([]);
    setFormErr("");
    setFormOpen(true);
    // 参会人：在职员工
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEmployees((Array.isArray(d) ? d : []).filter((e: any) => e.role === "employee" && e.status === "在职").map((e: any) => ({ id: e.id, name: e.name }))))
      .catch(() => setEmployees([]));
  };

  const toggleParticipant = (name: string) => {
    setFormParticipants((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));
  };

  const submit = async () => {
    if (!formTitle.trim()) { setFormErr("请填写会议主题"); return; }
    if (!formDate) { setFormErr("请选择会议日期"); return; }
    if (formParticipants.length === 0) { setFormErr("请至少勾选一名参会人"); return; }
    setSaving(true);
    const body = { title: formTitle, meeting_date: formDate, meeting_time: formTime, agenda: formAgenda, participants: formParticipants };
    const ok = await apiCall("/api/meetings", { method: "POST", body, onError: (m) => setFormErr(m) });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  const dateTimeLabel = (m: Meeting) => (m.meeting_time ? `${m.meeting_date} ${m.meeting_time}` : m.meeting_date);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">会议记录</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "发起会议通知，参会员工都能看到" : "查看你被邀请参加的会议"}</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="size-4" />发起会议
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : meetings.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{isAdmin ? "还没有会议，点右上角发起会议" : "暂无你参加的会议"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map((m) => (
            <div key={m.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <CalendarClock className="size-4 text-[var(--muted-foreground)]" />
                <span className="text-sm font-medium text-[var(--foreground)]">{m.title}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{dateTimeLabel(m)}</span>
              </div>
              {m.agenda && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{m.agenda}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {isAdmin && (
                  <span className="text-xs text-[var(--muted-foreground)]">发起人：{m.creator}</span>
                )}
                <span className="text-xs text-[var(--muted-foreground)]">参会人：</span>
                {parseParticipants(m.participants).map((p) => (
                  <span key={p} className="rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]">{p}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 发起会议弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">发起会议</h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">会议主题 <span className="text-[var(--destructive)]">*</span></label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="例如：周会 / 项目进度讨论" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">会议日期 <span className="text-[var(--destructive)]">*</span></label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">会议时间</label>
                  <input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">会议内容 / 议程</label>
                <textarea value={formAgenda} onChange={(e) => setFormAgenda(e.target.value)} rows={4} placeholder="会议要讨论什么、有哪些议程" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              <div>
                <label className="text-xs font-medium">参会人 <span className="text-[var(--destructive)]">*</span>（勾选多人）</label>
                {employees.length === 0 ? (
                  <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">暂无在职员工</p>
                ) : (
                  <div className="mt-1.5 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto">
                    {employees.map((e) => (
                      <label key={e.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm", formParticipants.includes(e.name) ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)]" : "border-[var(--border)]")}>
                        <input type="checkbox" checked={formParticipants.includes(e.name)} onChange={() => toggleParticipant(e.name)} className="size-4" />
                        <span className="truncate">{e.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "发布中…" : "发布"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
