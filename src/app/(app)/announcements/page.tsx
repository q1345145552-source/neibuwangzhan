"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, fileUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, ImagePlus } from "lucide-react";

interface Recipient {
  id: number;
  employee_name: string;
  status: string;
  retell_th?: string;
  retell_zh?: string;
  reject_comment?: string;
}
interface Announcement {
  id: number;
  title: string;
  body: string;
  attachments: string;
  type: string;
  deadline: string;
  created_by: string;
  created_at: string;
  recipients: Recipient[];
}

const STATUS_COLOR: Record<string, string> = {
  待读: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  已读待复述: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  已复述待确认: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  已确认: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  需重述: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  逾期: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function parseAttachments(s: string): string[] {
  try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}

export default function AnnouncementsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // 新建通知（管理员）
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", body: "", type: "短通知", deadline: "" });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sendAll, setSendAll] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // 详情 + 复述（员工）
  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retellTh, setRetellTh] = useState("");
  const [retellZh, setRetellZh] = useState("");
  const [retellSaving, setRetellSaving] = useState(false);
  const [retellErr, setRetellErr] = useState("");

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/announcements", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAnnouncements(Array.isArray(d) ? d : []))
      .catch(() => setAnnouncements([]))
      .finally(() => setLoading(false));
  };

  const loadEmployees = () => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEmployees((Array.isArray(d) ? d : []).filter((e: any) => e.role === "employee" && e.status === "在职")))
      .catch(() => {});
  };

  useEffect(() => { load(); loadEmployees(); }, [isAdmin]);

  const openForm = () => {
    setForm({ title: "", body: "", type: "短通知", deadline: "" });
    setAttachments([]);
    setSendAll(false);
    setSelectedEmployees([]);
    setErr("");
    setShowForm(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json();
          if (data.url) urls.push(data.url);
        }
      }
      if (urls.length > 0) setAttachments((prev) => [...prev, ...urls]);
    } catch { setErr("附件上传失败"); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const removeAttachment = (url: string) => setAttachments((prev) => prev.filter((u) => u !== url));

  const toggleEmployee = (name: string) => {
    setSelectedEmployees((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const submit = async () => {
    if (!form.title.trim()) { setErr("请填写标题"); return; }
    if (!form.body.trim()) { setErr("请填写正文"); return; }
    if (!form.deadline) { setErr("请填写截止时间"); return; }
    if (!sendAll && selectedEmployees.length === 0) { setErr("请选择接收人"); return; }
    setSaving(true);
    const ok = await apiCall("/api/announcements", {
      method: "POST",
      body: {
        title: form.title.trim(),
        body: form.body,
        attachments,
        type: form.type,
        recipients: sendAll ? "all" : selectedEmployees,
        deadline: form.deadline,
      },
      onError: (m) => setErr(m),
    });
    setSaving(false);
    if (ok) { setShowForm(false); setErr(""); load(); }
  };

  // 打开详情：员工打开即标记已读
  const openDetail = async (a: Announcement) => {
    try {
      const res = await fetchWithAuth(`/api/announcements/${a.id}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) { setDetail(a); }
      else {
        setDetail(d);
        const rec = d.my_recipient;
        if (rec) {
          setRetellTh(rec.retell_th || "");
          setRetellZh(rec.retell_zh || "");
        } else {
          setRetellTh(""); setRetellZh("");
        }
      }
    } catch { setDetail(a); }
    setRetellErr("");
    setDetailOpen(true);
  };

  const submitRetell = async () => {
    if (!detail) return;
    if (!retellTh.trim()) { setRetellErr("请填写泰语复述"); return; }
    if (!retellZh.trim()) { setRetellErr("请填写中文复述"); return; }
    setRetellSaving(true);
    const ok = await apiCall(`/api/announcements/${detail.id}/retell`, {
      method: "PATCH",
      body: { retell_th: retellTh.trim(), retell_zh: retellZh.trim() },
      onError: (m) => setRetellErr(m),
    });
    setRetellSaving(false);
    if (ok) { setRetellErr(""); load(); openDetail(detail as Announcement); }
  };

  // 员工：每个通知的「我的状态」+ 是否逾期
  const myStatusOf = (a: Announcement) => {
    return a.recipients?.find((r) => r.employee_name === user?.name)?.status || "待读";
  };
  const isOverdue = (a: Announcement) => {
    const st = myStatusOf(a);
    if (st === "已复述待确认" || st === "已确认") return false;
    if (!a.deadline) return false;
    // 截止时间按曼谷本地时间比较
    const now = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
    return a.deadline.replace("T", " ") < now;
  };
  const displayStatus = (a: Announcement): string => {
    const st = myStatusOf(a);
    if (st === "需重述") return "需重述";
    if (isOverdue(a)) return "逾期";
    return st;
  };

  // 员工列表排序：逾期/需重述 排前面，再按截止时间近的在前
  const sortedList = [...announcements].sort((a, b) => {
    const urgentA = isOverdue(a) || displayStatus(a) === "需重述" ? 1 : 0;
    const urgentB = isOverdue(b) || displayStatus(b) === "需重述" ? 1 : 0;
    if (urgentA !== urgentB) return urgentB - urgentA;
    return (a.deadline || "").localeCompare(b.deadline || "");
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">通知</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">老板向下发工作交代，员工收到后复述确认</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openForm} className="gap-1.5">
            <Plus className="size-3.5" />新建通知
          </Button>
        )}
      </div>

      {showForm && isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">新建通知</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">标题 <span className="text-[var(--destructive)]">*</span></label>
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="通知标题" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">正文 <span className="text-[var(--destructive)]">*</span></label>
              <textarea value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} rows={5} placeholder="通知内容" className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">类型</label>
              <select value={form.type} onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="短通知">短通知</option>
                <option value="长通知">长通知</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">截止时间 <span className="text-[var(--destructive)]">*</span></label>
              <input type="datetime-local" value={form.deadline} onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">附件（图片/文件，可多个）</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm hover:bg-[var(--muted)]/30">
                  <ImagePlus className="size-4" />{uploading ? "上传中…" : "上传附件"}
                  <input type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
                </label>
                {attachments.map((url) => (
                  <div key={url} className="relative">
                    <img src={fileUrl(url)} alt="" className="h-12 w-12 rounded-md border border-[var(--border)] object-cover" />
                    <button type="button" onClick={() => removeAttachment(url)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--destructive)] text-white" title="移除"><X className="size-3" /></button>
                  </div>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">接收人 <span className="text-[var(--destructive)]">*</span></label>
              <label className="mt-1 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sendAll} onChange={(e) => { setSendAll(e.target.checked); if (e.target.checked) setSelectedEmployees([]); }} className="size-4" />
                发送给全体在职员工
              </label>
              {!sendAll && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                  {employees.length === 0 ? (
                    <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">暂无在职员工</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {employees.map((e) => (
                        <label key={e.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-[var(--muted)]/30">
                          <input type="checkbox" checked={selectedEmployees.includes(e.name)} onChange={() => toggleEmployee(e.name)} className="size-4" />
                          <span className="truncate">{e.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={submit} disabled={saving}>{saving ? "发送中…" : "发送"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : sortedList.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无通知</p>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedList.map((a) => {
            const st = displayStatus(a);
            const urgent = isOverdue(a) || st === "需重述";
            return (
              <button
                key={a.id}
                onClick={() => openDetail(a)}
                className={cn("rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--primary)]", urgent && "border-red-300 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", a.type === "长通知" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300")}>{a.type}</span>
                      <span className="truncate text-sm font-semibold text-[var(--foreground)]">{a.title}</span>
                    </div>
                    {!isAdmin && (
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">截止：{a.deadline?.replace("T", " ").slice(0, 16)}</p>
                    )}
                    {isAdmin && (
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        截止 {a.deadline?.replace("T", " ").slice(0, 16)} · 接收 {a.recipients.length} 人 · 待读 {a.recipients.filter((r) => r.status === "待读").length} 人
                      </p>
                    )}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[st] || "bg-gray-100 text-gray-600")}>{st}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailOpen && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{detail.title}</h3>
              <button onClick={() => setDetailOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{detail.type}</span>
              <span>截止：{detail.deadline?.replace("T", " ").slice(0, 16)}</span>
              <span>发送人：{detail.created_by}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">{detail.body}</p>
            {parseAttachments(detail.attachments).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {parseAttachments(detail.attachments).map((url) => (
                  <img key={url} src={fileUrl(url)} alt="" className="h-16 w-16 cursor-pointer rounded-md border border-[var(--border)] object-cover" onClick={() => window.open(fileUrl(url), "_blank")} />
                ))}
              </div>
            )}

            {!isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <h4 className="text-sm font-medium">我的复述</h4>
                {detail.my_recipient?.status === "需重述" && detail.my_recipient?.reject_comment && (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                    管理员批注：{detail.my_recipient.reject_comment}
                  </div>
                )}
                {detail.my_recipient?.status === "已复述待确认" || detail.my_recipient?.status === "已确认" ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <p className="text-[var(--muted-foreground)]">泰语：</p>
                    <p className="rounded bg-[var(--muted)]/30 p-2 whitespace-pre-wrap break-words">{detail.my_recipient.retell_th || "—"}</p>
                    <p className="text-[var(--muted-foreground)]">中文：</p>
                    <p className="rounded bg-[var(--muted)]/30 p-2 whitespace-pre-wrap break-words">{detail.my_recipient.retell_zh || "—"}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">当前状态：{detail.my_recipient.status}</p>
                  </div>
                ) : (
                  <>
                    <div className="mt-3">
                      <label className="text-xs font-medium">泰语复述 <span className="text-[var(--destructive)]">*</span></label>
                      <textarea value={retellTh} onChange={(e) => setRetellTh(e.target.value)} rows={3} placeholder="用你自己的话把要办的事重新写一遍（泰语）" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                    <div className="mt-3">
                      <label className="text-xs font-medium">中文复述 <span className="text-[var(--destructive)]">*</span></label>
                      <textarea value={retellZh} onChange={(e) => setRetellZh(e.target.value)} rows={3} placeholder="会中文自己写，不会的用翻译器翻好写上来（中文）" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                    {retellErr && <p className="mt-2 text-xs text-[var(--destructive)]">{retellErr}</p>}
                    <Button size="sm" onClick={submitRetell} disabled={retellSaving} className="mt-3">{retellSaving ? "提交中…" : "提交复述"}</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
