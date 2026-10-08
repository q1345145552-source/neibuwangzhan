"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  FileEdit,
  Camera,
  Image,
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Trash2,
  Play,
} from "lucide-react";

interface IssueTicket {
  id: number; ticket_number: string; ref_id: string; ref_type: string;
  description: string; description_zh?: string; priority: string; status: string; assignee: string;
  created_by: string; resolved_by: string; withdrawn_by?: string; withdrawn_at?: string;
  created_at: string; resolved_at?: string;
  images?: string;
  resolve_screenshot?: string;
}

export default function IssuesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [issues, setIssues] = useState<IssueTicket[]>([]);
  // 工单指派人/解决人候选：老板(admin) + 普通员工，仅排除客户
  const [issueStaffNames, setIssueStaffNames] = useState<string[]>([]);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  // Resolve issue with screenshot modal
  const [resolveModal, setResolveModal] = useState<IssueTicket | null>(null);
  const [resolveScreenshotFile, setResolveScreenshotFile] = useState<File | null>(null);
  const [resolveScreenshotPreview, setResolveScreenshotPreview] = useState<string | null>(null);
  const [resolveUploading, setResolveUploading] = useState(false);
  const [resolveErr, setResolveErr] = useState("");
  const resolveScreenshotInputRef = useRef<HTMLInputElement>(null);

  // Issue form
  const [issueForm, setIssueForm] = useState({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: [] as string[] });
  const [issueImages, setIssueImages] = useState<string[]>([]);
  const [issueUploading, setIssueUploading] = useState(false);
  const [issueDetailModal, setIssueDetailModal] = useState<IssueTicket | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState("");
  const [issueErr, setIssueErr] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [issueDateFilter, setIssueDateFilter] = useState<"all"|"today"|"7"|"30"|"custom">("all");
  const [issueCustomFrom, setIssueCustomFrom] = useState("");
  const [issueCustomTo, setIssueCustomTo] = useState("");
  const [issueAssigneeFilter, setIssueAssigneeFilter] = useState("");
  const [issueCreatorFilter, setIssueCreatorFilter] = useState("");

  const safeJsonParseArray = (raw: any): string[] => {
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const loadAll = async () => {
    if (!user?.name) return;
    try {
      const res = await fetchWithAuth("/api/issues", { cache: "no-store" });
      if (!res.ok) { console.error(`[工单] HTTP ${res.status}`); return; }
      const raw = await res.json().catch(() => null);
      if (Array.isArray(raw)) setIssues(raw as IssueTicket[]);
    } catch (e) { console.error("[工单] 加载失败", e); }
  };

  // 加载员工列表（供工单指派人下拉框使用）
  useEffect(() => {
    const loadStaff = async () => {
      try {
        const res = await fetchWithAuth("/api/employees", { cache: "no-store" });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
        const data = await res.json();
        const rows: any[] = Array.isArray(data) ? data : [];
        // 工单指派人：老板(admin) + 普通员工，仅排除客户
        const issueNames: string[] = rows.filter((e: any) => e.role !== "client").map((e: any) => e.name).filter(Boolean);
        setIssueStaffNames(issueNames);
      } catch (e) { console.error("[工单] 加载员工列表失败", e); }
    };
    loadStaff();
  }, []);

  useEffect(() => { loadAll(); }, [user?.name]);

  // 从剪贴板事件里取出图片文件（没有图片返回空数组）
  const getPastedImages = (e: React.ClipboardEvent): File[] => {
    const items = e.clipboardData?.items;
    if (!items) return [];
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    return files;
  };

  // 上传一批图片到 /api/upload，成功后就追加到截图栏
  const uploadIssueImages = async (files: File[]) => {
    if (files.length === 0) return;
    setIssueUploading(true);
    const uploaded: string[] = [];
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error("上传失败");
        const json = await res.json();
        uploaded.push(json.url);
      } catch (err) {
        alert("上传失败: " + (err instanceof Error ? err.message : "网络错误"));
        break;
      }
    }
    setIssueImages(prev => [...prev, ...uploaded]);
    setIssueUploading(false);
  };

  const handleIssueImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadIssueImages(Array.from(files));
    e.target.value = "";
  };

  // 问题描述输入框粘贴截图：有图片就自动上传到截图栏；纯文字粘贴不拦截
  const handleDescriptionPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    uploadIssueImages(files);
  };

  const removeIssueImage = (idx: number) => {
    setIssueImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCreateIssue = async () => {
    if (!issueForm.description.trim()) { setIssueErr("请填写问题描述"); return; }
    if (!issueForm.assignee.length) { setIssueErr("请至少指定一个解决人"); return; }
    setIssueSaving(true);
    try {
      await fetchWithAuth("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...issueForm, created_by: user?.name, images: issueImages.map((url: string) => url.replace("/api/files/", "")) }),
      });
      setShowIssueForm(false);
      setIssueForm({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: [] });
      setIssueImages([]);
      setIssueErr("");
      loadAll();
    } catch (e) { console.error("[工单] 创建工单失败", e); } finally { setIssueSaving(false); }
  };

  // 打开解决截图上传弹窗
  const handleResolveIssue = (t: IssueTicket) => {
    setResolveModal(t);
    setResolveScreenshotFile(null);
    setResolveScreenshotPreview(null);
    setResolveErr("");
  };

  // 设置解决截图（文件选择与粘贴共用），单张
  const setResolveScreenshot = (file: File) => {
    setResolveScreenshotFile(file);
    setResolveScreenshotPreview(URL.createObjectURL(file));
    setResolveErr("");
  };

  const handleResolveScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResolveScreenshot(file);
    e.target.value = "";
  };

  // 解决弹窗里粘贴截图：有图片就当作解决截图（单张，取第一张）
  const handleResolvePaste = (e: React.ClipboardEvent) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    setResolveScreenshot(files[0]);
  };

  const handleResolveScreenshotRemove = () => {
    setResolveScreenshotFile(null);
    setResolveScreenshotPreview(null);
  };

  const handleConfirmResolve = async () => {
    if (!resolveModal) return;
    if (!resolveScreenshotFile) { setResolveErr("请上传解决截图作为证明"); return; }
    setResolveUploading(true);
    setResolveErr("");
    try {
      // 1) 上传截图
      const fd = new FormData();
      fd.append("file", resolveScreenshotFile);
      const upRes = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) throw new Error("图片上传失败");
      const upData = await upRes.json();
      const screenshotFilename = upData.filename || upData.file || "";

      // 2) 更新工单状态 + 截图
      await fetchWithAuth("/api/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resolveModal.id, status: "已解决", resolved_by: user?.name, resolve_screenshot: screenshotFilename }),
      });
      setResolveModal(null);
      loadAll();
    } catch (e: any) {
      setResolveErr(e?.message || "操作失败，请重试");
    }
    setResolveUploading(false);
  };

  const handleWithdrawIssue = async (t: IssueTicket) => {
    // 只有解决人、创建人或管理员能撤回
    if (user?.role !== "admin" && user?.name !== t.resolved_by && user?.name !== t.created_by) {
      alert("只有解决人、创建人或管理员才能撤回");
      return;
    }
    if (!confirm("确认撤回此工单？状态将回到处理中。")) return;
    try {
      await fetchWithAuth("/api/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, status: "处理中", withdrawn_by: user?.name }),
      });
      loadAll();
    } catch (e) { console.error("[工单] 撤回工单失败", e); }
  };

  // 打开工单详情：重置翻译相关状态
  const openIssueDetail = (t: IssueTicket) => {
    setIssueDetailModal(t);
    setTranslating(false);
    setTranslateErr("");
  };

  // 把问题描述翻译成中文，结果缓存，下次直接显示
  const handleTranslateDescription = async () => {
    if (!issueDetailModal) return;
    setTranslating(true);
    setTranslateErr("");
    try {
      const res = await fetchWithAuth("/api/issues/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: issueDetailModal.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setIssueDetailModal(prev => prev ? { ...prev, description_zh: data.description_zh } : prev);
      } else {
        setTranslateErr(data.error || "翻译失败");
      }
    } catch { setTranslateErr("翻译失败，请重试"); }
    finally { setTranslating(false); }
  };

  const handleDeleteIssue = async (id: number) => {
    if (!confirm("确认删除此工单？删除后无法恢复。")) return;
    try {
      await fetchWithAuth("/api/issues?id=" + id, { method: "DELETE" });
      loadAll();
    } catch (e) { console.error(e); }
  };

  // 被指派员工手动开始处理工单：待处理 → 处理中
  const handleStartIssue = async (t: IssueTicket) => {
    try {
      const res = await fetchWithAuth("/api/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, status: "处理中" }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "操作失败");
        return;
      }
      loadAll();
    } catch (e) { console.error("[工单] 开始处理工单失败", e); }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">工单</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">创建、指派、处理与解决工单</p>
        </div>
        <Button size="sm" className="h-8 text-xs" variant="outline" onClick={() => setShowIssueForm(true)}><Plus className="size-3" />新增工单</Button>
      </div>

      {/* ── 问题工单 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2"><FileEdit className="size-4" />问题工单 ({(() => {
            const now = Date.now(); const today = new Date().toDateString();
            return (Array.isArray(issues) ? issues : []).filter(t => {
              const d = new Date(t.created_at);
              if (issueDateFilter === "today" && d.toDateString() !== today) return false;
              if (issueDateFilter === "7" && d < new Date(now - 7*86400000)) return false;
              if (issueDateFilter === "30" && d < new Date(now - 30*86400000)) return false;
              if (issueDateFilter === "custom" && issueCustomFrom && d < new Date(issueCustomFrom)) return false;
              if (issueDateFilter === "custom" && issueCustomTo && d > new Date(issueCustomTo+"T23:59:59")) return false;
              if (issueAssigneeFilter && t.assignee !== issueAssigneeFilter) return false;
              if (issueCreatorFilter && t.created_by !== issueCreatorFilter) return false;
              return true;
            }).length;
          })()})</h2>
          <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => setShowIssueForm(true)}><Plus className="size-3" />新增工单</Button>
        </div>
        {/* Filters */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
            {([["all","全部"],["today","今天"],["7","7天"],["30","30天"],["custom","自定义"]] as [string,string][]).map(([k,l]) => (
              <button key={k} onClick={() => setIssueDateFilter(k as any)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${issueDateFilter===k?"bg-[var(--background)] text-[var(--foreground)] shadow-sm":"text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
              >{l}</button>
            ))}
          </div>
          {issueDateFilter === "custom" && (
            <div className="flex items-center gap-1 text-xs">
              <input type="date" value={issueCustomFrom} onChange={e=>setIssueCustomFrom(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none" />
              <span className="text-[var(--muted-foreground)]">至</span>
              <input type="date" value={issueCustomTo} onChange={e=>setIssueCustomTo(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none" />
            </div>
          )}
          <span className="text-[var(--border)] mx-1">|</span>
          <select value={issueAssigneeFilter} onChange={e=>setIssueAssigneeFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none">
            <option value="">全部指派人</option>
            {issueStaffNames.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          <select value={issueCreatorFilter} onChange={e=>setIssueCreatorFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none">
            <option value="">全部创建人</option>
            {[...new Set((Array.isArray(issues)?issues:[]).map(t=>t.created_by).filter(Boolean))].sort().map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {showIssueForm && (
          <div className="p-5 border-b border-[var(--border)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium">关联编号</label>
                <input value={issueForm.ref_id} onChange={e=>setIssueForm(p=>({...p,ref_id:e.target.value}))} placeholder="订单编号或达人编号" className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs font-medium">紧急程度</label>
                <select value={issueForm.priority} onChange={e=>setIssueForm(p=>({...p,priority:e.target.value}))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="medium">普通</option><option value="high">紧急</option><option value="low">低</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">指定解决人 <span className="text-[var(--destructive)]">*</span>（可多选）</label>
                <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 rounded border border-[var(--border)] p-3 max-h-40 overflow-y-auto">
                  {issueStaffNames.map(n => {
                    const checked = issueForm.assignee.includes(n);
                    return (
                      <label key={n} className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer transition-colors",
                        checked ? "bg-[var(--primary)]/10 text-[var(--foreground)]" : "hover:bg-[var(--muted)]/30"
                      )}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = e.target.checked
                              ? [...issueForm.assignee, n]
                              : issueForm.assignee.filter(x => x !== n);
                            setIssueForm(p => ({ ...p, assignee: next }));
                          }}
                          className="size-4 rounded border-[var(--border)] accent-[var(--primary)]"
                        />
                        <span className="truncate">{n}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">问题描述</label>
                <textarea value={issueForm.description} onChange={e=>setIssueForm(p=>({...p,description:e.target.value}))} onPaste={handleDescriptionPaste} placeholder="描述遇到的问题..." rows={2} className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">截图上传</label>
              <div className="mt-1 flex flex-wrap gap-2 items-center">
                {issueImages.map((img,idx)=>(
                  <div key={idx} className="relative group w-16 h-16 rounded border border-[var(--border)] overflow-hidden bg-[var(--muted)] shrink-0">
                    <img src={fileUrl(img)} alt="" className="w-full h-full object-cover" />
                    <button onClick={()=>removeIssueImage(idx)} className="absolute -top-1 -right-1 size-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="size-3" /></button>
                  </div>
                ))}
                <label className="w-16 h-16 rounded border-2 border-dashed border-[var(--border)] flex items-center justify-center cursor-pointer hover:border-[var(--ring)] transition-colors shrink-0">
                  {issueUploading?<Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" />:<Plus className="size-5 text-[var(--muted-foreground)]" />}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleIssueImageUpload} disabled={issueUploading} />
                </label>
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">支持 jpg/png/webp，每张不超过 10MB · 可直接粘贴 Ctrl+V</p>
            </div>
            {issueErr && <p className="mt-2 text-xs text-[var(--destructive)]">{issueErr}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleCreateIssue} disabled={issueSaving}>{issueSaving?"创建中...":"提交工单"}</Button>
              <Button variant="ghost" size="sm" onClick={()=>setShowIssueForm(false)}>取消</Button>
            </div>
          </div>
        )}

        {(() => {
          const now = Date.now(); const today = new Date().toDateString();
          const filtered = (Array.isArray(issues) ? issues : []).filter(t => {
            const d = new Date(t.created_at);
            if (issueDateFilter === "today" && d.toDateString() !== today) return false;
            if (issueDateFilter === "7" && d < new Date(now-7*86400000)) return false;
            if (issueDateFilter === "30" && d < new Date(now-30*86400000)) return false;
            if (issueDateFilter === "custom" && issueCustomFrom && d < new Date(issueCustomFrom)) return false;
            if (issueDateFilter === "custom" && issueCustomTo && d > new Date(issueCustomTo+"T23:59:59")) return false;
            if (issueAssigneeFilter && t.assignee !== issueAssigneeFilter) return false;
            if (issueCreatorFilter && t.created_by !== issueCreatorFilter) return false;
            return true;
          });
          const active = filtered.filter(t => t.status !== "已解决");
          const resolved = filtered.filter(t => t.status === "已解决");
          if (filtered.length === 0) return (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无匹配的工单</div>
          );
          // Shared render function for both active and resolved tables
          const renderTable = (list: IssueTicket[]) => (
            <>
            <table className="w-full text-sm hidden md:table">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-4 text-left text-xs font-medium">编号</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">关联</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">问题</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">指定人</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">状态</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">解决截图</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">创建人</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">提交时间</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">图片</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
              </tr></thead>
              <tbody>{list.map(t => (
                <tr key={t.id} className="border-b border-[var(--border)]">
                  <td className="py-2.5 px-4 font-mono text-xs">{t.ticket_number || `#${t.id}`}</td>
                  <td className="py-2.5 px-4 text-xs">{t.ref_id ? `${t.ref_type==="influencer"?"达人:":"订单:"}${t.ref_id}` : "—"}</td>
                  <td className="py-2.5 px-4 max-w-[200px] truncate">{t.description}</td>
                  <td className="py-2.5 px-4 text-xs">{t.assignee ? t.assignee.split(",").map(s => s.trim()).filter(Boolean).join("、") : "—"}</td>
                  <td className="py-2.5 px-4">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      t.status==="已解决"&&"bg-green-100 text-green-700",
                      t.status==="处理中"&&"bg-blue-100 text-blue-700",
                      "bg-gray-100 text-gray-700")}>{t.status}</span>
                  </td>
                  <td className="py-2.5 px-4">
                    {t.status !== "待处理" && t.resolve_screenshot ? (
                      <button onClick={() => {
                        const url = t.resolve_screenshot ? fileUrl(`/api/files/${t.resolve_screenshot}`) : "";
                        if (url) { setLightboxImages([url]); setLightboxIdx(0); }
                      }} className="inline-flex items-center gap-0.5 text-green-600 hover:underline cursor-pointer">
                        <Image className="size-4" /><span className="text-xs">查看</span>
                      </button>
                    ) : (
                      <span className="text-[var(--muted-foreground)]/30">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">{t.created_by}</td>
                  <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</td>
                  <td className="py-2.5 px-4">
                    {(()=>{const imgs=safeJsonParseArray(t.images);return imgs.length>0?(
                      <button onClick={()=>{setLightboxImages(imgs.map((f:string)=>`/api/files/${f}`));setLightboxIdx(0);}} className="inline-flex items-center gap-0.5 text-blue-600 hover:underline cursor-pointer">
                        <Image className="size-4" /><span className="text-xs">{imgs.length}</span>
                      </button>):<span className="text-[var(--muted-foreground)]/30">—</span>;})()}
                  </td>
                  <td className="py-2.5 px-4">
                    <button onClick={() => openIssueDetail(t)} className="mr-1 text-[var(--muted-foreground)] hover:text-[var(--primary)] p-0.5" title="查看详情">
                      <ExternalLink className="size-3.5" />
                    </button>
                    {t.status === "待处理" && (user?.role === "admin" || (t.assignee || "").split(",").map(s => s.trim()).includes(user?.name || "")) && (
                      <Button size="sm" variant="outline" className="h-6 text-xs mr-1" onClick={() => handleStartIssue(t)}>
                        <Play className="size-3 mr-1" />开始处理
                      </Button>
                    )}
                    {t.status!=="已解决" ? (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={()=>handleResolveIssue(t)}>
                        <CheckCircle2 className="size-3 mr-1" />解决
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={()=>handleWithdrawIssue(t)}>
                        <AlertTriangle className="size-3 mr-1" />撤回
                      </Button>
                    )}
                    <button onClick={()=>handleDeleteIssue(t.id)} className="ml-1.5 text-[var(--muted-foreground)] hover:text-red-500 p-0.5" title="删除工单">
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-3 p-3">
              {list.map(t => (
                <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{t.ticket_number || `#${t.id}`}</span>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                      t.status==="已解决"&&"bg-green-100 text-green-700",
                      t.status==="处理中"&&"bg-blue-100 text-blue-700",
                      "bg-gray-100 text-gray-700")}>{t.status}</span>
                  </div>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-2"><span className="shrink-0 text-[var(--muted-foreground)]">关联</span><span className="min-w-0 break-words text-right text-xs">{t.ref_id ? `${t.ref_type==="influencer"?"达人:":"订单:"}${t.ref_id}` : "—"}</span></div>
                    <div>
                      <div className="text-[var(--muted-foreground)]">问题</div>
                      <p className="mt-0.5 break-words whitespace-pre-wrap">{t.description}</p>
                    </div>
                    <div className="flex items-start justify-between gap-2"><span className="shrink-0 text-[var(--muted-foreground)]">指定人</span><span className="min-w-0 break-words text-right text-xs">{t.assignee ? t.assignee.split(",").map(s => s.trim()).filter(Boolean).join("、") : "—"}</span></div>
                    <div className="flex items-start justify-between gap-2"><span className="shrink-0 text-[var(--muted-foreground)]">创建人</span><span className="min-w-0 break-words text-right">{t.created_by}</span></div>
                    <div className="flex items-start justify-between gap-2"><span className="shrink-0 text-[var(--muted-foreground)]">提交时间</span><span className="min-w-0 break-words text-right text-xs">{toThaiTime(t.created_at) || "—"}</span></div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => openIssueDetail(t)} className="mr-1 text-[var(--muted-foreground)] hover:text-[var(--primary)] p-0.5" title="查看详情"><ExternalLink className="size-3.5" /></button>
                    {t.status === "待处理" && (user?.role === "admin" || (t.assignee || "").split(",").map(s => s.trim()).includes(user?.name || "")) && (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleStartIssue(t)}><Play className="size-3 mr-1" />开始处理</Button>
                    )}
                    {t.status!=="已解决" ? (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={()=>handleResolveIssue(t)}><CheckCircle2 className="size-3 mr-1" />解决</Button>
                    ) : (
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={()=>handleWithdrawIssue(t)}><AlertTriangle className="size-3 mr-1" />撤回</Button>
                    )}
                    <button onClick={()=>handleDeleteIssue(t.id)} className="ml-1.5 text-[var(--muted-foreground)] hover:text-red-500 p-0.5" title="删除工单"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
            </>
          );
          return (
            <div>
              {active.length > 0 ? (
                <div className="overflow-x-auto">{renderTable(active)}</div>
              ) : (
                <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无处理中的工单</div>
              )}
              {resolved.length > 0 && (
                <div className="border-t border-[var(--border)]">
                  <button onClick={()=>setShowResolved(!showResolved)} className="w-full px-5 py-3 flex items-center justify-between text-sm hover:bg-[var(--muted)]/30 transition-colors">
                    <span className="font-medium text-[var(--muted-foreground)]">已解决 ({resolved.length})</span>
                    <span className={`text-xs transition-transform ${showResolved?"rotate-180":""}`}>&#9660;</span>
                  </button>
                  {showResolved && <div className="overflow-x-auto">{renderTable(resolved)}</div>}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 解决工单截图上传弹窗 ── */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setResolveModal(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()} onPaste={handleResolvePaste}>
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">解决工单</h3>
            <p className="text-xs text-[var(--muted-foreground)] mb-4 line-clamp-2">{resolveModal.description}</p>

            {resolveErr && <p className="mb-3 text-xs text-[var(--destructive)]">{resolveErr}</p>}

            <label className="block text-xs font-medium text-[var(--foreground)] mb-2">解决截图 <span className="text-[var(--destructive)]">*</span></label>

            {resolveScreenshotPreview ? (
              <div className="relative inline-block mb-3">
                <img src={resolveScreenshotPreview} alt="截图预览" className="max-h-48 rounded border border-[var(--border)]" />
                <button onClick={handleResolveScreenshotRemove} className="absolute -top-2 -right-2 size-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs hover:bg-red-600">
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <div
                onClick={() => resolveScreenshotInputRef.current?.click()}
                className="mb-3 border-2 border-dashed border-[var(--border)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--primary)]/50 transition-colors"
              >
                <Camera className="size-6 mx-auto text-[var(--muted-foreground)] mb-1" />
                <p className="text-xs text-[var(--muted-foreground)]">点击上传截图，或直接粘贴 Ctrl+V</p>
              </div>
            )}
            <input ref={resolveScreenshotInputRef} type="file" accept="image/*" className="hidden" onChange={handleResolveScreenshotSelect} />

            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => setResolveModal(null)} className="rounded-md border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]">
                取消
              </button>
              <button
                onClick={handleConfirmResolve}
                disabled={resolveUploading}
                className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
              >
                {resolveUploading ? "上传中..." : "确认解决"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 工单详情弹窗 ── */}
      {issueDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setIssueDetailModal(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--background)] border-b border-[var(--border)] px-5 py-4 flex items-center justify-between rounded-t-xl">
              <h3 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                <FileEdit className="size-4" />
                工单详情 {issueDetailModal.ticket_number || '#' + issueDetailModal.id}
              </h3>
              <button onClick={() => setIssueDetailModal(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* 状态和紧急程度 */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  issueDetailModal.status==="已解决"&&"bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                  issueDetailModal.status==="处理中"&&"bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
                  issueDetailModal.status==="待处理"&&"bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400")}>
                  {issueDetailModal.status}
                </span>
                <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                  issueDetailModal.priority==="high"&&"bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                  issueDetailModal.priority==="medium"&&"bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
                  issueDetailModal.priority==="low"&&"bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400")}>
                  {issueDetailModal.priority==="high"?"紧急":issueDetailModal.priority==="low"?"低":"普通"}
                </span>
              </div>

              {/* 完整问题描述 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)]">问题描述</h4>
                  <button onClick={handleTranslateDescription} disabled={translating} className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                    {translating ? "翻译中…" : "翻译"}
                  </button>
                </div>
                <p className="text-sm text-[var(--foreground)] whitespace-pre-wrap leading-relaxed">{issueDetailModal.description}</p>
                {issueDetailModal.description_zh && (
                  <div className="mt-2 rounded bg-[var(--muted)]/30 p-2">
                    <p className="mb-1 text-[0.65rem] text-[var(--muted-foreground)]">中文译文</p>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{issueDetailModal.description_zh}</p>
                  </div>
                )}
                {translateErr && <p className="mt-1 text-xs text-[var(--destructive)]">{translateErr}</p>}
              </div>

              {/* 基本信息网格 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">关联编号</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.ref_id ? (issueDetailModal.ref_type==="influencer"?"达人 ":"订单 ") + issueDetailModal.ref_id : "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">指派人</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.assignee || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">创建人</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.created_by || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">创建时间</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.created_at?.slice(0, 16) || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">解决人</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.resolved_by || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-0.5">解决时间</h4>
                  <p className="text-sm text-[var(--foreground)]">{issueDetailModal.resolved_at?.slice(0, 16) || "—"}</p>
                </div>
              </div>

              {/* 时间线 */}
              <div>
                <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-2">状态时间线</h4>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-[0.6rem] font-medium">1</div>
                    <span className="text-[var(--foreground)]">创建</span>
                    <span className="text-[var(--muted-foreground)]">{issueDetailModal.created_at?.slice(0, 16) || "—"}</span>
                    <span className="text-[var(--muted-foreground)]">· {issueDetailModal.created_by}</span>
                  </div>
                  {issueDetailModal.resolved_at && (
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-[0.6rem] font-medium">2</div>
                      <span className="text-[var(--foreground)]">已解决</span>
                      <span className="text-[var(--muted-foreground)]">{issueDetailModal.resolved_at.slice(0, 16)}</span>
                      {issueDetailModal.resolved_by && <span className="text-[var(--muted-foreground)]">· {issueDetailModal.resolved_by}</span>}
                    </div>
                  )}
                  {issueDetailModal.withdrawn_at && (
                    <div className="flex items-center gap-2 text-xs">
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 text-[0.6rem] font-medium">3</div>
                      <span className="text-[var(--foreground)]">已撤回</span>
                      <span className="text-[var(--muted-foreground)]">{issueDetailModal.withdrawn_at.slice(0, 16)}</span>
                      {issueDetailModal.withdrawn_by && <span className="text-[var(--muted-foreground)]">· {issueDetailModal.withdrawn_by}</span>}
                    </div>
                  )}
                  {!issueDetailModal.resolved_at && !issueDetailModal.withdrawn_at && (
                    <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--muted-foreground)] text-[0.6rem] font-medium">?</div>
                      <span>等待解决中...</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 上传的问题截图 */}
              {(() => {
                const imgs = (() => { try { return JSON.parse(issueDetailModal.images || "[]"); } catch { return []; } })();
                if (imgs.length === 0) return null;
                return (
                  <div>
                    <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-2">问题截图 ({imgs.length})</h4>
                    <div className="flex flex-wrap gap-2">
                      {imgs.map((f: string, idx: number) => (
                        <img
                          key={idx}
                          src={fileUrl('/api/files/' + f)}
                          alt={`截图 ${idx + 1}`}
                          className="w-24 h-24 object-cover rounded-lg border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => {
                            setLightboxImages(imgs.map((f2: string) => '/api/files/' + f2));
                            setLightboxIdx(idx);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* 解决截图 */}
              {issueDetailModal.resolve_screenshot && (
                <div>
                  <h4 className="text-xs font-medium text-[var(--muted-foreground)] mb-2">解决截图</h4>
                  <img
                    src={fileUrl('/api/files/' + issueDetailModal.resolve_screenshot)}
                    alt="解决截图"
                    className="w-32 h-32 object-cover rounded-lg border border-[var(--border)] cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => { setLightboxImages(['/api/files/' + issueDetailModal.resolve_screenshot!]); setLightboxIdx(0); }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 图片灯箱 ── */}
      {lightboxImages && lightboxImages.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={() => setLightboxImages(null)}>
          <button onClick={() => setLightboxImages(null)} className="absolute top-4 right-4 text-white/70 hover:text-white"><X className="size-6" /></button>
          {lightboxImages.length > 1 && lightboxIdx > 0 && (
            <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => i - 1); }} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"><ChevronLeft className="size-8" /></button>
          )}
          <img src={fileUrl(lightboxImages[lightboxIdx])} alt="" className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          {lightboxImages.length > 1 && lightboxIdx < lightboxImages.length - 1 && (
            <button onClick={e => { e.stopPropagation(); setLightboxIdx(i => i + 1); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white"><ChevronRight className="size-8" /></button>
          )}
          {lightboxImages.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-xs">{lightboxIdx + 1} / {lightboxImages.length}</div>
          )}
        </div>
      )}
    </div>
  );
}
