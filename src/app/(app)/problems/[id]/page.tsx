"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, fileUrl } from "@/lib/utils";
import { bangkokToday } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Paperclip, Trash2, Pencil, X } from "lucide-react";

interface FollowUp {
  id: number;
  problem_id: number;
  content: string;
  created_by: string;
  created_at: string;
}

interface Attachment {
  id: number;
  problem_id: number;
  name: string;
  url: string;
  uploaded_by: string;
  created_at: string;
}

interface ProblemDetail {
  id: number;
  problem_number: string;
  company_name: string;
  problem_type: string;
  status: string;
  assignee: string;
  priority: string;
  source: string;
  description: string;
  customer_requirement: string;
  deadline: string;
  resolve_note: string;
  resolved_at: string;
  suspend_reason: string;
  order_id: string;
  created_by: string;
  created_at: string;
  follow_ups: FollowUp[];
  attachments: Attachment[];
}

const STATUS_CLASS: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "跟进中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已解决": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "老板验收": "bg-[color-mix(in_oklch,var(--primary),var(--background)_88%)] text-[var(--primary)]",
  "搁置": "bg-[var(--muted)] text-[var(--muted-foreground)]",
};

const PROBLEM_TYPES = ["税务问题", "证件问题", "地址变更问题", "年审问题", "代持问题", "合同问题", "金额问题"];
const PRIORITIES = ["普通", "紧急", "不急"];
const SOURCES = ["客户反馈", "内部发现"];

// 截止日期预警：未解决的问题，已超期标红、3 天内到期标黄
function deadlineState(deadline: string | undefined | null, status: string): "overdue" | "soon" | null {
  if (!deadline || status === "已解决") return null;
  const today = bangkokToday();
  if (deadline < today) return "overdue";
  const diff = Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000);
  if (diff <= 3) return "soon";
  return null;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--muted-foreground)]">{label}</span>
      <div className="text-sm text-[var(--foreground)]">{children}</div>
    </div>
  );
}

