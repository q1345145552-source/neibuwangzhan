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
  recalled: number;
  rule_id?: number | null;
  converted_rule_id?: number | null;
  recipients: Recipient[];
}

const STATUS_COLOR: Record<string, string> = {
  待读: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  已读待复述: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  已复述待确认: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  已确认: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  需重述: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  逾期: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  已撤回: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
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

  // 管理员复核
  const [reviewRec, setReviewRec] = useState<Recipient | null>(null);
  const [aiConclusion, setAiConclusion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [reviewErr, setReviewErr] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  // 编辑通知（管理员）
  const [editTarget, setEditTarget] = useState<Announcement | null>(null);
  const [editForm, setEditForm] = useState({ title: "", body: "", type: "短通知", deadline: "" });
  const [editAttachments, setEditAttachments] = useState<string[]>([]);
  const [editSendAll, setEditSendAll] = useState(false);
  const [editSelected, setEditSelected] = useState<string[]>([]);
  const [editUploading, setEditUploading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [converting, setConverting] = useState(false);

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

  // 从剪贴板事件里取出图片文件（没有图片返回空数组）
  const getPastedImages = (e: React.ClipboardEvent): File[] => {
    const items = e.clipboardData?.items;
    if (!items) return [];
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  };

  // 上传一批图片文件（与点按钮上传走同一个接口），返回成功的 url 列表
  const uploadImageFiles = async (files: File[]): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        if (data.url) urls.push(data.url);
      }
    }
    return urls;
  };

  // 新建表单粘贴截图：有图片就自动上传，纯文字粘贴不拦截
  const handleFormPaste = async (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    setUploading(true);
    try {
      const urls = await uploadImageFiles(files);
      if (urls.length > 0) setAttachments((prev) => [...prev, ...urls]);
    } catch { setErr("附件上传失败"); }
    finally { setUploading(false); }
  };

  // 编辑表单粘贴截图：有图片就自动上传，纯文字粘贴不拦截
  const handleEditPaste = async (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    setEditUploading(true);
    try {
      const urls = await uploadImageFiles(files);
      if (urls.length > 0) setEditAttachments((prev) => [...prev, ...urls]);
    } catch { setEditErr("附件上传失败"); }
    finally { setEditUploading(false); }
  };

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

  // 管理员：打开某员工复核
  const openReview = (rec: Recipient) => {
    setReviewRec(rec);
    setAiConclusion("");
    setRejectComment("");
    setReviewErr("");
  };

  const runAiCompare = async () => {
    if (!detail || !reviewRec) return;
    setAiLoading(true);
    setAiConclusion("");
    try {
      const res = await fetchWithAuth(`/api/announcements/${detail.id}/ai-compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: reviewRec.employee_name }),
      });
      const d = await res.json();
      if (!res.ok) setAiConclusion("比对失败：" + (d.error || "未知错误"));
      else setAiConclusion(d.conclusion || "");
    } catch {
      setAiConclusion("比对失败：网络错误");
    } finally {
      setAiLoading(false);
    }
  };

  const doReview = async (action: "confirm" | "reject") => {
    if (!detail || !reviewRec) return;
    if (action === "reject" && !rejectComment.trim()) { setReviewErr("请填写打回批注"); return; }
    setReviewSaving(true);
    const ok = await apiCall(`/api/announcements/${detail.id}/review`, {
      method: "PATCH",
      body: { employee_name: reviewRec.employee_name, action, comment: rejectComment.trim() },
      onError: (m) => setReviewErr(m),
    });
    setReviewSaving(false);
    if (ok) {
      setReviewErr("");
      setRejectComment("");
      load();
      try {
        const res = await fetchWithAuth(`/api/announcements/${detail.id}`, { cache: "no-store" });
        const d = await res.json();
        if (res.ok) {
          setDetail(d);
          const rec = d.recipients?.find((r: any) => r.employee_name === reviewRec.employee_name);
          if (rec) setReviewRec(rec);
        }
      } catch {}
    }
  };

  // 撤回
  const handleRecall = async (a: Announcement) => {
    const ok = await apiCall(`/api/announcements/${a.id}/recall`, { method: "PATCH" });
    if (ok) { load(); setDetailOpen(false); setReviewRec(null); }
  };

  // 删除（先确认）
  const handleDelete = async (a: Announcement) => {
    if (!confirm(`确定删除通知「${a.title}」？删除后员工那边也彻底看不到了。`)) return;
    const ok = await apiCall(`/api/announcements/${a.id}`, { method: "DELETE" });
    if (ok) { load(); setDetailOpen(false); setReviewRec(null); }
  };

  // 编辑
  const openEdit = (a: Announcement) => {
    setEditTarget(a);
    setEditForm({ title: a.title, body: a.body, type: a.type, deadline: a.deadline });
    setEditAttachments(parseAttachments(a.attachments));
    const curNames = new Set(a.recipients.map((r) => r.employee_name));
    const empNames = new Set(employees.map((e) => e.name));
    const isAll = curNames.size === empNames.size && empNames.size > 0 && [...curNames].every((n) => empNames.has(n));
    setEditSendAll(isAll);
    setEditSelected(isAll ? [] : [...curNames]);
    setEditErr("");
  };

  const handleEditUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setEditUploading(true);
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
      if (urls.length > 0) setEditAttachments((prev) => [...prev, ...urls]);
    } catch { setEditErr("附件上传失败"); }
    finally { setEditUploading(false); e.target.value = ""; }
  };

  const removeEditAttachment = (url: string) => setEditAttachments((prev) => prev.filter((u) => u !== url));
  const toggleEditEmployee = (name: string) => setEditSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editForm.title.trim()) { setEditErr("请填写标题"); return; }
    if (!editForm.body.trim()) { setEditErr("请填写正文"); return; }
    if (!editForm.deadline) { setEditErr("请填写截止时间"); return; }
    if (!editSendAll && editSelected.length === 0) { setEditErr("请选择接收人"); return; }
    setEditSaving(true);
    const ok = await apiCall(`/api/announcements/${editTarget.id}`, {
      method: "PATCH",
      body: {
        title: editForm.title.trim(),
        body: editForm.body,
        attachments: editAttachments,
        type: editForm.type,
        recipients: editSendAll ? "all" : editSelected,
        deadline: editForm.deadline,
      },
      onError: (m) => setEditErr(m),
    });
    setEditSaving(false);
    if (ok) { setEditTarget(null); setEditErr(""); load(); setDetailOpen(false); setReviewRec(null); }
  };

  // 长通知转成规则
  const convertToRule = async (a: Announcement) => {
    setConverting(true);
    const ok = await apiCall(`/api/announcements/${a.id}/to-rule`, { method: "POST" });
    setConverting(false);
    if (ok) {
      try {
        const res = await fetchWithAuth(`/api/announcements/${a.id}`, { cache: "no-store" });
        const d = await res.json();
        if (res.ok) setDetail(d);
      } catch {}
    }
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
    if (a.recalled) return "已撤回";
    const st = myStatusOf(a);
    if (st === "需重述") return "需重述";
    if (isOverdue(a)) return "逾期";
    return st;
  };

  // 管理员：逾期人数 / 需重述人数
  const bangkokNowStr = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  const adminOverdueCount = (a: Announcement) => {
    if (a.recalled || !a.deadline) return 0;
    return a.recipients.filter((r) => r.status !== "已确认" && r.status !== "已复述待确认" && a.deadline.replace("T", " ") < bangkokNowStr()).length;
  };
  const adminRetellDueCount = (a: Announcement) => (a.recalled ? 0 : a.recipients.filter((r) => r.status === "需重述").length);
  const isUrgent = (a: Announcement) => {
    if (isAdmin) return adminOverdueCount(a) > 0 || adminRetellDueCount(a) > 0;
    return !!a.recalled || isOverdue(a) || displayStatus(a) === "需重述";
  };

  // 列表排序：逾期/需重述 排前面，再按截止时间近的在前
  const sortedList = [...announcements].sort((a, b) => {
    const urgentA = isUrgent(a) ? 1 : 0;
    const urgentB = isUrgent(b) ? 1 : 0;
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
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} onPaste={handleFormPaste} placeholder="通知标题" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">正文 <span className="text-[var(--destructive)]">*</span></label>
              <textarea value={form.body} onChange={(e) => setForm((p) => ({ ...p, body: e.target.value }))} onPaste={handleFormPaste} rows={5} placeholder="通知内容" className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
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
            const urgent = isUrgent(a);
            return (
              <div
                key={a.id}
                className={cn("rounded-xl border border-[var(--border)] bg-[var(--background)]", urgent && "border-red-300 bg-red-50/50 dark:border-red-900/60 dark:bg-red-950/20")}
              >
                <button onClick={() => openDetail(a)} className="w-full p-4 text-left transition-colors hover:bg-[var(--muted)]/20">
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
                          截止 {a.deadline?.replace("T", " ").slice(0, 16)} · 发给 {a.recipients.length} 人 · 已确认 {a.recipients.filter((r) => r.status === "已确认").length} · 没复述 {a.recipients.filter((r) => ["待读", "已读待复述", "需重述"].includes(r.status)).length} · 逾期 {adminOverdueCount(a)}
                        </p>
                      )}
                    </div>
                    {isAdmin ? (
                      a.recalled ? (
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR["已撤回"])}>已撤回</span>
                      ) : (
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR["已确认"] || "bg-green-100 text-green-700")}>
                          已确认 {a.recipients.filter((r) => r.status === "已确认").length}/{a.recipients.length}
                        </span>
                      )
                    ) : (
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[st] || "bg-gray-100 text-gray-600")}>{st}</span>
                    )}
                  </div>
                </button>
                {isAdmin && a.created_by === user?.name && (
                  <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2">
                    {!a.recalled && (
                      <button onClick={() => handleRecall(a)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">撤回</button>
                    )}
                    {!a.recalled && (
                      <button onClick={() => openEdit(a)} className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">编辑</button>
                    )}
                    <button onClick={() => handleDelete(a)} className="text-xs text-[var(--destructive)] hover:opacity-80">删除</button>
                  </div>
                )}
              </div>
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
            {isAdmin && detail.type === "长通知" && !detail.recalled && (
              <div className="mt-3">
                {detail.converted_rule_id ? (
                  <span className="text-xs text-[var(--muted-foreground)]">已转成规则</span>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => convertToRule(detail)} disabled={converting}>
                    {converting ? "转换中…" : "转成规则"}
                  </Button>
                )}
              </div>
            )}
            {detail.recalled ? (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                该通知已撤回
              </div>
            ) : null}
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">{detail.body}</p>
            {parseAttachments(detail.attachments).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {parseAttachments(detail.attachments).map((url) => (
                  <img key={url} src={fileUrl(url)} alt="" className="h-16 w-16 cursor-pointer rounded-md border border-[var(--border)] object-cover" onClick={() => window.open(fileUrl(url), "_blank")} />
                ))}
              </div>
            )}

            {isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <h4 className="text-sm font-medium">接收人状态（{detail.recipients?.length || 0} 人）</h4>
                {(!detail.recipients || detail.recipients.length === 0) ? (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">暂无接收人</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {detail.recipients.map((r: Recipient) => (
                      <button key={r.id} onClick={() => openReview(r)} className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--primary)]">
                        <span className="truncate font-medium">{r.employee_name}</span>
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[r.status] || "bg-gray-100 text-gray-600")}>{r.status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                {detail.recalled ? (
                  <p className="text-sm text-[var(--muted-foreground)]">该通知已撤回，无需复述。</p>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 管理员复核单个员工弹窗 */}
      {reviewRec && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setReviewRec(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">{reviewRec.employee_name}</h3>
                <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLOR[reviewRec.status] || "bg-gray-100 text-gray-600")}>{reviewRec.status}</span>
              </div>
              <button onClick={() => setReviewRec(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {reviewRec.reject_comment && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                当前批注：{reviewRec.reject_comment}
              </div>
            )}

            <div className="mt-3 space-y-2 text-sm">
              <p className="text-[var(--muted-foreground)]">泰语复述：</p>
              <p className="rounded bg-[var(--muted)]/30 p-2 whitespace-pre-wrap break-words">{reviewRec.retell_th || "—"}</p>
              <p className="text-[var(--muted-foreground)]">中文复述：</p>
              <p className="rounded bg-[var(--muted)]/30 p-2 whitespace-pre-wrap break-words">{reviewRec.retell_zh || "—"}</p>
            </div>

            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={runAiCompare} disabled={aiLoading || !reviewRec.retell_zh?.trim() || !!detail?.recalled}>
                {aiLoading ? "AI 比对中…" : "AI 比对复述"}
              </Button>
              {aiConclusion && (
                <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-sm whitespace-pre-wrap break-words">
                  {aiConclusion}
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <label className="text-xs font-medium">打回批注（标不对时必填）</label>
              <textarea value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} rows={2} placeholder="哪里理解错了，说清楚让员工重述" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              {reviewErr && <p className="mt-2 text-xs text-[var(--destructive)]">{reviewErr}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => doReview("confirm")} disabled={reviewSaving || reviewRec.status === "已确认" || !!detail?.recalled}>标对（已确认）</Button>
                <Button size="sm" variant="destructive" onClick={() => doReview("reject")} disabled={reviewSaving || !!detail?.recalled}>标不对（需重述）</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 编辑通知弹窗 */}
      {editTarget && isAdmin && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditTarget(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">编辑通知</h3>
              <button onClick={() => setEditTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">标题 <span className="text-[var(--destructive)]">*</span></label>
                <input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} onPaste={handleEditPaste} placeholder="通知标题" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">正文 <span className="text-[var(--destructive)]">*</span></label>
                <textarea value={editForm.body} onChange={(e) => setEditForm((p) => ({ ...p, body: e.target.value }))} onPaste={handleEditPaste} rows={5} placeholder="通知内容" className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs font-medium">类型</label>
                <select value={editForm.type} onChange={(e) => setEditForm((p) => ({ ...p, type: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="短通知">短通知</option>
                  <option value="长通知">长通知</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">截止时间 <span className="text-[var(--destructive)]">*</span></label>
                <input type="datetime-local" value={editForm.deadline} onChange={(e) => setEditForm((p) => ({ ...p, deadline: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">附件（图片/文件，可多个）</label>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm hover:bg-[var(--muted)]/30">
                    <ImagePlus className="size-4" />{editUploading ? "上传中…" : "上传附件"}
                    <input type="file" multiple className="hidden" onChange={handleEditUpload} disabled={editUploading} />
                  </label>
                  {editAttachments.map((url) => (
                    <div key={url} className="relative">
                      <img src={fileUrl(url)} alt="" className="h-12 w-12 rounded-md border border-[var(--border)] object-cover" />
                      <button type="button" onClick={() => removeEditAttachment(url)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--destructive)] text-white" title="移除"><X className="size-3" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">接收人 <span className="text-[var(--destructive)]">*</span></label>
                <label className="mt-1 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editSendAll} onChange={(e) => { setEditSendAll(e.target.checked); if (e.target.checked) setEditSelected([]); }} className="size-4" />
                  发送给全体在职员工
                </label>
                {!editSendAll && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-[var(--border)] p-2">
                    {employees.length === 0 ? (
                      <p className="py-3 text-center text-xs text-[var(--muted-foreground)]">暂无在职员工</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {employees.map((e) => (
                          <label key={e.id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm hover:bg-[var(--muted)]/30">
                            <input type="checkbox" checked={editSelected.includes(e.name)} onChange={() => toggleEditEmployee(e.name)} className="size-4" />
                            <span className="truncate">{e.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">编辑后所有接收人的复述状态会重置为「待读」，之前逾期待办会清掉并按新截止时间重新判定。</p>
            {editErr && <p className="mt-2 text-xs text-[var(--destructive)]">{editErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submitEdit} disabled={editSaving}>{editSaving ? "保存中…" : "保存"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
