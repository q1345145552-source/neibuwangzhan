"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiDate } from "@/lib/utils";
import { toThaiTimeOnly as toBangkokTime, bangkokMonthKey, bangkokDateStr, bangkokLastDayOfMonth, bangkokDayOfWeek } from "@/lib/time";

import { StepTimerStatic } from "@/components/step-timer";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { AlertTriangle, Bell, CheckCircle2, Clock, Plus, UserCheck, Users, Calendar, FileEdit, TrendingUp, Download, LogIn, LogOut, History, Timer, AlertCircle, Camera, Image, X, ChevronLeft, ChevronRight, Eye, ExternalLink, Loader2, Trash2 } from "lucide-react";

interface Workload {
  name: string; orderSteps: number; influencerSteps: number; contractInfs: number; total: number; level: "ok" | "warn" | "critical";
}
interface WorkloadData { employees: Workload[]; thresholds: { warn: number; crit: number }; }

interface IssueTicket {
  id: number; ticket_number: string; ref_id: string; ref_type: string;
  description: string; priority: string; status: string; assignee: string;
  created_by: string; resolved_by: string; withdrawn_by?: string; withdrawn_at?: string;
  created_at: string;
  images?: string;
  resolve_screenshot?: string;
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

interface AttendanceRequest {
  id: number; employee_name: string; date: string; time: string;
  type: string; reason: string; photo: string; status: string; approved_by: string;
  approved_at: string; created_at: string;
}
interface TodayStatus {
  name: string; hasCheckedIn: boolean; hasCheckedOut: boolean;
  checkInTime: string | null; checkOutTime: string | null;
  workHours: number | null; type: string | null;
  isOnLeave: boolean; leaveType: string | null;
}
interface MonthlySummary {
  name: string; month: string; totalHours: number; lateCount: number;
  absentCount: number; leaveCount: number; normalDays: number;
  supplementDays: number; workDays: number;
}


export default function InternalPage() {
  const { user } = useAuth();
  const [staffNames, setStaffNames] = useState<string[]>([]);
  const [wl, setWl] = useState<WorkloadData | null>(null);
  const [issues, setIssues] = useState<IssueTicket[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [todayRecord, setTodayRecord] = useState<any>(null);
  const [clockAnim, setClockAnim] = useState<"in" | "out" | null>(null);
  const [currentTime, setCurrentTime] = useState("");
  const [attendanceRequests, setAttendanceRequests] = useState<AttendanceRequest[]>([]);
  const [todayStatuses, setTodayStatuses] = useState<TodayStatus[]>([]);
  const [monthlySummaries, setMonthlySummaries] = useState<MonthlySummary[]>([]);
  const [summaryMonth, setSummaryMonth] = useState(bangkokMonthKey());
  const [calendarMonth, setCalendarMonth] = useState(bangkokMonthKey());
  const [calendarEmployee, setCalendarEmployee] = useState(user?.name || "");
  const [calendarData, setCalendarData] = useState<any[]>([]);
  const [calDetailDay, setCalDetailDay] = useState<any>(null);
  const [anomalyModal, setAnomalyModal] = useState<{ type: string; label: string; employee: string } | null>(null);
  const [anomalyRecords, setAnomalyRecords] = useState<any[]>([]);
  const [loadingAnomaly, setLoadingAnomaly] = useState(false);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ date: "", time: "", reason: "" });
  const [requestErr, setRequestErr] = useState("");

  // Photo upload state
  const [photoModal, setPhotoModal] = useState<{ action: "check_in" | "check_out" } | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Resolve issue with screenshot modal
  const [resolveModal, setResolveModal] = useState<IssueTicket | null>(null);
  const [resolveScreenshotFile, setResolveScreenshotFile] = useState<File | null>(null);
  const [resolveScreenshotPreview, setResolveScreenshotPreview] = useState<string | null>(null);
  const [resolveUploading, setResolveUploading] = useState(false);
  const [resolveErr, setResolveErr] = useState("");
  const resolveScreenshotInputRef = useRef<HTMLInputElement>(null);