export default function ProblemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [showSuspendModal, setShowSuspendModal] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [orders, setOrders] = useState<{ id: string; customer_name: string }[]>([]);
  const [orderId, setOrderId] = useState("");
  const [linking, setLinking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: "",
    description: "",
    problem_type: "税务问题",
    source: "客户反馈",
    assignee: "",
    priority: "普通",
    deadline: "",
    customer_requirement: "",
  });

  const load = () => {
    fetchWithAuth(`/api/problems/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setProblem(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id]);

  // 拉订单列表（关联订单选择）+ 员工列表（编辑负责人）
  useEffect(() => {
    fetchWithAuth("/api/orders").then((r) => r.json()).then((d) => setOrders(Array.isArray(d) ? d : [])).catch(() => {});
    fetchWithAuth("/api/employees").then((r) => r.json()).then((d) => setEmployees(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // 问题加载后同步当前关联订单
  useEffect(() => { if (problem) setOrderId(problem.order_id || ""); }, [problem]);

  const canManage = problem && (user?.role === "admin" || user?.name === problem.assignee);
  const isBoss = user?.role === "admin";

  const handleAddFollowUp = async () => {
    if (!content.trim()) { setErr("请填写跟进内容"); return; }
    setSaving(true);
    setErr("");
    try {
      const res = await fetchWithAuth(`/api/problems/${id}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      if (res.ok) {
        setContent("");
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "添加失败");
      }
    } catch { setErr("添加失败"); }
    finally { setSaving(false); }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const upRes = await fetchWithAuth("/api/upload", { method: "POST", body: form });
      if (!upRes.ok) { setErr("文件上传失败"); return; }
      const upData = await upRes.json();
      const res = await fetchWithAuth(`/api/problems/${id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, url: upData.url }),
      });
      if (res.ok) {
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        setErr(e.error || "附件保存失败");
      }
    } catch { setErr("文件上传失败"); }
    finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDeleteAttachment = async (attachmentId: number) => {
    if (!confirm("确认删除该附件？")) return;
    try {
      const res = await fetchWithAuth(`/api/problems/${id}/attachments?id=${attachmentId}`, { method: "DELETE" });
      if (res.ok) load();
      else { const e = await res.json().catch(() => ({})); alert(e.error || "删除失败"); }
    } catch { alert("删除失败"); }
  };

  const handleStatusChange = async (status: string, payload: { resolve_note?: string; suspend_reason?: string } = {}) => {
    setErr("");
    try {
      const res = await fetchWithAuth(`/api/problems/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...payload }),
      });
      if (res.ok) {
        setShowResolveModal(false);
        setResolveNote("");
        setShowSuspendModal(false);
        setSuspendReason("");
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "操作失败");
      }
    } catch { alert("操作失败"); }
  };

  const handleResolve = () => {
    if (!resolveNote.trim()) { alert("请填写解决说明"); return; }
    handleStatusChange("老板验收", { resolve_note: resolveNote.trim() });
  };

  const handleSuspend = () => {
    if (!suspendReason.trim()) { alert("请填写搁置原因"); return; }
    handleStatusChange("搁置", { suspend_reason: suspendReason.trim() });
  };

  const handleLinkOrder = async () => {
    setErr("");
    setLinking(true);
    try {
      const res = await fetchWithAuth(`/api/problems/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      if (res.ok) {
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "关联失败");
      }
    } catch { alert("关联失败"); }
    finally { setLinking(false); }
  };

  const handleDelete = async () => {
    if (!problem) return;
    // 权限：只有负责人或管理员能删
    if (!canManage) { alert("只有负责人或管理员能删除问题"); return; }
    // 状态限制：只有已解决/搁置能删
    if (problem.status !== "已解决" && problem.status !== "搁置") {
      alert("当前状态不能删除，只有已解决或搁置的问题能删除");
      return;
    }
    // 确认框：写清楚级联删除 + 无法恢复
    if (!confirm("确认删除该问题？将连同它的所有跟进记录和附件一起删除，无法恢复！")) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/problems/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/problems");
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "删除失败");
      }
    } catch { alert("删除失败"); }
    finally { setDeleting(false); }
  };

  const openEdit = () => {
    if (!problem) return;
    setEditForm({
      company_name: problem.company_name || "",
      description: problem.description || "",
      problem_type: problem.problem_type || "税务问题",
      source: problem.source || "客户反馈",
      assignee: problem.assignee || "",
      priority: problem.priority || "普通",
      deadline: problem.deadline || "",
      customer_requirement: problem.customer_requirement || "",
    });
    setShowEditModal(true);
  };

  const handleEditSave = async () => {
    if (!editForm.company_name.trim()) { alert("请填写公司名"); return; }
    if (!editForm.description.trim()) { alert("请填写问题描述"); return; }
    if (!editForm.assignee) { alert("请选择负责人"); return; }
    setSavingEdit(true);
    try {
      const res = await fetchWithAuth(`/api/problems/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        setShowEditModal(false);
        load();
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "保存失败");
      }
    } catch { alert("保存失败"); }
    finally { setSavingEdit(false); }
  };

  if (loading) return <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</div>;
  if (!problem) return <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">问题不存在</div>;

  const deadlineWarn = deadlineState(problem.deadline, problem.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回问题列表"><ArrowLeft className="size-4" /></Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{problem.problem_number}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{problem.company_name}</p>
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={openEdit} className="gap-1.5">
            <Pencil className="size-4" />编辑
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting} className="gap-1.5">
          <Trash2 className="size-4" />{deleting ? "删除中…" : "删除"}
        </Button>
      </div>

      {/* 状态流转操作（仅负责人/管理员；验收/退回仅老板） */}
      {canManage && problem.status !== "已解决" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-3">
          <span className="text-sm text-[var(--muted-foreground)]">状态操作：</span>
          {problem.status === "待处理" && (
            <>
              <Button size="sm" onClick={() => handleStatusChange("跟进中")}>开始处理</Button>
              <Button size="sm" variant="outline" onClick={() => setShowSuspendModal(true)}>搁置</Button>
            </>
          )}
          {problem.status === "跟进中" && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleStatusChange("待处理")}>改回待处理</Button>
              <Button size="sm" onClick={() => setShowResolveModal(true)}>标记已解决</Button>
              <Button size="sm" variant="outline" onClick={() => setShowSuspendModal(true)}>搁置</Button>
            </>
          )}
          {problem.status === "老板验收" && (
            <>
              {isBoss ? (
                <>
                  <Button size="sm" onClick={() => handleStatusChange("已解决")}>验收通过</Button>
                  <Button size="sm" variant="outline" onClick={() => handleStatusChange("跟进中")}>退回跟进中</Button>
                </>
              ) : (
                <span className="text-xs text-[var(--muted-foreground)]">等待老板验收</span>
              )}
              <Button size="sm" variant="outline" onClick={() => setShowSuspendModal(true)}>搁置</Button>
            </>
          )}
          {problem.status === "搁置" && (
            <Button size="sm" onClick={() => handleStatusChange("跟进中")}>重新激活</Button>
          )}
        </div>
      )}

      {/* 老板验收：显示解决说明，等待老板验收 */}
      {problem.status === "老板验收" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-3">
          <p className="text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">解决说明：</span>{problem.resolve_note || "—"}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">负责人已标记解决，等待老板验收</p>
        </div>
      )}

      {/* 已解决时显示解决说明和时间 */}
      {problem.status === "已解决" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-3">
          <p className="text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">解决说明：</span>{problem.resolve_note || "—"}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">解决时间：{toThaiTime(problem.resolved_at) || "—"}</p>
        </div>
      )}

      {/* 搁置：显示搁置原因 */}
      {problem.status === "搁置" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-3">
          <p className="text-sm text-[var(--foreground)]"><span className="text-xs text-[var(--muted-foreground)]">搁置原因：</span>{problem.suspend_reason || "—"}</p>
        </div>
      )}

      {/* 基本信息 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <InfoRow label="问题编号"><span className="font-mono">{problem.problem_number}</span></InfoRow>
          <InfoRow label="公司名">{problem.company_name}</InfoRow>
          <InfoRow label="状态">
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[problem.status] || "bg-[var(--muted)] text-[var(--muted-foreground)]")}>{problem.status}</span>
          </InfoRow>
          <InfoRow label="问题类型">{problem.problem_type}</InfoRow>
          <InfoRow label="来源">{problem.source}</InfoRow>
          <InfoRow label="负责人">{problem.assignee || "—"}</InfoRow>
          <InfoRow label="紧急程度">
            {problem.priority === "紧急" ? <span className="font-medium text-red-600 dark:text-red-400">紧急</span> : problem.priority === "不急" ? <span className="text-[var(--muted-foreground)]">不急</span> : <span className="text-[var(--muted-foreground)]">普通</span>}
          </InfoRow>
          <InfoRow label="截止日期">
            {problem.deadline ? (
              <span className={cn(
                deadlineWarn === "overdue" && "font-medium text-red-600 dark:text-red-400",
                deadlineWarn === "soon" && "font-medium text-amber-600 dark:text-amber-400"
              )}>
                {problem.deadline}
                {deadlineWarn === "overdue" && <span className="ml-2 text-xs">已超期</span>}
                {deadlineWarn === "soon" && <span className="ml-2 text-xs">即将到期</span>}
              </span>
            ) : "—"}
          </InfoRow>
          <InfoRow label="创建时间">{toThaiTime(problem.created_at) || "—"}</InfoRow>
        </div>
        <div className="mt-4">
          <InfoRow label="问题描述">{problem.description || "—"}</InfoRow>
        </div>
        {problem.customer_requirement && (
          <div className="mt-4">
            <InfoRow label="客户需求">{problem.customer_requirement}</InfoRow>
          </div>
        )}
      </div>

      {/* 关联订单 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-[var(--foreground)]">关联订单</h3>
          {problem.order_id ? (
            <Link href={`/orders/${problem.order_id}`} className="font-mono text-sm text-[var(--primary)] hover:underline">
              {problem.order_id}
            </Link>
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]">未关联</span>
          )}
        </div>
        {canManage ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="min-w-[240px] flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            >
              <option value="">不关联订单</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>{o.id} · {o.customer_name}</option>
              ))}
            </select>
            <Button size="sm" onClick={handleLinkOrder} disabled={linking}>{linking ? "保存中…" : "保存关联"}</Button>
          </div>
        ) : (
          <p className="mt-3 text-sm text-[var(--muted-foreground)]">只有负责人或管理员能修改关联订单</p>
        )}
      </div>

      {/* 跟进记录 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="text-sm font-medium text-[var(--foreground)]">跟进记录</h3>

        {/* 添加跟进 */}
        <div className="mt-4">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder={canManage ? "写跟进内容…" : "只有负责人或管理员能添加跟进记录"}
            disabled={!canManage}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
          />
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={handleAddFollowUp} disabled={!canManage || saving}>
              {saving ? "提交中…" : "提交跟进"}
            </Button>
          </div>
        </div>

        {/* 跟进列表 */}
        {problem.follow_ups.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无跟进记录</p>
        ) : (
          <div className="mt-4 space-y-3">
            {problem.follow_ups.map((f) => (
              <div key={f.id} className="rounded-md border border-[var(--border)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-[var(--foreground)]">{f.created_by}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{toThaiTime(f.created_at) || "—"}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{f.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 附件区 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
        <h3 className="text-sm font-medium text-[var(--foreground)]">附件</h3>

        {canManage && (
          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]/30">
            <Paperclip className="size-4" />
            {uploading ? "上传中…" : "上传附件"}
            <input type="file" className="hidden" onChange={handleUploadFile} disabled={uploading} />
          </label>
        )}

        {problem.attachments.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">暂无附件</p>
        ) : (
          <div className="mt-4 space-y-2">
            {problem.attachments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2">
                <a href={fileUrl(a.url)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm text-[var(--primary)] hover:underline">
                  {a.name}
                </a>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">{a.uploaded_by} · {toThaiTime(a.created_at) || "—"}</span>
                {canManage && (
                  <button onClick={() => handleDeleteAttachment(a.id)} className="shrink-0 text-[var(--destructive)] hover:opacity-70" aria-label="删除附件">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 标记已解决弹窗 */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowResolveModal(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">标记已解决</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">请填写解决说明（怎么解决的），提交后将进入「老板验收」状态：</p>
            <textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              rows={3}
              placeholder="说明是怎么解决的"
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowResolveModal(false)}>取消</Button>
              <Button size="sm" onClick={handleResolve}>提交待验收</Button>
            </div>
          </div>
        </div>
      )}

      {/* 搁置弹窗 */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSuspendModal(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">搁置问题</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">请填写搁置原因：</p>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              rows={3}
              placeholder="说明为什么要搁置"
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSuspendModal(false)}>取消</Button>
              <Button size="sm" onClick={handleSuspend}>确认搁置</Button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑问题弹窗 */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!savingEdit) setShowEditModal(false); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">编辑问题</h3>
              <button onClick={() => setShowEditModal(false)} disabled={savingEdit} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">公司名</label>
                <input
                  value={editForm.company_name}
                  onChange={(e) => setEditForm((p) => ({ ...p, company_name: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">问题描述</label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">问题类型</label>
                  <select
                    value={editForm.problem_type}
                    onChange={(e) => setEditForm((p) => ({ ...p, problem_type: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {PROBLEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">来源</label>
                  <select
                    value={editForm.source}
                    onChange={(e) => setEditForm((p) => ({ ...p, source: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">负责人</label>
                  <select
                    value={editForm.assignee}
                    onChange={(e) => setEditForm((p) => ({ ...p, assignee: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    <option value="">请选择</option>
                    {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">紧急程度</label>
                  <select
                    value={editForm.priority}
                    onChange={(e) => setEditForm((p) => ({ ...p, priority: e.target.value }))}
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                  >
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">截止日期</label>
                <input
                  type="date"
                  value={editForm.deadline}
                  onChange={(e) => setEditForm((p) => ({ ...p, deadline: e.target.value }))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">客户需求</label>
                <textarea
                  value={editForm.customer_requirement}
                  onChange={(e) => setEditForm((p) => ({ ...p, customer_requirement: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowEditModal(false)} disabled={savingEdit}>取消</Button>
              <Button size="sm" onClick={handleEditSave} disabled={savingEdit}>{savingEdit ? "保存中…" : "保存"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
