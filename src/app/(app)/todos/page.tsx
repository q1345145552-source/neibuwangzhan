"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, fileUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, MessageSquare, Check, ChevronDown, ChevronRight, ChevronLeft, ImagePlus, Image, History, Pencil, Trash2, Bell, AlertCircle } from "lucide-react";

interface Todo {
  id: number;
  content: string;
  assignee: string;
  priority: string;
  status: string;
  completed_at?: string | null;
  created_by: string;
  created_at: string;
  latest_follow_content?: string | null;
  latest_follow_by?: string | null;
  latest_follow_at?: string | null;
  images?: string[];
}

const STATUS_CLASS: Record<string, string> = {
  "未完成": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
};

// 待办看板：每个时间范围的三项统计
interface RangeStats {
  created: number;
  completed: number;
  followups: number;
}
// 待办看板整体统计（含员工维度表、积压提醒、趋势对比）
interface TodoStats {
  unfinished: number;
  today: RangeStats;
  week: RangeStats;
  month: RangeStats;
  employees: { name: string; unfinished: number; today: RangeStats; week: RangeStats; month: RangeStats }[];
  backlog: { id: number; content: string; assignee: string; created_at: string; days: number }[];
  trend: { created: { this: number; last: number }; completed: { this: number; last: number } };
}

// 曼谷时区今天 / N 天前（用于已完成待办的时间筛选）
function bangkokToday(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().split("T")[0];
}
function bangkokDaysAgo(n: number): string {
  return new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000).toISOString().split("T")[0];
}