  // Issue form
  const [issueForm, setIssueForm] = useState({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: "" });
  const [issueImages, setIssueImages] = useState<string[]>([]);
  const [issueUploading, setIssueUploading] = useState(false);
  const [issueErr, setIssueErr] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);
  const [issueDateFilter, setIssueDateFilter] = useState<"all"|"today"|"7"|"30"|"custom">("all");
  const [issueCustomFrom, setIssueCustomFrom] = useState("");
  const [issueCustomTo, setIssueCustomTo] = useState("");
  const [issueAssigneeFilter, setIssueAssigneeFilter] = useState("");
  const [issueCreatorFilter, setIssueCreatorFilter] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  // Leave form
  const [leaveForm, setLeaveForm] = useState({ leave_type: "事假", start_date: "", end_date: "", reason: "" });
  const [leaveErr, setLeaveErr] = useState("");
  const [leaveImages, setLeaveImages] = useState<string[]>([]);
  const [leaveUploading, setLeaveUploading] = useState(false);
  const [supplementLeaveId, setSupplementLeaveId] = useState<number | null>(null);
  const [supplementUploading, setSupplementUploading] = useState(false);
  const supplementInputRef = useRef<HTMLInputElement>(null);
  const [leaveDateFilter, setLeaveDateFilter] = useState<"all"|"today"|"7"|"30"|"custom">("all");
  const [leaveCustomFrom, setLeaveCustomFrom] = useState("");
  const [leaveCustomTo, setLeaveCustomTo] = useState("");
  const [leaveEmployeeFilter, setLeaveEmployeeFilter] = useState("");
  const [leaveStatusFilter, setLeaveStatusFilter] = useState("");
  const [showLeaveHistory, setShowLeaveHistory] = useState(false);

  // History toggles & date filters
  const [showAtdHistory, setShowAtdHistory] = useState(false);
  const [atdHistoryFilter, setAtdHistoryFilter] = useState<"7d" | "30d" | "all">("7d");
  const [showNotifHistory, setShowNotifHistory] = useState(false);
  const [notifHistoryFilter, setNotifHistoryFilter] = useState<"7d" | "30d" | "all">("7d");

  // Workload detail modal
  const [wlDetailModal, setWlDetailModal] = useState<{ employee: string; type: string; label: string } | null>(null);
  const [wlDetailData, setWlDetailData] = useState<any[]>([]);
  const [wlDetailLoading, setWlDetailLoading] = useState(false);
  const [wlDetailError, setWlDetailError] = useState<string | null>(null);
  const safeJsonParseArray = (raw: any): string[] => {
    if (!raw) return [];
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };

  const handleWlDetail = async (employee: string, type: string, label: string) => {
    setWlDetailModal({ employee, type, label });
    setWlDetailLoading(true);
    setWlDetailData([]);
    setWlDetailError(null);
    try {
      const res = await fetchWithAuth(`/api/internal/workload-details?employee=${encodeURIComponent(employee)}&type=${type}`, { cache: "no-store" });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[工作量明细] API 返回错误", { status: res.status, employee, type, body: errText });
        setWlDetailData([]);
        if (res.status === 401) setWlDetailError("登录已过期，请重新登录");
        else setWlDetailError(`请求失败 (${res.status})`);
      } else {
        const json = await res.json();
        console.log("[工作量明细] API 返回数据", { employee, type, count: json.data?.length });
        setWlDetailData(json.data || []);
      }
    } catch (e: any) {
      console.error("[工作量明细] 请求异常", e, { employee, type });
      if (e?.message === "NO_TOKEN") {
        setWlDetailError("登录已过期，请刷新页面重新登录");
      } else {
        setWlDetailError("网络错误，请检查连接后重试");
      }
    }
    setWlDetailLoading(false);
  };

  const loadAll = async () => {
    if (!user?.name) return; // 等待认证加载完成
    // 每个接口独立请求，单个失败不影响其他数据更新
    const leaveUrl = isAdmin ? "/api/leave" : `/api/leave?employee=${encodeURIComponent(user?.name || "")}`;
    
    fetchWithAuth("/api/internal/workload", { cache: "no-store" })
      .then(r => r.json()).then(setWl).catch(e => console.error("[内部管理] 工作量加载失败", e));
    fetchWithAuth("/api/issues", { cache: "no-store" })
      .then(r => r.json()).then(setIssues).catch(e => console.error("[内部管理] 工单加载失败", e));
    fetchWithAuth(leaveUrl, { cache: "no-store" })
      .then(r => r.json()).then(setLeaves).catch(e => console.error("[内部管理] 请假加载失败", e));
    fetchWithAuth(`/api/notifications?recipient=${encodeURIComponent(user?.name || "")}&limit=30`, { cache: "no-store" })
      .then(r => r.json()).then(setNotifications).catch(e => console.error("[内部管理] 通知加载失败", e));
  };

  const isWithinDays = (dateStr: string, days: number) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    return diff <= days * 24 * 60 * 60 * 1000;
  };

  const loadAttendance = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const [attRes, todayRes, sumRes, reqRes] = await Promise.all([
        fetchWithAuth(`/api/attendance?employee=${user?.name || ""}`, { cache: "no-store" }),
        fetchWithAuth("/api/attendance/today", { cache: "no-store" }),
        fetchWithAuth(`/api/attendance/summary?month=${summaryMonth}`, { cache: "no-store" }),
        fetchWithAuth("/api/attendance/request", { cache: "no-store" }),
      ]);
      const attData = await attRes.json();
      setTodayRecord((Array.isArray(attData) ? attData : []).find((r: any) => r.date === today) || null);
      setTodayStatuses(await todayRes.json());
      setMonthlySummaries(await sumRes.json());
      setAttendanceRequests(await reqRes.json());
    } catch (e) { console.error("[内部管理] 加载考勤数据失败", e); }
  };

  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // 加载员工列表（供工单指派人下拉框使用）
  useEffect(() => {
    const loadStaff = async () => {
      try {
        const res = await fetchWithAuth("/api/employees", { cache: "no-store" });
        const data = await res.json();
        const names: string[] = (Array.isArray(data) ? data : []).map((e: any) => e.name).filter(Boolean);
        setStaffNames(names);
      } catch (e) { console.error("[内部管理] 加载员工列表失败", e); }
    };
    loadStaff();
  }, []);

  const loadCalendar = async () => {
    try {
      const [y, m] = calendarMonth.split("-");
      const lastDay = bangkokLastDayOfMonth(Number(y), Number(m));
      const from = `${calendarMonth}-01`;
      const to = `${calendarMonth}-${String(lastDay).padStart(2, "0")}`;
      const emp = calendarEmployee || user?.name || "";
      const res = await fetchWithAuth(`/api/attendance?employee=${encodeURIComponent(emp)}&from=${from}&to=${to}`, { cache: "no-store" });
      setCalendarData(await res.json());
    } catch (e) { console.error("[内部管理] 加载日历数据失败", e); }
  };
  const handleAnomalyClick = async (type: string, label: string, emp: string) => {
    setAnomalyModal({ type, label, employee: emp });
    setLoadingAnomaly(true);
    try {
      const res = await fetchWithAuth(`/api/attendance/details?employee=${encodeURIComponent(emp)}&month=${summaryMonth}&type=${type}`, { cache: "no-store" });
      setAnomalyRecords(await res.json());
    } catch (e) { console.error("[内部管理] 加载异常明细失败", e); }
    setLoadingAnomaly(false);
  };

  useEffect(() => { loadAll(); loadAttendance(); loadCalendar(); }, [summaryMonth, calendarMonth, calendarEmployee, user?.name]);

  // ── Photo upload helpers ──
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleTakePhoto = () => {
    photoInputRef.current?.click();
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const handleClockAction = async (action: "check_in" | "check_out") => {
    setPhotoModal({ action });
  };

  const handleSubmitClock = async () => {
    if (!photoFile || !photoModal) return;
    setUploading(true);
    try {
      // 1. Upload photo
      const fd = new FormData();
      fd.append("file", photoFile);
      const upRes = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      if (!upRes.ok) { alert("照片上传失败"); setUploading(false); return; }
      const { url } = await upRes.json();

      // 2. Clock in/out with photo
      const action = photoModal.action;
      setClockAnim(action === "check_in" ? "in" : "out");
      const body = action === "check_in"
        ? JSON.stringify({ employee_name: user?.name, action, check_in_photo: url })
        : JSON.stringify({ employee_name: user?.name, action, check_out_photo: url });
      const res = await fetchWithAuth("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) { const e = await res.json(); alert(e.error); setTimeout(() => setClockAnim(null), 800); setUploading(false); return; }

      setTimeout(() => setClockAnim(null), 800);
      setPhotoModal(null);
      clearPhoto();
      loadAttendance();
    } catch { alert("操作失败"); }
    setUploading(false);
  };

  const handleExportAttendance = async () => {
    try {
      const res = await fetchWithAuth("/api/attendance", { cache: "no-store" });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      const cols: ExportColumn<any>[] = [
        { header: "员工", key: "employee_name" },
        { header: "日期", key: "date" },
        { header: "签到时间", render: (r) => toBangkokTime(r.check_in) },
        { header: "签退时间", render: (r) => toBangkokTime(r.check_out) },
        { header: "工时(小时)", render: (r) => r.work_hours != null ? String(r.work_hours) : "—" },
        { header: "签到照片", render: (r) => r.check_in_photo || "—" },
        { header: "签退照片", render: (r) => r.check_out_photo || "—" },
      ];
      exportToExcel(arr, cols, `考勤记录_${bangkokDateStr()}`);
    } catch (e) { console.error("[内部管理] 导出考勤失败", e); }
  };

  const handleIssueImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIssueUploading(true);
    const uploaded: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
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
    e.target.value = "";
  };

  const removeIssueImage = (idx: number) => {
    setIssueImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCreateIssue = async () => {
    if (!issueForm.description.trim()) { setIssueErr("请填写问题描述"); return; }
    if (!issueForm.assignee) { setIssueErr("请指定解决人"); return; }
    setIssueSaving(true);
    try {
      await fetchWithAuth("/api/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...issueForm, created_by: user?.name, images: issueImages.map((url: string) => url.replace("/api/files/", "")) }),
      });
      setShowIssueForm(false);
      setIssueForm({ ref_id: "", ref_type: "influencer", description: "", priority: "medium", assignee: "" });
      setIssueImages([]);
      setIssueErr("");
      loadAll();
    } catch (e) { console.error("[内部管理] 创建工单失败", e); } finally { setIssueSaving(false); }
  };

  // 打开解决截图上传弹窗
  const handleResolveIssue = (t: IssueTicket) => {
    setResolveModal(t);
    setResolveScreenshotFile(null);
    setResolveScreenshotPreview(null);
    setResolveErr("");
  };

  const handleResolveScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setResolveScreenshotFile(file);
    setResolveScreenshotPreview(URL.createObjectURL(file));
    setResolveErr("");
    e.target.value = "";
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
    } catch (e) { console.error("[内部管理] 撤回工单失败", e); }
  };

  const handleDeleteIssue = async (id: number) => {
    if (!confirm("确认删除此工单？删除后无法恢复。")) return;
    try {
      await fetchWithAuth("/api/issues?id=" + id, { method: "DELETE" });
      loadAll();
    } catch (e) { console.error(e); }
  };

  const handleLeaveImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setLeaveUploading(true);
    const uploaded: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData(); fd.append("file", files[i]);
      try {
        const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
        if (!res.ok) throw new Error("上传失败");
        const json = await res.json(); uploaded.push(json.url);
      } catch (err) { alert("上传失败: " + (err instanceof Error ? err.message : "网络错误")); break; }
    }
    setLeaveImages(prev => [...prev, ...uploaded]);
    setLeaveUploading(false); e.target.value = "";
  };

  const removeLeaveImage = (idx: number) => { setLeaveImages(prev => prev.filter((_, i) => i !== idx)); };

  // 请假补传附件
  const handleSupplementLeaveImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || supplementLeaveId === null) return;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("file", files[i]);
    }
    setSupplementUploading(true);
    try {
      const uploadRes = await fetchWithAuth("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();
      const newFilename = (uploadData.url || uploadData.filename || "").replace(/^\/api\/files\//, "");
      // 调用 PATCH 追加图片
      const patchRes = await fetchWithAuth("/api/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: supplementLeaveId, append_images: [newFilename] }),
      });
      if (!patchRes.ok) throw new Error("补传失败");
      // 刷新列表
      loadAll();
    } catch (err) {
      console.error("[内部管理] 补传附件失败", err);
    }
    setSupplementUploading(false);
    setSupplementLeaveId(null);
  };

  const handleCreateLeave = async () => {
    if (!leaveForm.start_date || !leaveForm.end_date) { setLeaveErr("请选择日期"); return; }
    setLeaveErr("");
    try {
      const res = await fetchWithAuth("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...leaveForm, employee_name: user?.name, images: leaveImages.map((url) => url.replace("/api/files/", "")) }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setLeaveErr(errData.error || "提交失败，请重试");
        return;
      }
      const newRecord = await res.json();
      // 直接追加到列表头部，不等全量刷新
      setLeaves(prev => [newRecord, ...prev]);
      setShowLeaveForm(false);
      setLeaveForm({ leave_type: "事假", start_date: "", end_date: "", reason: "" });
      setLeaveImages([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络错误";
      if (msg === "NO_TOKEN") setLeaveErr("登录已过期，请刷新页面重新登录");
      else { console.error("[内部管理] 创建请假失败", e); setLeaveErr("提交失败，请检查网络后重试"); }
    }
  };

  const handleApproveLeave = async (id: number, status: string) => {
    await fetchWithAuth("/api/leave", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, approved_by: user?.name }),
    });
    loadAll();
  };

  // 补卡
  const handleCreateRequest = async () => {
    if (!requestForm.date || !requestForm.time) { setRequestErr("请填写日期和时间"); return; }
    try {
      let photoUrl = "";
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        const upRes = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
        if (upRes.ok) photoUrl = (await upRes.json()).url;
      }
      await fetchWithAuth("/api/attendance/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_name: user?.name, ...requestForm, photo: photoUrl }),
      });
      setShowRequestForm(false);
      setRequestForm({ date: "", time: "", reason: "" });
      setRequestErr("");
      clearPhoto();
      loadAttendance();
    } catch (e) { console.error("[内部管理] 提交补卡申请失败", e); }
  };

  const handleApproveRequest = async (id: number, status: string) => {
    await fetchWithAuth("/api/attendance/request", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    loadAttendance();
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

      {/* ── 今日考勤打卡 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><Calendar className="size-4" />今日考勤打卡</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportAttendance}><Download className="size-3" />导出考勤</Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowRequestForm(!showRequestForm)}><History className="size-3" />补卡申请</Button>
          </div>
        </div>
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="text-5xl font-mono font-bold tracking-wider text-[var(--foreground)]">{currentTime}</div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{((): string => { const bkk = new Date(Date.now() + 7*60*60*1000); return bkk.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }); })()}</p>
          </div>
          <div className="flex items-center justify-center gap-6">
            {!todayRecord?.check_in ? (
              <button
                onClick={() => handleClockAction("check_in")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border-2 border-green-400 bg-green-50 px-10 py-6 transition-all duration-300 hover:bg-green-100 hover:scale-105 active:scale-95 dark:bg-green-950/20",
                  clockAnim === "in" && "scale-110 bg-green-200 dark:bg-green-900"
                )}
              >
                <LogIn className="size-10 text-green-600" />
                <span className="text-lg font-semibold text-green-700">签到打卡</span>
                <span className="text-xs text-green-500 flex items-center gap-1"><Camera className="size-3" />需拍照上传</span>
              </button>
            ) : !todayRecord?.check_out ? (
              <button
                onClick={() => handleClockAction("check_out")}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-2xl border-2 border-orange-400 bg-orange-50 px-10 py-6 transition-all duration-300 hover:bg-orange-100 hover:scale-105 active:scale-95 dark:bg-orange-950/20",
                  clockAnim === "out" && "scale-110 bg-orange-200 dark:bg-orange-900"
                )}
              >
                <LogOut className="size-10 text-orange-600" />
                <span className="text-lg font-semibold text-orange-700">签退下班</span>
                <span className="text-xs text-orange-500 flex items-center gap-1"><Camera className="size-3" />需拍照上传 · 签到于 {toBangkokTime(todayRecord.check_in)}</span>
              </button>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-gray-200 bg-gray-50 px-10 py-6 dark:bg-gray-900/30">
                <CheckCircle2 className="size-10 text-gray-400" />
                <span className="text-lg font-semibold text-gray-500">今日打卡完成</span>
                <span className="text-xs text-gray-400">
                  签到 {toBangkokTime(todayRecord.check_in)} / 签退 {toBangkokTime(todayRecord.check_out)} · 工时 {todayRecord.work_hours || "—"}h
                </span>
                {(todayRecord.check_in_photo || todayRecord.check_out_photo) && (
                  <div className="flex gap-2 mt-1">
                    {todayRecord.check_in_photo && (
                      <a href={fileUrl(todayRecord.check_in_photo)} target="_blank" className="text-xs text-blue-500 underline">签到照片</a>
                    )}
                    {todayRecord.check_out_photo && (
                      <a href={fileUrl(todayRecord.check_out_photo)} target="_blank" className="text-xs text-blue-500 underline">签退照片</a>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {todayRecord?.type === "补签" && (
            <p className="mt-4 text-center text-xs text-amber-600 font-medium">补签记录</p>
          )}
          {todayRecord?.type === "请假" && (
            <p className="mt-4 text-center text-xs text-blue-600 font-medium">请假中</p>
          )}
        </div>
      </div>

      {/* ── 拍照上传弹窗 ── */}
      {photoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!uploading) { setPhotoModal(null); clearPhoto(); } }}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">{photoModal.action === "check_in" ? "签到拍照" : "签退拍照"}</h3>
              <button onClick={() => { setPhotoModal(null); clearPhoto(); }} disabled={uploading}><X className="size-4" /></button>
            </div>
            <p className="text-xs text-[var(--muted-foreground)] mb-4">
              {photoModal.action === "check_in" ? "请拍摄一张现场照片作为签到证据" : "请拍摄一张现场照片作为签退证据"}
            </p>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelect} />
            {photoPreview ? (
              <div className="mb-4">
                <img src={photoPreview} alt="预览" className="w-full h-48 object-cover rounded-lg border" />
                <button onClick={clearPhoto} className="mt-2 text-xs text-red-500" disabled={uploading}>重新选择</button>
              </div>
            ) : (
              <button
                onClick={handleTakePhoto}
                className="w-full rounded-lg border-2 border-dashed border-[var(--border)] py-10 flex flex-col items-center gap-2 hover:bg-[var(--muted)]/20 transition-colors"
              >
                <Camera className="size-10 text-[var(--muted-foreground)]" />
                <span className="text-sm text-[var(--muted-foreground)]">点击拍照或选择照片</span>
                <span className="text-xs text-[var(--muted-foreground)]/60">支持 JPG / PNG</span>
              </button>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPhotoModal(null); clearPhoto(); }} disabled={uploading}>取消</Button>
              <Button size="sm" onClick={handleSubmitClock} disabled={!photoFile || uploading}>
                {uploading ? "上传中..." : "确认打卡"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── 补卡申请表单 ── */}
      {showRequestForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h3 className="text-sm font-medium mb-3">补卡申请</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium">日期</label>
              <input type="date" value={requestForm.date} onChange={e => setRequestForm(p => ({ ...p, date: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">时间</label>
              <input type="time" step="1" value={requestForm.time} onChange={e => setRequestForm(p => ({ ...p, time: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">原因</label>
              <input value={requestForm.reason} onChange={e => setRequestForm(p => ({ ...p, reason: e.target.value }))} placeholder="漏打卡/迟到原因"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
            </div>
          </div>
          {/* 补卡照片 */}
          <div className="mt-3">
            <label className="text-xs font-medium">现场照片</label>
            <div className="mt-1 flex items-center gap-3">
              <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoSelect} />
              {photoPreview ? (
                <div className="flex items-center gap-2">
                  <img src={photoPreview} alt="" className="size-12 object-cover rounded border" />
                  <button onClick={clearPhoto} className="text-xs text-red-500">移除</button>
                </div>
              ) : (
                <button onClick={handleTakePhoto} className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] border rounded px-3 py-1.5">
                  <Camera className="size-3" />上传照片
                </button>
              )}
            </div>
          </div>
          {requestErr && <p className="mt-2 text-xs text-[var(--destructive)]">{requestErr}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleCreateRequest}>提交申请</Button>
            <Button variant="ghost" size="sm" onClick={() => { setShowRequestForm(false); clearPhoto(); }}>取消</Button>
          </div>
        </div>
      )}

      {/* ── 今日在岗 ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><Users className="size-4" />今日在岗</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {todayStatuses.map(s => (
                <div key={s.name} className={cn(
                  "rounded-lg border p-3 text-center",
                  s.isOnLeave ? "border-blue-200 bg-blue-50 dark:bg-blue-950/20" :
                  s.hasCheckedIn && s.hasCheckedOut ? "border-green-200 bg-green-50 dark:bg-green-950/20" :
                  s.hasCheckedIn ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20" :
                  "border-red-200 bg-red-50 dark:bg-red-950/20"
                )}>
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.isOnLeave ? (
                    <div className="mt-1 text-xs text-blue-600">请假中 ({s.leaveType})</div>
                  ) : s.hasCheckedIn && s.hasCheckedOut ? (
                    <div className="mt-1 text-xs text-green-600">
                      <CheckCircle2 className="size-3 inline mr-0.5" />
                      {toBangkokTime(s.checkInTime)} - {toBangkokTime(s.checkOutTime)}
                    </div>
                  ) : s.hasCheckedIn ? (
                    <div className="mt-1 text-xs text-amber-600">
                      <Clock className="size-3 inline mr-0.5" />
                      已签到 {toBangkokTime(s.checkInTime)}
                    </div>
                  ) : (
                    <div className="mt-1 text-xs text-red-600">
                      <AlertCircle className="size-3 inline mr-0.5" />
                      未打卡
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 月度考勤汇总 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><Timer className="size-4" />月度考勤汇总</h2>
          <input type="month" value={summaryMonth} onChange={e => setSummaryMonth(e.target.value)}
            className="h-8 rounded border border-[var(--border)] px-2 text-xs" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                <th className="py-2.5 px-4 text-left text-xs font-medium">员工</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">总工时(h)</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">正常打卡</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">补签</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">请假</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">迟到</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">缺勤</th>
                <th className="py-2.5 px-3 text-center text-xs font-medium">工作日</th>
              </tr>
            </thead>
            <tbody>
              {monthlySummaries.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无数据</td></tr>
              ) : (
                monthlySummaries.map(m => (
                  <tr key={m.name} className="border-b border-[var(--border)] hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-4 font-medium">{m.name}</td>
                    <td className="py-2.5 px-3 text-center tabular-nums">{m.totalHours}</td>
                    <td className="py-2.5 px-3 text-center tabular-nums text-green-600">{m.normalDays}</td>
                    <td className={cn("py-2.5 px-3 text-center tabular-nums text-amber-600", m.supplementDays > 0 && "cursor-pointer hover:underline")} onClick={() => m.supplementDays > 0 && handleAnomalyClick("supplement", "补签明细", m.name)}>{m.supplementDays}</td>
                    <td className={cn("py-2.5 px-3 text-center tabular-nums text-blue-600", m.leaveCount > 0 && "cursor-pointer hover:underline")} onClick={() => m.leaveCount > 0 && handleAnomalyClick("leave", "请假明细", m.name)}>{m.leaveCount}</td>
                    <td className={cn("py-2.5 px-3 text-center tabular-nums text-orange-600", m.lateCount > 0 && "cursor-pointer hover:underline")} onClick={() => m.lateCount > 0 && handleAnomalyClick("late", "迟到明细", m.name)}>{m.lateCount}</td>
                    <td className={cn("py-2.5 px-3 text-center tabular-nums", m.absentCount > 0 ? "text-red-600 font-semibold cursor-pointer hover:underline" : "")} onClick={() => m.absentCount > 0 && handleAnomalyClick("absent", "缺勤明细", m.name)}>{m.absentCount}</td>
                    <td className="py-2.5 px-3 text-center tabular-nums text-[var(--muted-foreground)]">{m.workDays}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>


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

      {/* 补传附件的隐藏文件输入 — 放在页面顶层，始终在 DOM 中 */}
      <input ref={supplementInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleSupplementLeaveImage} />

      {/* ── 考勤日历 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2"><Calendar className="size-4" />考勤日历</h2>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select value={calendarEmployee} onChange={e => setCalendarEmployee(e.target.value)}
                className="h-7 rounded border border-[var(--border)] px-2 text-xs">
                {staffNames.filter(n => n !== "Pop" && n !== "张三").map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            <button
              className="h-7 w-7 flex items-center justify-center rounded border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              onClick={() => {
                const parts = calendarMonth.split("-");
                const yr = parseInt(parts[0]);
                const mo = parseInt(parts[1]);
                const d = new Date(yr, mo - 2, 1);
                setCalendarMonth(d.toISOString().slice(0, 7));
              }}
            ><ChevronLeft className="size-3.5" /></button>
            <span className="text-sm font-medium w-[100px] text-center">{calendarMonth}</span>
            <button
              className="h-7 w-7 flex items-center justify-center rounded border border-[var(--border)] hover:bg-[var(--muted)] transition-colors"
              onClick={() => {
                const parts = calendarMonth.split("-");
                const yr = parseInt(parts[0]);
                const mo = parseInt(parts[1]);
                const d = new Date(yr, mo, 1);
                setCalendarMonth(d.toISOString().slice(0, 7));
              }}
            ><ChevronRight className="size-3.5" /></button>
          </div>
        </div>
        <div className="p-2">
          {/* 周头 */}
          <div className="grid grid-cols-7 gap-0.5 mb-0.5">
            {["一","二","三","四","五","六","日"].map(d => (
              <div key={d} className="text-center text-[11px] font-medium text-[var(--muted-foreground)] py-0.5">{d}</div>
            ))}
          </div>
          {/* 日历格子 */}
          <div className="grid grid-cols-7 gap-0.5">
            {(() => {
              const parts = calendarMonth.split("-");
              const yr = parseInt(parts[0]);
              const mo = parseInt(parts[1]);
              const firstDay = bangkokDayOfWeek(`${yr}-${String(mo).padStart(2,"0")}-01`);
              const offset = firstDay === 0 ? 6 : firstDay - 1;
              const lastDate = bangkokLastDayOfMonth(yr, mo);
              const cells: React.ReactNode[] = [];
              for (let i = 0; i < offset; i++) cells.push(<div key={"e"+i} className="rounded" />);
              for (let d2 = 1; d2 <= lastDate; d2++) {
                const ds = `${calendarMonth}-${String(d2).padStart(2,"0")}`;
                const rec = calendarData.find((r:any) => r.date === ds);
                const isSunday = bangkokDayOfWeek(`${yr}-${String(mo).padStart(2,"0")}-${String(d2).padStart(2,"0")}`) === 0;
                let bg = "bg-gray-50 dark:bg-gray-900/20";
                let label = "";
                if (rec) {
                  if (rec.type === "请假") { bg = "bg-blue-100 dark:bg-blue-950/30"; label = "假"; }
                  else if (rec.check_in && rec.check_out) {
                    const late = rec.check_in > `${ds} 09:00:00`;
                    bg = late ? "bg-amber-100 dark:bg-amber-950/30" : "bg-green-100 dark:bg-green-950/30";
                    label = late ? "迟" : "";
                  } else if (rec.check_in) {
                    bg = "bg-amber-100 dark:bg-amber-950/30"; label = "签";
                  } else {
                    bg = "bg-red-50 dark:bg-red-950/20"; label = "缺";
                  }
                } else if (isSunday) {
                  bg = "bg-gray-50/40 dark:bg-gray-900/10";
                } else {
                  const todayStr = bangkokDateStr();
                  if (ds < todayStr) { bg = "bg-red-50 dark:bg-red-950/20"; label = "缺"; }
                }
                cells.push(
                  <div key={d2}
                    onClick={() => setCalDetailDay(rec ? { ...rec, date: ds, isSunday } : { date: ds, isSunday, check_in: null, check_out: null, type: null, check_in_photo: null, check_out_photo: null, ip_address: null })}
                    className={cn("h-8 rounded flex flex-col items-center justify-center cursor-pointer hover:ring-1 hover:ring-[var(--ring)] text-[11px] leading-tight", bg)}>
                    <span className="font-medium">{d2}</span>
                    {label && <span className="text-[9px] leading-none">{label}</span>}
                  </div>
                );
              }
              return cells;
            })()}
          </div>
          {/* 图例 */}
          <div className="mt-2 flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-green-100 dark:bg-green-950/30" />正常</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-amber-100 dark:bg-amber-950/30" />迟到/补签</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-blue-100 dark:bg-blue-950/30" />请假</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded bg-red-50 dark:bg-red-950/20" />缺勤</span>
          </div>
        </div>
      </div>

      {/* ── 日期详情弹窗 ── */}
      {calDetailDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCalDetailDay(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">{calDetailDay.date}{calDetailDay.isSunday ? " (周日)" : ""}</h3>
              <button onClick={() => setCalDetailDay(null)}><X className="size-4" /></button>
            </div>
            {calDetailDay.check_in ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">签到</span><span>{toBangkokTime(calDetailDay.check_in) || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">签退</span><span>{toBangkokTime(calDetailDay.check_out) || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">工时</span><span>{calDetailDay.work_hours != null ? calDetailDay.work_hours+"h" : "—"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">类型</span><span>{calDetailDay.type || "正常"}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted-foreground)]">IP</span><span className="text-xs font-mono">{calDetailDay.ip_address || calDetailDay.check_in_ip || "—"}</span></div>
                {(calDetailDay.check_in_photo || calDetailDay.check_out_photo) && (
                  <div className="flex gap-3 pt-2">
                    {calDetailDay.check_in_photo && (
                      <a href={fileUrl(calDetailDay.check_in_photo)} target="_blank" className="flex-1">
                        <img src={fileUrl(calDetailDay.check_in_photo)} alt="签到照" className="w-full h-32 object-cover rounded-lg border" />
                        <span className="block text-center text-xs text-blue-500 mt-1">签到照片</span>
                      </a>
                    )}
                    {calDetailDay.check_out_photo && (
                      <a href={fileUrl(calDetailDay.check_out_photo)} target="_blank" className="flex-1">
                        <img src={fileUrl(calDetailDay.check_out_photo)} alt="签退照" className="w-full h-32 object-cover rounded-lg border" />
                        <span className="block text-center text-xs text-blue-500 mt-1">签退照片</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            ) : calDetailDay.isSunday ? (
              <p className="text-sm text-[var(--muted-foreground)]">周日休息日</p>
            ) : (
              <p className="text-sm text-red-500">缺勤，未打卡</p>
            )}
          </div>
        </div>
      )}


      {/* ── 异常明细弹窗 ── */}
      {/* 解决工单截图上传弹窗 */}
    {resolveModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setResolveModal(null)}>
        <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-xl" onClick={e => e.stopPropagation()}>
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
              <p className="text-xs text-[var(--muted-foreground)]">点击上传截图</p>
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

    {anomalyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAnomalyModal(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <h3 className="text-sm font-semibold">{anomalyModal.employee} · {anomalyModal.label}</h3>
              <button onClick={() => setAnomalyModal(null)}><X className="size-4" /></button>
            </div>
            <div className="overflow-y-auto p-4 flex-1">
              {loadingAnomaly ? (
                <p className="text-center text-sm text-[var(--muted-foreground)] py-8">加载中...</p>
              ) : anomalyRecords.length === 0 ? (
                <p className="text-center text-sm text-[var(--muted-foreground)] py-8">暂无数据</p>
              ) : anomalyModal.type === "supplement" ? (
                /* 补签明细 */
                <div className="space-y-3">
                  {anomalyRecords.map((r: any, i: number) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] p-3 bg-amber-50/30 dark:bg-amber-950/10">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{r.date}</span>
                        <span className="text-xs text-amber-600 font-medium">补签</span>
                      </div>
                      <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                        <p>打卡时间: {toBangkokTime(r.check_in) || "—"}</p>
                        {r.reason && <p className="mt-0.5">原因: {r.reason}</p>}
                      </div>
                      {(r.check_in_photo || r.request_photo) && (
                        <img src={r.check_in_photo || r.request_photo} alt="补签照片" className="mt-2 w-32 h-20 object-cover rounded border" />
                      )}
                    </div>
                  ))}
                </div>
              ) : anomalyModal.type === "leave" ? (
                /* 请假明细 */
                <div className="space-y-3">
                  {anomalyRecords.map((r: any, i: number) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] p-3 bg-blue-50/30 dark:bg-blue-950/10">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{r.start_date}{r.start_date !== r.end_date ? ` ~ ${r.end_date}` : ""}</span>
                        <span className={cn("text-xs font-medium rounded px-1.5 py-0.5", r.status === "已通过" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>{r.status}</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                        <p>类型: {r.leave_type} | 审批人: {r.approved_by || "—"} | 审批时间: {r.approved_at?.slice(0,16) || "—"}</p>
                        {r.reason && <p className="mt-0.5">原因: {r.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : anomalyModal.type === "late" ? (
                /* 迟到明细 */
                <div className="space-y-3">
                  {anomalyRecords.map((r: any, i: number) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] p-3 bg-orange-50/30 dark:bg-orange-950/10">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{r.date}</span>
                        <span className="text-xs text-orange-600 font-medium">迟到</span>
                      </div>
                      <div className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                        <p>签到: {toBangkokTime(r.check_in) || "—"} | 签退: {toBangkokTime(r.check_out) || "—"}</p>
                        <p className="mt-0.5">IP: {r.check_in_ip || r.ip_address || "—"}</p>
                      </div>
                      {r.check_in_photo && (
                        <img src={r.check_in_photo} alt="签到照片" className="mt-2 w-32 h-20 object-cover rounded border" />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                /* 缺勤明细 */
                <div className="space-y-3">
                  {anomalyRecords.map((r: any, i: number) => (
                    <div key={i} className="rounded-lg border border-[var(--border)] p-3 bg-red-50/30 dark:bg-red-950/10">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{r.date}</span>
                        <span className="text-xs text-red-600 font-medium">缺勤</span>
                      </div>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">当天无任何打卡记录</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* ── 补卡审批 (管理员) ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><History className="size-4" />补卡审批</h2>
          </div>
          {attendanceRequests.filter(r => r.status === "待审批").length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无待审批的补卡申请</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2.5 px-4 text-left text-xs font-medium">申请人</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">日期</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">时间</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">照片</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium w-10"></th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceRequests.filter(r => r.status === "待审批").map(r => (
                    <tr key={r.id} className="border-b border-[var(--border)]">
                      <td className="py-2.5 px-4 font-medium">{r.employee_name}</td>
                      <td className="py-2.5 px-4">{r.date}</td>
                      <td className="py-2.5 px-4">{r.time}</td>
                      <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{r.reason || "—"}</td>
                      <td className="py-2.5 px-4">
                        {r.photo ? <a href={r.photo} target="_blank" className="text-blue-500 underline text-xs">查看</a> : "—"}
                      </td>
                      <td className="py-2.5 px-4 flex gap-1.5">
                        <Button size="sm" className="h-6 text-xs bg-green-500 hover:bg-green-600" onClick={() => handleApproveRequest(r.id, "已通过")}>通过</Button>
                        <Button size="sm" variant="outline" className="h-6 text-xs text-red-500" onClick={() => handleApproveRequest(r.id, "已驳回")}>驳回</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        {attendanceRequests.filter(r => r.status !== "待审批").length > 0 && (
          <div className="border-t border-[var(--border)]">
            {!showAtdHistory ? (
              <button
                className="w-full px-5 py-3 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-left"
                onClick={() => setShowAtdHistory(true)}
              >
                历史记录 ({attendanceRequests.filter(r => r.status !== "待审批").length})
              </button>
            ) : (
              <div className="px-5 py-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    {(["7d", "30d", "all"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setAtdHistoryFilter(f)}
                        className={cn(
                          "px-2.5 py-1 text-xs rounded transition-colors",
                          atdHistoryFilter === f ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        )}
                      >
                        {f === "7d" ? "最近七天" : f === "30d" ? "最近三十天" : "全部"}
                      </button>
                    ))}
                  </div>
                  <button className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]" onClick={() => setShowAtdHistory(false)}>收起</button>
                </div>
                {(atdHistoryFilter === "7d"
                  ? attendanceRequests.filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 7))
                  : atdHistoryFilter === "30d"
                  ? attendanceRequests.filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 30))
                  : attendanceRequests.filter(r => r.status !== "待审批")
                ).length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] py-2">该时间段内无记录</p>
                ) : (
                  (atdHistoryFilter === "7d"
                    ? attendanceRequests.filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 7))
                    : atdHistoryFilter === "30d"
                    ? attendanceRequests.filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 30))
                    : attendanceRequests.filter(r => r.status !== "待审批")
                  ).map(r => (
                    <div key={r.id} className="flex items-center justify-between py-1 text-xs">
                      <span>{r.employee_name} · {r.date} {r.time}</span>
                      <span className={cn(r.status === "已通过" ? "text-green-600" : "text-red-500")}>{r.status}{r.approved_by ? ` · ${r.approved_by}` : ""}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        </div>
      )}

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
          <>
          <div className="divide-y divide-[var(--border)] max-h-64 overflow-y-auto">
            {notifications
              .filter(n => {
                if (showNotifHistory) return true;
                if (notifHistoryFilter === "7d") return isWithinDays(n.created_at, 7);
                if (notifHistoryFilter === "30d") return isWithinDays(n.created_at, 30);
                return true;
              })
              .map(n => (
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
          {(() => {
            const hidden = notifications.filter(n => {
              if (showNotifHistory) return false;
              if (notifHistoryFilter === "7d") return !isWithinDays(n.created_at, 7);
              if (notifHistoryFilter === "30d") return !isWithinDays(n.created_at, 30);
              return false;
            });
            return hidden.length > 0 ? (
              <div className="border-t border-[var(--border)]">
                {!showNotifHistory ? (
                  <button
                    className="w-full px-5 py-3 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-left"
                    onClick={() => setShowNotifHistory(true)}
                  >
                    查看历史 ({hidden.length})
                  </button>
                ) : (
                  <div className="px-5 py-3 flex items-center gap-1.5">
                    {(["7d", "30d", "all"] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setNotifHistoryFilter(f)}
                        className={cn(
                          "px-2.5 py-1 text-xs rounded transition-colors",
                          notifHistoryFilter === f ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                        )}
                      >
                        {f === "7d" ? "最近七天" : f === "30d" ? "最近三十天" : "全部"}
                      </button>
                    ))}
                    <button className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] ml-auto" onClick={() => setShowNotifHistory(false)}>收起</button>
                  </div>
                )}
              </div>
            ) : null;
          })()}
          </>
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
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">订单笔数</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">达人个数</th>
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
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {e.orderSteps > 0 ? (
                      <button onClick={() => handleWlDetail(e.name, "order_steps", `${e.name} 的订单`)} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {e.orderSteps}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {e.influencerSteps > 0 ? (
                      <button onClick={() => handleWlDetail(e.name, "influencer_steps", `${e.name} 的达人`)} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {e.influencerSteps}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className="py-2.5 px-4 text-center tabular-nums">
                    {e.contractInfs > 0 ? (
                      <button onClick={() => handleWlDetail(e.name, "contract_infs", `${e.name} 的签约跟进`)} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                        {e.contractInfs}<ExternalLink className="size-2.5 opacity-60" />
                      </button>
                    ) : "0"}
                  </td>
                  <td className={cn(
                    "py-2.5 px-4 text-center tabular-nums font-semibold",
                    e.level === "critical" && "text-red-600",
                    e.level === "warn" && "text-amber-600"
                  )}>{e.total}</td>
                </tr>
              ))}
              {(!wl || wl.employees.length === 0) && (
                <tr><td colSpan={5} className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 工作量明细弹窗 ── */}
      {wlDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setWlDetailModal(null)}>
          <div className="bg-[var(--background)] rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <h2 className="text-sm font-medium">{wlDetailModal.label}</h2>
              <button onClick={() => setWlDetailModal(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              {wlDetailLoading ? (
                <div className="py-12 flex items-center justify-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="size-4 animate-spin" />加载中...
                </div>
              ) : wlDetailData.length === 0 ? (
                wlDetailError ? (
                <div className="py-8 text-center">
                  <p className="text-sm text-[var(--destructive)]">加载失败: {wlDetailError}</p>
                  <button onClick={() => { if (wlDetailModal) handleWlDetail(wlDetailModal.employee, wlDetailModal.type, wlDetailModal.label); }} className="mt-2 text-xs text-blue-600 hover:underline">重试</button>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无明细数据</p>
              )
              ) : (
                <div className="space-y-2">
                  {wlDetailData.map((item: any, idx: number) => {
                    if (wlDetailModal.type === "order_steps") {
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 hover:bg-[var(--muted)]/30 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <a href={`/orders/${item.order_id}`} target="_blank" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate" onClick={e => e.stopPropagation()}>
                                {item.customer_name || item.order_id}
                              </a>
                              <span className="text-xs text-[var(--muted-foreground)] shrink-0">{item.order_id}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                              <span>{item.business_type_name || "—"}</span>
                              <span>进行中 {item.in_progress_count || 0} / 待处理 {item.pending_count || 0}</span>
                              <span className={item.order_status === "进行中" ? "text-blue-600" : "text-[var(--muted-foreground)]"}>
                                {item.order_status === "进行中" ? "进行中" : item.order_status === "已完成" ? "已完成" : item.order_status || "—"}
                              </span>
                            </div>
                          </div>
                          <a href={`/orders/${item.order_id}`} target="_blank" className="ml-3 text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      );
                    }
                    if (wlDetailModal.type === "influencer_steps") {
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 hover:bg-[var(--muted)]/30 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <a href={`/agency/influencers/${item.influencer_id}`} target="_blank" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate" onClick={e => e.stopPropagation()}>
                                {item.influencer_name}
                              </a>
                              {item.code && <span className="text-xs text-[var(--muted-foreground)] shrink-0">编号: {item.code}</span>}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                              <span>阶段: {item.phase === "discovery" ? "达人发现" : item.phase === "contract" ? "签约跟进" : "品牌孵化"}</span>
                              <span>进行中 {item.in_progress_count || 0} / 待处理 {item.pending_count || 0}</span>
                              <span className={item.influencer_status === "进行中" || item.influencer_status === "已入池" ? "text-blue-600" : "text-[var(--muted-foreground)]"}>
                                {item.influencer_status || "—"}
                              </span>
                            </div>
                          </div>
                          <a href={`/agency/influencers/${item.influencer_id}`} target="_blank" className="ml-3 text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      );
                    }
                    if (wlDetailModal.type === "contract_infs") {
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-4 py-3 hover:bg-[var(--muted)]/30 transition-colors">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <a href={`/agency/influencers/${item.id}`} target="_blank" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate" onClick={e => e.stopPropagation()}>{item.name}</a>
                              {item.code && <span className="text-xs text-[var(--muted-foreground)] shrink-0">编号: {item.code}</span>}
                            </div>
                            <div className="mt-1 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                              {item.base_salary && <span>底薪: {item.base_salary}</span>}
                              {item.commission && <span>佣金: {item.commission}</span>}
                              {item.live_sessions && <span>直播: {item.live_sessions}场</span>}
                              {item.payment_status && (
                                <span className={item.payment_status === "已付" ? "text-green-600" : "text-amber-600"}>付款: {item.payment_status}</span>
                              )}
                            </div>
                          </div>
                          <a href={`/agency/influencers/${item.id}`} target="_blank" className="ml-3 text-[var(--muted-foreground)] hover:text-[var(--foreground)] shrink-0" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 问题工单 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2"><FileEdit className="size-4" />问题工单 ({(() => {
            const now = Date.now(); const today = new Date().toDateString();
            return issues.filter(t => {
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
            {staffNames.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          <select value={issueCreatorFilter} onChange={e=>setIssueCreatorFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none">
            <option value="">全部创建人</option>
            {[...new Set(issues.map(t=>t.created_by).filter(Boolean))].sort().map(n=><option key={n} value={n}>{n}</option>)}
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
                <label className="text-xs font-medium">指定解决人 <span className="text-[var(--destructive)]">*</span></label>
                <select value={issueForm.assignee} onChange={e=>setIssueForm(p=>({...p,assignee:e.target.value}))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="">请选择员工</option>
                  {staffNames.map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium">问题描述</label>
                <textarea value={issueForm.description} onChange={e=>setIssueForm(p=>({...p,description:e.target.value}))} placeholder="描述遇到的问题..." rows={2} className="mt-1 w-full rounded border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
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
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">支持 jpg/png/webp，每张不超过 10MB</p>
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
          const filtered = issues.filter(t => {
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
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-4 text-left text-xs font-medium">编号</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">关联</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">问题</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">指定人</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">状态</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">解决截图</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">创建人</th>
                <th className="py-2.5 px-4 text-left text-xs font-medium w-10"></th>
                <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
              </tr></thead>
              <tbody>{list.map(t => (
                <tr key={t.id} className="border-b border-[var(--border)]">
                  <td className="py-2.5 px-4 font-mono text-xs">{t.ticket_number || `#${t.id}`}</td>
                  <td className="py-2.5 px-4 text-xs">{t.ref_id ? `${t.ref_type==="influencer"?"达人:":"订单:"}${t.ref_id}` : "—"}</td>
                  <td className="py-2.5 px-4 max-w-[200px] truncate">{t.description}</td>
                  <td className="py-2.5 px-4">{t.assignee || "—"}</td>
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
                  <td className="py-2.5 px-4">
                    {(()=>{const imgs=safeJsonParseArray(t.images);return imgs.length>0?(
                      <button onClick={()=>{setLightboxImages(imgs.map((f:string)=>`/api/files/${f}`));setLightboxIdx(0);}} className="inline-flex items-center gap-0.5 text-blue-600 hover:underline cursor-pointer">
                        <Image className="size-4" /><span className="text-xs">{imgs.length}</span>
                      </button>):<span className="text-[var(--muted-foreground)]/30">—</span>;})()}
                  </td>
                  <td className="py-2.5 px-4">
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

      {/* ── 请假审批 / 我的请假 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium flex items-center gap-2"><UserCheck className="size-4" />{isAdmin ? "请假审批" : "我的请假"} ({(()=>{
            const now=Date.now();const today=new Date().toDateString();
            return leaves.filter(l=>{
              const d=new Date(l.created_at);
              if(leaveDateFilter==="today"&&d.toDateString()!==today)return false;
              if(leaveDateFilter==="7"&&d<new Date(now-7*86400000))return false;
              if(leaveDateFilter==="30"&&d<new Date(now-30*86400000))return false;
              if(leaveDateFilter==="custom"&&leaveCustomFrom&&d<new Date(leaveCustomFrom))return false;
              if(leaveDateFilter==="custom"&&leaveCustomTo&&d>new Date(leaveCustomTo+"T23:59:59"))return false;
              if(leaveEmployeeFilter&&l.employee_name!==leaveEmployeeFilter)return false;
              if(leaveStatusFilter&&l.status!==leaveStatusFilter)return false;
              return true;
            }).length;
          })()})</h2>
          <Button size="sm" className="h-7 text-xs" variant="outline" onClick={()=>setShowLeaveForm(true)}><Plus className="size-3" />申请请假</Button>
        </div>
        {/* Filters */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
            {(["all","all","today","今天","7","7天","30","30天","custom","自定义"] as const).reduce<[string,string][]>((acc,_,i,a)=>{if(i%2===0)acc.push([a[i],a[i+1]]);return acc;},[]).map(([k,l])=>(
              <button key={k} onClick={()=>setLeaveDateFilter(k as any)}
                className={"rounded px-2.5 py-1 text-xs font-medium transition-colors "+(leaveDateFilter===k?"bg-[var(--background)] text-[var(--foreground)] shadow-sm":"text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}
              >{l}</button>
            ))}
          </div>
          {leaveDateFilter==="custom"&&(
            <div className="flex items-center gap-1 text-xs">
              <input type="date" value={leaveCustomFrom} onChange={e=>setLeaveCustomFrom(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none" />
              <span className="text-[var(--muted-foreground)]">至</span>
              <input type="date" value={leaveCustomTo} onChange={e=>setLeaveCustomTo(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none" />
            </div>
          )}
          <span className="text-[var(--border)] mx-1">|</span>
          <select value={leaveEmployeeFilter} onChange={e=>setLeaveEmployeeFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none">
            <option value="">全部申请人</option>
            {[...new Set(leaves.map(l=>l.employee_name).filter(Boolean))].sort().map(n=><option key={n} value={n}>{n}</option>)}
          </select>
          <select value={leaveStatusFilter} onChange={e=>setLeaveStatusFilter(e.target.value)} className="h-7 rounded border border-[var(--border)] px-2 text-xs outline-none">
            <option value="">全部状态</option>
            <option value="待审批">待审批</option><option value="已通过">已通过</option><option value="已驳回">已驳回</option>
          </select>
        </div>

        {showLeaveForm && (
          <div className="p-5 border-b border-[var(--border)]">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium">请假类型</label>
                <select value={leaveForm.leave_type} onChange={e=>setLeaveForm(p=>({...p,leave_type:e.target.value}))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                  <option value="事假">事假</option><option value="病假">病假</option><option value="年假">年假</option><option value="其他">其他</option>
                </select>
              </div>
              <div><label className="text-xs font-medium">开始日期</label>
                <input type="date" value={leaveForm.start_date} onChange={e=>setLeaveForm(p=>({...p,start_date:e.target.value}))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
              <div><label className="text-xs font-medium">结束日期</label>
                <input type="date" value={leaveForm.end_date} onChange={e=>setLeaveForm(p=>({...p,end_date:e.target.value}))}
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
              </div>
              <div className="sm:col-span-3">
                <label className="text-xs font-medium">原因</label>
                <input value={leaveForm.reason} onChange={e=>setLeaveForm(p=>({...p,reason:e.target.value}))} placeholder="请假原因..."
                  className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs font-medium">附件上传</label>
              <div className="mt-1 flex flex-wrap gap-2 items-center">
                {leaveImages.map((img,idx)=>(
                  <div key={idx} className="relative group w-16 h-16 rounded border border-[var(--border)] overflow-hidden bg-[var(--muted)] shrink-0">
                    <img src={fileUrl(img)} alt="" className="w-full h-full object-cover" />
                    <button onClick={()=>removeLeaveImage(idx)} className="absolute -top-1 -right-1 size-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="size-3" /></button>
                  </div>
                ))}
                <label className="w-16 h-16 rounded border-2 border-dashed border-[var(--border)] flex items-center justify-center cursor-pointer hover:border-[var(--ring)] transition-colors shrink-0">
                  {leaveUploading?<Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" />:<Plus className="size-5 text-[var(--muted-foreground)]" />}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleLeaveImageUpload} disabled={leaveUploading} />
                </label>
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">支持 jpg/png/webp，每张不超过 10MB</p>
            </div>
            {leaveErr && <p className="mt-2 text-xs text-[var(--destructive)]">{leaveErr}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleCreateLeave}>提交申请</Button>
              <Button variant="ghost" size="sm" onClick={()=>setShowLeaveForm(false)}>取消</Button>
            </div>
          </div>
        )}

        {(() => {
          const now=Date.now();const today=new Date().toDateString();
          const filtered=leaves.filter(l=>{
            const d=new Date(l.created_at);
            if(leaveDateFilter==="today"&&d.toDateString()!==today)return false;
            if(leaveDateFilter==="7"&&d<new Date(now-7*86400000))return false;
            if(leaveDateFilter==="30"&&d<new Date(now-30*86400000))return false;
            if(leaveDateFilter==="custom"&&leaveCustomFrom&&d<new Date(leaveCustomFrom))return false;
            if(leaveDateFilter==="custom"&&leaveCustomTo&&d>new Date(leaveCustomTo+"T23:59:59"))return false;
            if(leaveEmployeeFilter&&l.employee_name!==leaveEmployeeFilter)return false;
            if(leaveStatusFilter&&l.status!==leaveStatusFilter)return false;
            return true;
          });
          const pending=filtered.filter(l=>l.status==="待审批");
          const history=filtered.filter(l=>l.status!=="待审批");
          if(filtered.length===0)return(<div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无匹配的请假记录</div>);
          const renderLeaveTable=(list: any[])=>(
            <table className="w-full text-sm"><thead><tr className="border-b border-[var(--border)]">
              {isAdmin&&<th className="py-2.5 px-4 text-left text-xs font-medium">申请人</th>}
              <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium">日期</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium">状态</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium w-10"></th>
              <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
            </tr></thead><tbody>{list.map(l=>(
              <tr key={l.id} className="border-b border-[var(--border)]">
                {isAdmin&&<td className="py-2.5 px-4 font-medium">{l.employee_name}</td>}
                <td className="py-2.5 px-4">{l.leave_type}</td>
                <td className="py-2.5 px-4 text-[var(--muted-foreground)] text-xs">{l.start_date} ~ {l.end_date}</td>
                <td className="py-2.5 px-4 text-[var(--muted-foreground)] max-w-[150px] truncate">{l.reason||"—"}</td>
                <td className="py-2.5 px-4">
                  <span className={"inline-flex rounded-full px-2 py-0.5 text-xs font-medium "+(l.status==="已通过"?"bg-green-100 text-green-700":l.status==="已驳回"?"bg-red-100 text-red-700":"bg-blue-100 text-blue-700")}>{l.status}</span>
                </td>
                <td className="py-2.5 px-4">
                  {(()=>{const imgs=safeJsonParseArray(l.images);return imgs.length>0?(
                    <a href={fileUrl((imgs[0] as string).startsWith("/api/files/") ? imgs[0] : "/api/files/" + imgs[0])} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline cursor-pointer" onClick={(e) => { if (imgs.length > 1) { e.preventDefault(); const urls = imgs.map((f:string) => f.startsWith("/api/files/") ? f : "/api/files/" + f); setLightboxImages(urls); setLightboxIdx(0); } }}>
                      <Image className="size-4" /><span className="text-xs">{imgs.length}</span>
                    </a>):<span className="text-[var(--muted-foreground)]/30">—</span>;})()}
                </td>
                <td className="py-2.5 px-4">
                  <div className="flex gap-1.5 items-center">
                    {!isAdmin&&(
                      <button
                        onClick={()=>{setSupplementLeaveId(l.id);setTimeout(()=>supplementInputRef.current?.click(),50);}}
                        disabled={supplementUploading}
                        className="inline-flex items-center gap-0.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                        title="补传附件"
                      >
                        {supplementUploading&&supplementLeaveId===l.id?<Loader2 className="size-3.5 animate-spin"/>:<Plus className="size-3.5"/>}附件
                      </button>
                    )}
                    {l.status==="待审批"&&isAdmin&&(
                      <>
                        <Button size="sm" className="h-6 text-xs bg-green-500 hover:bg-green-600" onClick={()=>handleApproveLeave(l.id,"已通过")}>通过</Button>
                        <Button size="sm" variant="outline" className="h-6 text-xs text-red-500" onClick={()=>handleApproveLeave(l.id,"已驳回")}>驳回</Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}</tbody></table>
          );
          return(
            <div>
              {pending.length>0?(
                <div className="overflow-x-auto">{renderLeaveTable(pending)}</div>
              ):(
                <div className="py-6 text-center text-sm text-[var(--muted-foreground)]">{isAdmin?"暂无待审批的请假":"暂无待审批记录"}</div>
              )}
              {history.length>0&&(
                <div className="border-t border-[var(--border)]">
                  <button onClick={()=>setShowLeaveHistory(!showLeaveHistory)} className="w-full px-5 py-3 flex items-center justify-between text-sm hover:bg-[var(--muted)]/30 transition-colors">
                    <span className="font-medium text-[var(--muted-foreground)]">{isAdmin?"已审批记录":"历史记录"} ({history.length})</span>
                    <span className={"text-xs transition-transform "+(showLeaveHistory?"rotate-180":"")}>&#9660;</span>
                  </button>
                  {showLeaveHistory&&<div className="overflow-x-auto">{renderLeaveTable(history)}</div>}
                </div>
              )}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
