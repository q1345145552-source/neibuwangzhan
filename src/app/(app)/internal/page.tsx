"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { AlertTriangle, Bell, CheckCircle2, Clock, Plus, UserCheck, Users, Calendar, FileEdit, TrendingUp, Download } from "lucide-react";

interface Workload {
  name: string; orderSteps: number; influencerSteps: number; contractInfs: number; total: number; level: "ok" | "warn" | "critical";
}
interface WorkloadData { employees: Workload[]; thresholds: { warn: number; crit: number }; }

interface IssueTicket {
  id: number; ticket_number: string; ref_id: string; ref_type: string;
  description: string; priority: string; status: string; assignee: string;
  created_by: string; resolved_by: string; created_at: string;
}

interface LeaveRequest {
  id: number; employee_name: string; leave_type: string;
  start_date: string; end_date: string; reason: string; status: string;
  approved_by: string; created_at: string;
}

interface Notification {
  id: number; type: string; title: string; body: string;
  recipient: string; related_id: string; related_type: string;
  is_read: number; created_at: string;
}

const staffNames = ["Ploy", "元丽", "Prae", "Namcha", "Bam", "Fern", "Ing", "Pop", "Eve"];

export default function InternalPage() {
  const { user } = useAuth();
  const [wl, setWl] = useState<WorkloadData | null>(null);
  const [issues, setIssues] = useState<IssueTicket[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [attendanceAction, setAttendanceAction] = useState<"check_in" | "check_out" | null>(null);
  const [todayRecord, setTodayRecord] = useState<any>(null);

  // Issue form
  const [issueForm, setIssueForm] = useState({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: "" });
  const [issueErr, setIssueErr] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);

  // Leave form
  const [leaveForm, setLeaveForm] = useState({ leave_type: "事假", start_date: "", end_date: "", reason: "" });
  const [leaveErr, setLeaveErr] = useState("");

  const loadAll = async () => {
    try {
      const leaveUrl = isAdmin ? "/api/leave?status=待审批" : `/api/leave?employee=${encodeURIComponent(user?.name || "")}`;
      const [wlRes, isRes, lvRes] = await Promise.all([
        fetchWithAuth("/api/internal/workload", { cache: "no-store" }),
        fetchWithAuth("/api/issues", { cache: "no-store" }),
        fetchWithAuth(leaveUrl, { cache: "no-store" }),
      ]);
      setWl(await wlRes.json());
      setIssues(await isRes.json());
      setLeaves(await lvRes.json());
      const notifRes = await fetchWithAuth(`/api/notifications?recipient=${user?.name || ""}&limit=30`, { cache: "no-store" });
      setNotifications(await notifRes.json());
    } catch {}
  };

  const loadAttendance = async () => {
    try {
      const res = await fetchWithAuth(`/api/attendance?employee=${user?.name || ""}`, { cache: "no-store" });
      const data = await res.json();
      const today = new Date().toISOString().split("T")[0];
      setTodayRecord((Array.isArray(data) ? data : []).find((r: any) => r.date === today) || null);
    } catch {}
  };

  useEffect(() => { loadAll(); loadAttendance(); }, []);

  const handleExportAttendance = async () => {
    try {
      const res = await fetchWithAuth("/api/attendance", { cache: "no-store" });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      const cols: ExportColumn<any>[] = [
        { header: "员工", key: "employee_name" },
        { header: "日期", key: "date" },
        { header: "签到时间", render: (r) => r.check_in || "—" },
        { header: "签退时间", render: (r) => r.check_out || "—" },
        { header: "工时(小时)", render: (r) => r.work_hours != null ? String(r.work_hours) : "—" },
      ];
      exportToExcel(arr, cols, `考勤记录_${new Date().toISOString().slice(0, 10)}`);
    } catch {}
  };

  const handleAttendance = async (action: "check_in" | "check_out") => {
    try {
      const res = await fetchWithAuth("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: user?.name, action }),
      });
      if (!res.ok) { const e = await res.json(); alert(e.error); return; }
      loadAttendance();
    } catch {}
  };

  const handleCreateIssue = async () => {
    if (!issueForm.description.trim()) { setIssueErr("请填写问题描述"); return; }
    setIssueSaving(true);
    try {
      await fetchWithAuth("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...issueForm, created_by: user?.name }),
      });
      setShowIssueForm(false);
      setIssueForm({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: "" });
      setIssueErr("");
      loadAll();
    } catch {} finally { setIssueSaving(false); }
  };

  const handleResolveIssue = async (id: number) => {
    await fetchWithAuth("/api/issues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "已解决", resolved_by: user?.name }),
    });
    loadAll();
  };

  const handleCreateLeave = async () => {
    if (!leaveForm.start_date || !leaveForm.end_date) { setLeaveErr("请选择日期"); return; }
    try {
      await fetchWithAuth("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaveForm, employee_name: user?.name }),
      });
      setShowLeaveForm(false);
      setLeaveForm({ leave_type: "事假", start_date: "", end_date: "", reason: "" });
      setLeaveErr("");
      loadAll();
    } catch {}
  };

  const handleApproveLeave = async (id: number, status: string) => {
    await fetchWithAuth("/api/leave", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, approved_by: user?.name }),
    });
    loadAll();
  };

  const markNotifRead = async (id: number) => {
    await fetchWithAuth("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
  };

  const markAllNotifRead = async () => {
    await fetchWithAuth("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true, recipient: user?.name }),
    });
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
  };

  const isAdmin = user?.role === "admin";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">内部管理</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">问题工单 · 工作量 · 考勤打卡</p>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => window.location.href = "/internal/weekly-report"}>周报</Button>
        </div>
      </div>

      {/* ── 考勤打卡 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><Calendar className="size-4" />今日考勤</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportAttendance}><Download className="size-3" />导出考勤</Button>
            {todayRecord?.check_in ? (
              <span className="text-xs text-[var(--muted-foreground)]">签到 {todayRecord.check_in}</span>
            ) : (
              <Button size="sm" className="h-7 text-xs" onClick={() => handleAttendance("check_in")}>签到打卡</Button>
            )}
            {todayRecord?.check_in && !todayRecord?.check_out && (
              <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => handleAttendance("check_out")}>签退</Button>
            )}
            {todayRecord?.check_out && (
              <span className="text-xs text-[var(--success)] font-medium">工时 {todayRecord.work_hours}h · 签退 {todayRecord.check_out}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 通知中心 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><Bell className="size-4" />通知中心</h2>
          {notifications.some(n => n.is_read === 0) && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={markAllNotifRead}>全部已读</Button>
          )}
        </div>
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无通知</div>
        ) : (
          <div className="divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
            {notifications.map(n => (
              <div
                key={n.id}
                onClick={() => { if (n.is_read === 0) markNotifRead(n.id); }}
                className={cn(
                  "px-5 py-3 cursor-pointer transition-colors hover:bg-[var(--muted)]/50",
                  n.is_read === 0 ? "border-l-2 border-l-blue-500 bg-blue-50/30 dark:bg-blue-950/10" : "text-[var(--muted-foreground)]"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{n.created_at?.slice(0, 16)}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{n.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 工作量预警 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2"><Users className="size-4" />工作量总览</h2>
            <span className="text-xs text-[var(--muted-foreground)]">
              预警阈值: {wl?.thresholds.warn || 5}项 / 严重: {wl?.thresholds.crit || 8}项
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">员工</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">订单步骤</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">达人步骤</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">签约跟进</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">合计</th>
              </tr>
            </thead>
            <tbody>
              {(wl?.employees || []).map((e: Workload) => (
                <tr key={e.name} className={cn(
                  "border-b border-[var(--border)]",
                  e.level === "critical" && "bg-red-50/60 dark:bg-red-950/20",
                  e.level === "warn" && "bg-amber-50/60 dark:bg-amber-950/20"
                )}>
                  <td className="py-2.5 px-5 font-medium flex items-center gap-2">
                    {e.name}
                    {e.level === "critical" && <AlertTriangle className="size-3 text-red-500" />}
                    {e.level === "warn" && <AlertTriangle className="size-3 text-amber-500" />}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{e.orderSteps}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{e.influencerSteps}</td>
                  <td className="py-2.5 px-4 text-center tabular-nums">{e.contractInfs}</td>
                  <td className={cn(
                    "py-2.5 px-4 text-center tabular-nums font-semibold",
                    e.level === "critical" && "text-red-600",
                    e.level === "warn" && "text-amber-600"
                  )}>{e.total}</td>
                </tr>
              ))}
              {(!wl || wl.employees.length === 0) && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无进行中的任务</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 问题工单 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><FileEdit className="size-4" />问题工单 ({issues.length})</h2>
          <Button size="sm" className="h-7 text-xs" onClick={() => setShowIssueForm(true)}><Plus className="size-3" />新建工单</Button>
        </div>

        {showIssueForm && (
          <div className="p-5 border-b border-[var(--border)]">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium">关联编号</label>
                <input value={issueForm.ref_id} onChange={e => setIssueForm(p => ({ ...p, ref_id: e.target.value }))} placeholder="订单编号或达人编号"
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs font-medium">紧急程度</label>
                <select value={issueForm.priority} onChange={e => setIssueForm(p => ({ ...p, priority: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="urgent">紧急</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">指定解决人</label>
                <select value={issueForm.assignee} onChange={e => setIssueForm(p => ({ ...p, assignee: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="">不指定</option>
                  {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">问题描述</label>
                <textarea value={issueForm.description} onChange={e => setIssueForm(p => ({ ...p, description: e.target.value }))} rows={2}
                  placeholder="详细描述遇到的问题..." className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)] resize-none" />
              </div>
            </div>
            {issueErr && <p className="mt-2 text-xs text-[var(--destructive)]">{issueErr}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleCreateIssue} disabled={issueSaving}>{issueSaving ? "创建中..." : "提交工单"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowIssueForm(false)}>取消</Button>
            </div>
          </div>
        )}

        {issues.length === 0 && !showIssueForm ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无问题工单</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-4 text-left text-xs font-medium">描述</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium max-md:hidden">关联</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">优先级</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">解决人</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">状态</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {issues.map(t => (
                  <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)]">
                    <td className="py-2.5 px-4 max-w-[200px] truncate">{t.description}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-md:hidden">{t.ref_id || "-"}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        t.priority === "urgent" && "bg-red-100 text-red-700",
                        t.priority === "high" && "bg-orange-100 text-orange-700",
                        t.priority === "medium" && "bg-blue-100 text-blue-700",
                        t.priority === "low" && "bg-gray-100 text-gray-700"
                      )}>{t.priority}</span>
                    </td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{t.assignee || "—"}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        t.status === "已解决" && "bg-green-100 text-green-700",
                        t.status === "处理中" && "bg-blue-100 text-blue-700",
                        "bg-gray-100 text-gray-700"
                      )}>{t.status}</span>
                    </td>
                    <td className="py-2.5 px-4">
                      {t.status !== "已解决" && (
                        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => handleResolveIssue(t.id)}>
                          <CheckCircle2 className="size-3 mr-1" />解决
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 请假审批 / 我的请假 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><UserCheck className="size-4" />{isAdmin ? "请假审批" : "我的请假"}</h2>
          <Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => setShowLeaveForm(true)}><Plus className="size-3" />申请请假</Button>
        </div>

        {showLeaveForm && (
          <div className="p-5 border-b border-[var(--border)]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium">请假类型</label>
                <select value={leaveForm.leave_type} onChange={e => setLeaveForm(p => ({ ...p, leave_type: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="事假">事假</option><option value="病假">病假</option><option value="年假">年假</option><option value="其他">其他</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">开始日期</label>
                <input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(p => ({ ...p, start_date: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">结束日期</label>
                <input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(p => ({ ...p, end_date: e.target.value }))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
              <div className="sm:col-span-3">
                <label className="text-xs font-medium">原因</label>
                <input value={leaveForm.reason} onChange={e => setLeaveForm(p => ({ ...p, reason: e.target.value }))} placeholder="请假原因..."
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>
            {leaveErr && <p className="mt-2 text-xs text-[var(--destructive)]">{leaveErr}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleCreateLeave}>提交申请</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowLeaveForm(false)}>取消</Button>
            </div>
          </div>
        )}

        {leaves.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">{isAdmin ? "暂无待审批的请假" : "暂无请假记录"}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 px-4 text-left text-xs font-medium">申请人</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">日期</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                  {isAdmin && <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>}
                </tr>
              </thead>
              <tbody>
                {leaves.map(l => (
                  <tr key={l.id} className="border-b border-[var(--border)]">
                    <td className="py-2.5 px-4 font-medium">{l.employee_name}</td>
                    <td className="py-2.5 px-4">{l.leave_type}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{l.start_date} ~ {l.end_date}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{l.reason || "—"}</td>
                    {isAdmin && (
                      <td className="py-2.5 px-4 flex gap-1.5">
                        <Button size="sm" className="h-6 text-xs bg-green-500 hover:bg-green-600" onClick={() => handleApproveLeave(l.id, "已通过")}>通过</Button>
                        <Button size="sm" variant="outline" className="h-6 text-xs text-red-500" onClick={() => handleApproveLeave(l.id, "已驳回")}>驳回</Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