export default function TodosPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [todos, setTodos] = useState<Todo[]>([]);
  const [employees, setEmployees] = useState<{ id: number; name: string; role?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ content: "", assignee: "", priority: "普通", images: [] as string[] });
  const [uploadingImages, setUploadingImages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [previewImages, setPreviewImages] = useState<string[] | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [followTarget, setFollowTarget] = useState<Todo | null>(null);
  const [followContent, setFollowContent] = useState("");
  const [following, setFollowing] = useState(false);
  const [followImages, setFollowImages] = useState<string[]>([]);
  const [followUploading, setFollowUploading] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<Todo | null>(null);
  const [historyRecords, setHistoryRecords] = useState<{ id: number; content: string; images: string[]; created_by: string; created_at: string }[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [editTarget, setEditTarget] = useState<Todo | null>(null);
  const [editForm, setEditForm] = useState({ content: "", priority: "普通", assignee: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Todo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [unseen, setUnseen] = useState<{ id: number; content: string; type: string; created_at: string }[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [showInbox, setShowInbox] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [completedRange, setCompletedRange] = useState("all");
  // 从积压提醒跳转到某条待办时，记录要定位+高亮的待办 id
  const [highlightTodoId, setHighlightTodoId] = useState<number | null>(null);
  // 待办看板（仅管理员/老板）：时间范围 + 统计数字
  const [statsRange, setStatsRange] = useState<"today" | "week" | "month">("today");
  const [stats, setStats] = useState<TodoStats | null>(null);
  // 看板折叠状态：默认收起，只留标题
  const [boardOpen, setBoardOpen] = useState(false);

  const loadStats = useCallback(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/todos/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && typeof d.unfinished === "number") setStats(d); })
      .catch(() => {});
  }, [isAdmin]);

  const load = useCallback(() => {
    fetchWithAuth("/api/todos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTodos(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
    loadStats();
  }, [loadStats]);

  useEffect(() => { load(); }, [load]);

  // 信息箱：未看过的新增/新跟进待办
  const loadUnseen = useCallback(() => {
    fetchWithAuth("/api/todos/unseen", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setUnseen(Array.isArray(d.items) ? d.items : []);
          setInboxCount(typeof d.count === "number" ? d.count : 0);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => { loadUnseen(); }, [loadUnseen]);

  const markSeen = async (id: number) => {
    try { await fetchWithAuth(`/api/todos/${id}/seen`, { method: "POST" }); } catch {}
    loadUnseen();
  };

  // 管理员新建时从员工档案下拉选负责人
  useEffect(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isAdmin]);

  const unfinished = todos.filter((t) => t.status !== "已完成");
  const completed = todos
    .filter((t) => t.status === "已完成")
    .sort((a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""));

  // 卡片：员工看自己一张卡；管理员每个员工一张卡（含未分配），显示未完成数
  const cards = useMemo(() => {
    if (!isAdmin) {
      return [{ name: user?.name || "我", count: unfinished.length }];
    }
    const staffNames = new Set(employees.filter((e) => e.role !== "client").map((e) => e.name));
    const assignees = new Set(unfinished.map((t) => t.assignee || "未分配"));
    const allNames = new Set<string>([...staffNames, ...assignees]);
    return [...allNames]
      .sort((a, b) => a.localeCompare(b, "zh"))
      .map((name) => ({
        name,
        count: unfinished.filter((t) => (t.assignee || "未分配") === name).length,
      }));
  }, [isAdmin, employees, unfinished]);

  // 点卡片后：该员工的未完成待办列表
  const selectedList = selectedAssignee
    ? unfinished.filter((t) => (t.assignee || "未分配") === selectedAssignee)
    : [];

  // 点积压提醒：进入对应负责人的待办列表，并定位+高亮那条待办
  const jumpToTodo = (assignee: string, todoId: number) => {
    setSelectedAssignee(assignee || "未分配");
    setHighlightTodoId(todoId);
  };

  // 定位并高亮：等列表渲染后滚动到目标待办，高亮几秒后淡出
  useEffect(() => {
    if (highlightTodoId == null) return;
    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(`todo-${highlightTodoId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimer = setTimeout(() => setHighlightTodoId(null), 3000);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [highlightTodoId, selectedAssignee]);

  // 已完成待办的时间筛选（只作用于已完成，不影响未完成列表）
  const completedFiltered = useMemo(() => {
    if (completedRange === "all") return completed;
    const today = bangkokToday();
    const start = completedRange === "today" ? today : completedRange === "7d" ? bangkokDaysAgo(6) : bangkokDaysAgo(29);
    return completed.filter((t) => {
      const d = (toThaiTime(t.completed_at) || "").slice(0, 10);
      return d >= start && d <= today;
    });
  }, [completed, completedRange]);

  const openForm = () => {
    setForm({ content: "", assignee: user?.name || "", priority: "普通", images: [] });
    setErr("");
    setShowForm(true);
  };

  // 图片上传（多张，可选）：先传到 /api/upload 拿 url，随待办一起保存
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadingImages(true);
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
      if (urls.length > 0) {
        setForm((p) => ({ ...p, images: [...p.images, ...urls] }));
      }
    } catch { setErr("图片上传失败"); }
    finally {
      setUploadingImages(false);
      e.target.value = "";
    }
  };

  const removeImage = (url: string) => {
    setForm((p) => ({ ...p, images: p.images.filter((u) => u !== url) }));
  };

  const handleSubmit = async () => {
    if (!form.content.trim()) { setErr("请填写工作内容"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetchWithAuth("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        load();
        loadUnseen();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "提交失败");
      }
    } catch { setErr("提交失败"); }
    finally { setSaving(false); }
  };

  const openFollow = (todo: Todo) => {
    setFollowTarget(todo);
    setFollowContent("");
    setFollowImages([]);
    setErr("");
  };

  // 打开全屏灯箱：images 为要放大的图片列表，startIdx 为初始显示哪一张
  const openLightbox = (images: string[], startIdx: number) => {
    setLightboxImages(images);
    setLightboxIdx(startIdx);
  };

  // 打开跟进历史弹窗：拉取该待办所有跟进记录（后端已按时间倒序）
  const openFollowHistory = async (todo: Todo) => {
    // 打开跟进历史 = 看过这条待办（清掉「新跟进」未读）
    fetchWithAuth(`/api/todos/${todo.id}/seen`, { method: "POST" }).catch(() => {});
    loadUnseen();
    setHistoryTarget(todo);
    setHistoryRecords([]);
    setLoadingHistory(true);
    try {
      const res = await fetchWithAuth(`/api/todos/${todo.id}/follow-ups`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setHistoryRecords(Array.isArray(data) ? data : []);
      } else {
        setHistoryRecords([]);
      }
    } catch { setHistoryRecords([]); }
    finally { setLoadingHistory(false); }
  };

  const openEdit = (todo: Todo) => {
    setEditTarget(todo);
    setEditForm({ content: todo.content, priority: todo.priority, assignee: todo.assignee || "" });
    setErr("");
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    if (!editForm.content.trim()) { setErr("请填写工作内容"); return; }
    setSavingEdit(true);
    setErr("");
    try {
      const res = await fetchWithAuth(`/api/todos/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setEditTarget(null);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "保存失败");
      }
    } catch { setErr("保存失败"); }
    finally { setSavingEdit(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/todos/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setDeleteTarget(null);
        load();
        loadUnseen();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "删除失败");
      }
    } catch { alert("删除失败"); }
    finally { setDeleting(false); }
  };

  const handleFollow = async () => {
    if (!followTarget) return;
    if (!followContent.trim()) { setErr("请填写跟进内容"); return; }
    setFollowing(true);
    setErr("");
    try {
      const res = await fetchWithAuth(`/api/todos/${followTarget.id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: followContent.trim(), images: followImages }),
      });
      if (res.ok) {
        setFollowTarget(null);
        setFollowImages([]);
        load();
        loadUnseen();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "添加跟进失败");
      }
    } catch { setErr("添加跟进失败"); }
    finally { setFollowing(false); }
  };

  // 跟进图片上传（多张，可选）：先传到 /api/upload 拿 url，随跟进记录一起保存
  const handleFollowImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFollowUploading(true);
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
      if (urls.length > 0) {
        setFollowImages((p) => [...p, ...urls]);
      }
    } catch { setErr("图片上传失败"); }
    finally {
      setFollowUploading(false);
      e.target.value = "";
    }
  };

  const removeFollowImage = (url: string) => {
    setFollowImages((p) => p.filter((u) => u !== url));
  };

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

  // 创建待办输入框粘贴图片：有图片就自动上传，文字粘贴不受影响
  const handleFormPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    setUploadingImages(true);
    try {
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
      if (urls.length > 0) setForm((p) => ({ ...p, images: [...p.images, ...urls] }));
    } catch { setErr("图片上传失败"); }
    finally { setUploadingImages(false); }
  };

  // 跟进输入框粘贴图片：有图片就自动上传，文字粘贴不受影响
  const handleFollowPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = getPastedImages(e);
    if (files.length === 0) return;
    e.preventDefault();
    setFollowUploading(true);
    try {
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
      if (urls.length > 0) setFollowImages((p) => [...p, ...urls]);
    } catch { setErr("图片上传失败"); }
    finally { setFollowUploading(false); }
  };

  const handleComplete = async (todo: Todo) => {
    try {
      const res = await fetchWithAuth(`/api/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "已完成" }),
      });
      if (res.ok) {
        load();
        loadUnseen();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "操作失败");
      }
    } catch { alert("操作失败"); }
  };

  // 未完成待办表格（员工视角 + 管理员每个分组共用）
  const renderTodoTable = (list: Todo[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm hidden md:table">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
            <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">工作内容</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">紧急程度</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">状态</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">创建时间</th>
            <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={t.id} id={`todo-${t.id}`} className={cn("border-b border-[var(--border)]", t.priority === "紧急" && "bg-red-50/60 dark:bg-red-950/20", t.id === highlightTodoId && "bg-amber-100 dark:bg-amber-900/30")}>
              <td className="py-3 px-5">
                <div className="text-base font-semibold text-[var(--foreground)]">{t.content}</div>
                {t.latest_follow_content && (
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                    最新：{t.latest_follow_content}
                    <span className="ml-1 text-[var(--muted-foreground)]/70">· {t.latest_follow_by} · {toThaiTime(t.latest_follow_at)}</span>
                  </div>
                )}
                {t.images && t.images.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <img src={fileUrl(t.images[0])} alt="" className="h-10 w-10 cursor-pointer rounded border border-[var(--border)] object-cover hover:opacity-80" onClick={() => openLightbox(t.images || [], 0)} />
                    <Button size="xs" variant="outline" onClick={() => setPreviewImages(t.images || [])} className="gap-1">
                      <Image className="size-3" />查看（{t.images.length}）
                    </Button>
                  </div>
                )}
              </td>
              <td className="py-3 px-4 text-[var(--muted-foreground)]">{t.assignee || "—"}</td>
              <td className="py-3 px-4">
                {t.priority === "紧急" ? (
                  <span className="inline-flex rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">紧急</span>
                ) : (
                  <span className="text-xs text-[var(--muted-foreground)]">普通</span>
                )}
              </td>
              <td className="py-3 px-4">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[t.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{t.status}</span>
              </td>
              <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || "—"}</td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => openEdit(t)} className="gap-1">
                    <Pencil className="size-3.5" />编辑
                  </Button>
                  {t.latest_follow_content && (
                    <Button size="sm" variant="ghost" onClick={() => openFollowHistory(t)} className="gap-1 text-[var(--muted-foreground)]">
                      <History className="size-3.5" />历史
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openFollow(t)} className="gap-1">
                    <MessageSquare className="size-3.5" />跟进
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleComplete(t)} className="gap-1">
                    <Check className="size-3.5" />完成
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(t)} className="gap-1 text-[var(--destructive)]">
                    <Trash2 className="size-3.5" />删除
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 手机端卡片 */}
      <div className="md:hidden flex flex-col gap-3 p-4">
        {list.map((t) => (
          <div key={t.id} id={`todo-${t.id}`} className={cn("rounded-lg border border-[var(--border)] bg-[var(--card)] p-4", t.priority === "紧急" && "bg-red-50/60 dark:bg-red-950/20", t.id === highlightTodoId && "bg-amber-100 ring-2 ring-amber-400 dark:bg-amber-900/30")}>
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 break-words text-base font-semibold text-[var(--foreground)]">{t.content}</span>
              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium shrink-0", STATUS_CLASS[t.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{t.status}</span>
            </div>
            {t.latest_follow_content && (
              <div className="mt-1.5 break-words text-xs text-[var(--muted-foreground)]">
                最新：{t.latest_follow_content}
                <span className="ml-1 text-[var(--muted-foreground)]/70">· {t.latest_follow_by} · {toThaiTime(t.latest_follow_at)}</span>
              </div>
            )}
            {t.images && t.images.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <img src={fileUrl(t.images[0])} alt="" className="h-12 w-12 cursor-pointer rounded border border-[var(--border)] object-cover hover:opacity-80" onClick={() => openLightbox(t.images || [], 0)} />
                <Button size="xs" variant="outline" onClick={() => setPreviewImages(t.images || [])} className="gap-1">
                  <Image className="size-3" />查看（{t.images.length}）
                </Button>
              </div>
            )}
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">负责人</span><span className="min-w-0 break-words">{t.assignee || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">紧急程度</span>
                {t.priority === "紧急" ? <span className="inline-flex rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">紧急</span> : <span className="text-xs text-[var(--muted-foreground)]">普通</span>}
              </div>
              <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">创建时间</span><span className="text-xs">{toThaiTime(t.created_at) || "—"}</span></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => openEdit(t)} className="gap-1"><Pencil className="size-3.5" />编辑</Button>
              {t.latest_follow_content && (
                <Button size="sm" variant="ghost" onClick={() => openFollowHistory(t)} className="gap-1 text-[var(--muted-foreground)]"><History className="size-3.5" />历史</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => openFollow(t)} className="gap-1"><MessageSquare className="size-3.5" />跟进</Button>
              <Button size="sm" variant="outline" onClick={() => handleComplete(t)} className="gap-1"><Check className="size-3.5" />完成</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(t)} className="gap-1 text-[var(--destructive)]"><Trash2 className="size-3.5" />删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const rangeLabel = statsRange === "today" ? "今日" : statsRange === "week" ? "本周" : "本月";

  // 完成率 = 完成数 / (新增数 + 未完成数)，显示整体推进速度（百分比）
  const completionRate = (() => {
    const s = stats?.[statsRange];
    if (!s) return null;
    const denom = s.created + (stats?.unfinished ?? 0);
    if (denom <= 0) return null;
    return Math.round((s.completed / denom) * 100);
  })();

  // 活跃排行：按当前时间范围的跟进数降序，取前 5
  const activityRank = [...(stats?.employees ?? [])]
    .filter((e) => e[statsRange].followups > 0)
    .sort((a, b) => b[statsRange].followups - a[statsRange].followups)
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">我的待办</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">我的待办列表</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setShowInbox((o) => !o)} className="gap-1.5">
              <Bell className="size-3.5" />信息箱
              {inboxCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">{inboxCount > 99 ? "99+" : inboxCount}</span>
              )}
            </Button>
            {showInbox && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowInbox(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                    <span className="text-sm font-medium text-[var(--foreground)]">信息箱</span>
                    <button onClick={() => setShowInbox(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
                  </div>
                  <div className="max-h-80 overflow-y-auto p-2">
                    {unseen.length === 0 ? (
                      <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">没有未看过的待办更新</p>
                    ) : (
                      unseen.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => { markSeen(it.id); }}
                          className="flex w-full flex-col gap-1 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
                        >
                          <span className={cn("inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium", it.type === "新增" ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
                            {it.type}
                          </span>
                          <span className="text-sm text-[var(--foreground)]">{it.content}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{toThaiTime(it.created_at) || "—"}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <Button size="sm" onClick={openForm} className="gap-1.5">
            <Plus className="size-3.5" />新建待办
          </Button>
        </div>
      </div>

      {/* 待办看板（仅管理员/老板可见） */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-sm font-medium text-[var(--foreground)]">待办看板</h2>
            <button
              type="button"
              onClick={() => setBoardOpen(o => !o)}
              aria-expanded={boardOpen}
              aria-label={boardOpen ? "收起看板" : "展开看板"}
              className="flex size-7 items-center justify-center rounded-md text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <ChevronDown className={cn("size-4 transition-transform", boardOpen && "rotate-180")} />
            </button>
          </div>
          {boardOpen && (
            <>
              <div className="flex items-center justify-end border-b border-[var(--border)] px-5 py-2">
                <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
                  {([["today","今天"],["week","本周"],["month","本月"]] as [string,string][]).map(([k,l]) => (
                    <button key={k} onClick={() => setStatsRange(k as any)}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${statsRange===k?"bg-[var(--background)] text-[var(--foreground)] shadow-sm":"text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                    >{l}</button>
                  ))}
                </div>
              </div>
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 md:gap-2 md:p-3">
            {[
              { label: "未完成", value: stats?.unfinished ?? 0 },
              { label: `${rangeLabel}新增`, value: stats?.[statsRange]?.created ?? 0 },
              { label: `${rangeLabel}完成`, value: stats?.[statsRange]?.completed ?? 0 },
              { label: `${rangeLabel}跟进`, value: stats?.[statsRange]?.followups ?? 0 },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
                <span className="text-[0.7rem] font-medium text-[var(--muted-foreground)]">{s.label}</span>
                <span className="font-mono text-lg font-semibold tracking-tight tabular-nums text-[var(--foreground)]">{s.value.toLocaleString("zh-CN")}</span>
              </div>
            ))}
          </div>
          {/* 员工维度表：每个员工一行，四列指标跟着看板时间切换 */}
          <div className="border-t border-[var(--border)]">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--muted)]/20">
                    <th className="px-4 py-2 md:py-1.5 text-left text-xs font-medium text-[var(--muted-foreground)]">员工</th>
                    <th className="px-4 py-2 md:py-1.5 text-left text-xs font-medium text-[var(--muted-foreground)]">未完成数</th>
                    <th className="px-4 py-2 md:py-1.5 text-left text-xs font-medium text-[var(--muted-foreground)]">{rangeLabel}新增</th>
                    <th className="px-4 py-2 md:py-1.5 text-left text-xs font-medium text-[var(--muted-foreground)]">{rangeLabel}完成</th>
                    <th className="px-4 py-2 md:py-1.5 text-left text-xs font-medium text-[var(--muted-foreground)]">{rangeLabel}跟进</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats?.employees ?? []).map((emp) => (
                    <tr key={emp.name} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2 md:py-1.5 font-medium text-[var(--foreground)]">{emp.name}</td>
                      <td className="px-4 py-2 md:py-1.5 font-mono tabular-nums">{emp.unfinished}</td>
                      <td className="px-4 py-2 md:py-1.5 font-mono tabular-nums">{emp[statsRange].created}</td>
                      <td className="px-4 py-2 md:py-1.5 font-mono tabular-nums">{emp[statsRange].completed}</td>
                      <td className="px-4 py-2 md:py-1.5 font-mono tabular-nums">{emp[statsRange].followups}</td>
                    </tr>
                  ))}
                  {(stats?.employees ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-sm text-[var(--muted-foreground)]">暂无员工数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* 手机端卡片式：一屏看完，不横向滑动 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {(stats?.employees ?? []).map((emp) => (
                <div key={emp.name} className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{emp.name}</span>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">未完成 <span className="font-mono tabular-nums text-[var(--foreground)]">{emp.unfinished}</span></span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="rounded-md bg-[var(--muted)]/40 px-1.5 py-1.5 text-center">
                      <div className="text-[0.65rem] text-[var(--muted-foreground)]">{rangeLabel}新增</div>
                      <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--foreground)]">{emp[statsRange].created}</div>
                    </div>
                    <div className="rounded-md bg-[var(--muted)]/40 px-1.5 py-1.5 text-center">
                      <div className="text-[0.65rem] text-[var(--muted-foreground)]">{rangeLabel}完成</div>
                      <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--foreground)]">{emp[statsRange].completed}</div>
                    </div>
                    <div className="rounded-md bg-[var(--muted)]/40 px-1.5 py-1.5 text-center">
                      <div className="text-[0.65rem] text-[var(--muted-foreground)]">{rangeLabel}跟进</div>
                      <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--foreground)]">{emp[statsRange].followups}</div>
                    </div>
                  </div>
                </div>
              ))}
              {(stats?.employees ?? []).length === 0 && (
                <div className="py-4 text-center text-sm text-[var(--muted-foreground)]">暂无员工数据</div>
              )}
            </div>
          </div>

          {/* 积压提醒 + 完成率/趋势/排行 */}
          <div className="grid gap-0 border-t border-[var(--border)] md:grid-cols-2">
            {/* 左：积压提醒 */}
            <div className="p-5 md:border-r border-[var(--border)]">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                <AlertCircle className="size-4 text-red-500" />积压提醒
              </h3>
              {(stats?.backlog ?? []).length === 0 ? (
                <p className="py-2 text-sm text-[var(--muted-foreground)]">没有积压的待办</p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-[var(--muted-foreground)]">{(stats?.backlog ?? []).length} 个待办超过 3 天未完成，卡住了该催了：</p>
                  <div className="max-h-64 space-y-2 overflow-y-auto">
                    {(stats?.backlog ?? []).map((b) => (
                      <div
                        key={b.id}
                        onClick={() => jumpToTodo(b.assignee, b.id)}
                        className="cursor-pointer rounded-lg border border-red-200 bg-red-50 px-3 py-2 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/30 dark:hover:bg-red-950/60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-[var(--foreground)]">{b.content}</span>
                          <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">{b.days} 天</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">{b.assignee || "未分配"} · 创建于 {toThaiTime(b.created_at) || "—"}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 右：完成率 + 趋势对比 + 活跃排行 */}
            <div>
              <div className="border-b border-[var(--border)] p-5">
                <h3 className="mb-2 text-sm font-medium text-[var(--foreground)]">完成率（{rangeLabel}）</h3>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-semibold tabular-nums text-[var(--foreground)]">{completionRate == null ? "—" : `${completionRate}%`}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">完成 / (新增 + 未完成)</span>
                </div>
              </div>

              <div className="border-b border-[var(--border)] p-5">
                <h3 className="mb-3 text-sm font-medium text-[var(--foreground)]">趋势对比（本周 vs 上周）</h3>
                <div className="grid grid-cols-2 gap-3">
                  {(["created","completed"] as const).map((key) => {
                    const label = key === "created" ? "新增" : "完成";
                    const t = stats?.trend?.[key]?.this ?? 0;
                    const l = stats?.trend?.[key]?.last ?? 0;
                    const diff = t - l;
                    const up = diff >= 0;
                    return (
                      <div key={key} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="text-xs text-[var(--muted-foreground)]">{label}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-xl font-semibold tabular-nums">{t}</span>
                          <span className={cn("text-xs font-medium", diff === 0 ? "text-[var(--muted-foreground)]" : up ? "text-green-600" : "text-red-500")}>
                            {diff === 0 ? "持平" : up ? `↑ ${diff}` : `↓ ${Math.abs(diff)}`}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">上周 {l}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-5">
                <h3 className="mb-3 text-sm font-medium text-[var(--foreground)]">活跃排行（{rangeLabel}跟进）</h3>
                {activityRank.length === 0 ? (
                  <p className="py-2 text-sm text-[var(--muted-foreground)]">暂无跟进记录</p>
                ) : (
                  <ol className="space-y-1.5">
                    {activityRank.map((e, i) => (
                      <li key={e.name} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                        <span className="flex items-center gap-2.5">
                          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold", i === 0 ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : i === 1 ? "bg-slate-400/20 text-slate-500" : i === 2 ? "bg-orange-500/20 text-orange-600 dark:text-orange-400" : "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{i + 1}</span>
                          <span className="text-sm text-[var(--foreground)]">{e.name}</span>
                        </span>
                        <span className="font-mono text-sm tabular-nums text-[var(--muted-foreground)]">{e[statsRange].followups} 次</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>
      ) : selectedAssignee ? (
        // 点卡片进入：该员工的未完成待办列表（与之前一致）
        <div className="rounded-xl border border-[var(--border)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelectedAssignee(null)} className="gap-1 px-2">
                <ChevronLeft className="size-4" />返回
              </Button>
              <span className="text-sm font-medium text-[var(--foreground)]">{selectedAssignee}</span>
              <span className="text-xs text-[var(--muted-foreground)]">{selectedList.length} 项未完成</span>
            </div>
          </div>
          {selectedList.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无待办</div>
          ) : (
            renderTodoTable(selectedList)
          )}
        </div>
      ) : (
        // 卡片视图：员工一张自己的卡，管理员每个员工一张卡
        <div>
          {cards.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无员工</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setSelectedAssignee(c.name)}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition-colors hover:border-[var(--primary)]"
                >
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{c.name}</p>
                  <p className="mt-2 font-display text-3xl font-light tabular-nums text-[var(--foreground)] sm:text-4xl">{c.count}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">未完成待办</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 已完成分类：默认收起，点开看；时间筛选只作用于已完成 */}
      <div className="rounded-xl border border-[var(--border)]">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCompletedOpen((o) => !o)}
            className="flex flex-1 items-center gap-2 px-5 py-4 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
              {completedOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              已完成（{completedFiltered.length}）
            </span>
          </button>
          <select
            value={completedRange}
            onChange={(e) => setCompletedRange(e.target.value)}
            className="mr-4 h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="7d">最近7天</option>
            <option value="30d">最近30天</option>
          </select>
        </div>
        {completedOpen && (
          <div className="overflow-x-auto border-t border-[var(--border)]">
            {completedFiltered.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无已完成待办</div>
            ) : (
              <>
              <table className="w-full text-sm hidden md:table">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--secondary)]/50">
                    <th className="py-3 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">工作内容</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">负责人</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">完成时间</th>
                  </tr>
                </thead>
                <tbody>
                  {completedFiltered.map((t) => (
                    <tr key={t.id} className="border-b border-[var(--border)]">
                      <td className="py-3 px-5 text-[var(--muted-foreground)] line-through">{t.content}</td>
                      <td className="py-3 px-4 text-[var(--muted-foreground)]">{t.assignee || "—"}</td>
                      <td className="py-3 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(t.completed_at) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* 手机端卡片 */}
              <div className="md:hidden flex flex-col gap-3 p-4">
                {completedFiltered.map((t) => (
                  <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 break-words text-[var(--muted-foreground)] line-through">{t.content}</span>
                      <span className="text-xs text-[var(--muted-foreground)] shrink-0">{t.assignee || "—"}</span>
                    </div>
                    <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">完成于 {toThaiTime(t.completed_at) || "—"}</div>
                  </div>
                ))}
              </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 新建待办弹窗 */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!saving) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建待办</h3>
              <button onClick={() => setShowForm(false)} disabled={saving} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">工作内容（必填）</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                  onPaste={handleFormPaste}
                  rows={3}
                  placeholder="要做什么事"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                {isAdmin ? (
                  <select
                    value={form.assignee}
                    onChange={(e) => setForm((p) => ({ ...p, assignee: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-[var(--foreground)]">{user?.name || "—"}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">紧急程度</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="普通">普通</option>
                  <option value="紧急">紧急</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">图片（可选，可传多张）</label>
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]/30">
                  <ImagePlus className="size-4" />
                  {uploadingImages ? "上传中…" : "选择图片"}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={uploadingImages} />
                </label>
                {form.images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {form.images.map((url) => (
                      <div key={url} className="relative">
                        <img src={fileUrl(url)} alt="" className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
                        <button type="button" onClick={() => removeImage(url)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--destructive)] text-white" title="移除"><X className="size-3" /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)} disabled={saving}>取消</Button>
              <Button size="sm" onClick={handleSubmit} disabled={saving}>{saving ? "提交中…" : "提交"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 加跟进弹窗 */}
      {followTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!following) setFollowTarget(null); }}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">加跟进记录</h3>
              <button onClick={() => setFollowTarget(null)} disabled={following} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">待办：{followTarget.content}</p>
            <textarea
              value={followContent}
              onChange={(e) => setFollowContent(e.target.value)}
              onPaste={handleFollowPaste}
              rows={3}
              placeholder="写这次更新了什么"
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-3">
              <label className="mb-1 block text-xs text-[var(--muted-foreground)]">图片（可选，可传多张）</label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]/30">
                <ImagePlus className="size-4" />
                {followUploading ? "上传中…" : "选择图片"}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleFollowImageUpload} disabled={followUploading} />
              </label>
              {followImages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {followImages.map((url) => (
                    <div key={url} className="relative">
                      <img src={fileUrl(url)} alt="" className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
                      <button type="button" onClick={() => removeFollowImage(url)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--destructive)] text-white" title="移除"><X className="size-3" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setFollowTarget(null)} disabled={following}>取消</Button>
              <Button size="sm" onClick={handleFollow} disabled={following}>{following ? "提交中…" : "提交跟进"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 图片预览弹窗 */}
      {previewImages && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreviewImages(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">图片预览（{previewImages.length}）</h3>
              <button onClick={() => setPreviewImages(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <div className="flex flex-col gap-3">
              {previewImages.map((url, i) => (
                <img key={i} src={fileUrl(url)} alt={`图片 ${i + 1}`} className="w-full cursor-pointer rounded-md border border-[var(--border)] hover:opacity-90" onClick={() => openLightbox(previewImages, i)} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 全屏灯箱：放大看大图 + 左右切换 */}
      {lightboxImages && lightboxImages.length > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90" onClick={() => setLightboxImages(null)}>
          <button
            onClick={() => setLightboxImages(null)}
            className="absolute right-4 top-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="关闭"
          >
            <X className="size-6" />
          </button>
          {lightboxImages.length > 1 && lightboxIdx > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => i - 1); }}
              className="absolute left-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="上一张"
            >
              <ChevronLeft className="size-6" />
            </button>
          )}
          <img
            src={fileUrl(lightboxImages[lightboxIdx])}
            alt=""
            className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxImages.length > 1 && lightboxIdx < lightboxImages.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIdx((i) => i + 1); }}
              className="absolute right-3 top-1/2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              aria-label="下一张"
            >
              <ChevronRight className="size-6" />
            </button>
          )}
          {lightboxImages.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm text-white">
              {lightboxIdx + 1} / {lightboxImages.length}
            </div>
          )}
        </div>
      )}

      {/* 跟进历史弹窗 */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistoryTarget(null)}>
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">跟进历史</h3>
              <button onClick={() => setHistoryTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">待办：{historyTarget.content}</p>
            {loadingHistory ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
            ) : historyRecords.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无跟进记录</p>
            ) : (
              <div className="space-y-3">
                {historyRecords.map((h) => (
                  <div key={h.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--foreground)]">{h.created_by}</span>
                      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(h.created_at) || "—"}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{h.content}</p>
                    {h.images && h.images.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {h.images.map((url, i) => (
                          <img
                            key={i}
                            src={fileUrl(url)}
                            alt=""
                            className="h-14 w-14 cursor-pointer rounded-md border border-[var(--border)] object-cover hover:opacity-80"
                            onClick={() => openLightbox(h.images, i)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 编辑待办弹窗 */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!savingEdit) setEditTarget(null); }}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">编辑待办</h3>
              <button onClick={() => setEditTarget(null)} disabled={savingEdit} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">工作内容（必填）</label>
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm((p) => ({ ...p, content: e.target.value }))}
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">紧急程度</label>
                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm((p) => ({ ...p, priority: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="普通">普通</option>
                  <option value="紧急">紧急</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                {isAdmin ? (
                  <select
                    value={editForm.assignee}
                    onChange={(e) => setEditForm((p) => ({ ...p, assignee: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-[var(--foreground)]">{editForm.assignee || user?.name || "—"}</p>
                )}
              </div>

              {err && <p className="text-xs text-[var(--destructive)]">{err}</p>}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditTarget(null)} disabled={savingEdit}>取消</Button>
              <Button size="sm" onClick={handleEditSave} disabled={savingEdit}>{savingEdit ? "保存中…" : "保存"}</Button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!deleting) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">删除待办</h3>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              确认删除待办「{deleteTarget.content}」？将连同它的所有跟进记录和图片一起删除，无法恢复！
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
              <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting ? "删除中…" : "确认删除"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
