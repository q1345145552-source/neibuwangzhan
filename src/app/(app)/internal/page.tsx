"use client";

import { useState, useEffect, useRef } from "react";
import { useLatestRequest } from "@/lib/use-latest";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiDate, toThaiTime } from "@/lib/utils";
import { toThaiTimeOnly as toBangkokTime, bangkokMonthKey, bangkokDateStr, bangkokLastDayOfMonth, bangkokDayOfWeek } from "@/lib/time";

import { StepTimerStatic } from "@/components/step-timer";
import { AlertTriangle, CheckCircle2, Clock, Plus, Users, Calendar, TrendingUp, Download, LogIn, LogOut, History, Timer, AlertCircle, Camera, X, ChevronLeft, ChevronRight, Eye, ExternalLink, Loader2, Wallet } from "lucide-react";

interface Workload {
  name: string; orderSteps: number; influencerSteps: number; contractInfs: number; total: number; level: "ok" | "warn" | "critical";
}
interface WorkloadData { employees: Workload[]; thresholds: { warn: number; crit: number }; }

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
  // 机构业务总开关：关闭时工作量里隐藏达人相关列
  const [agencyEnabled, setAgencyEnabled] = useState(true);
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

  // 考勤汇总详情深链：?att_emp=&att_month=&att_date= 定位到某员工某月（可选某天）的打卡记录
  const pendingAttLinkRef = useRef<{ emp: string; month: string; date?: string } | null>(null);

  // Photo upload state
  const [photoModal, setPhotoModal] = useState<{ action: "check_in" | "check_out" } | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [lightboxImages, setLightboxImages] = useState<string[] | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState(0);

  const [holidays, setHolidays] = useState<{ date: string; name: string }[]>([]);

  // History toggles & date filters
  const [showAtdHistory, setShowAtdHistory] = useState(false);
  const [atdHistoryFilter, setAtdHistoryFilter] = useState<"7d" | "30d" | "all">("7d");

  // Workload detail modal
  const [wlDetailModal, setWlDetailModal] = useState<{ employee: string; type: string; label: string } | null>(null);
  const [wlDetailData, setWlDetailData] = useState<any[]>([]);
  const [wlDetailLoading, setWlDetailLoading] = useState(false);
  const [wlDetailError, setWlDetailError] = useState<string | null>(null);

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
    if (!user?.name) return;

    // 安全加载 JSON — 每个接口独立请求，验证数据格式，单个失败不影响其他
    const safeLoad = async (url: string, label: string, validator: (d: any) => boolean): Promise<any> => {
      try {
        const res = await fetchWithAuth(url, { cache: "no-store" });
        if (!res.ok) { console.error(`[内部管理] ${label} HTTP ${res.status}`); return null; }
        const raw = await res.json().catch(() => null);
        if (raw == null) { console.error(`[内部管理] ${label} 响应非 JSON`); return null; }
        if (!validator(raw)) { console.error(`[内部管理] ${label} 数据格式异常`, raw); return null; }
        return raw;
      } catch (e) { console.error(`[内部管理] ${label} 加载失败`, e); return null; }
    };

    safeLoad("/api/internal/workload", "工作量", (d: any) => d && Array.isArray(d?.employees))
      .then(d => { if (d) setWl(d as WorkloadData); });
  };

  const isWithinDays = (dateStr: string, days: number) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    return diff <= days * 24 * 60 * 60 * 1000;
  };

  const latestAttendance = useLatestRequest();
  const loadAttendance = async () => {
    const run = latestAttendance();
    const today = new Date().toISOString().split("T")[0];

    // 四个考勤接口各自独立加载，互不拖垮
    const safeFetch = async (url: string, label: string) => {
      try {
        const res = await fetchWithAuth(url, { cache: "no-store" });
        if (!res.ok) { console.error(`[内部管理] ${label} HTTP ${res.status}`); return []; }
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch (e) { console.error(`[内部管理] ${label} 加载失败`, e); return []; }
    };

    const [attData, todayData, sumData, reqData] = await Promise.all([
      safeFetch(`/api/attendance?employee=${user?.name || ""}`, "考勤记录"),
      safeFetch("/api/attendance/today", "今日考勤"),
      safeFetch(`/api/attendance/summary?month=${summaryMonth}`, "考勤汇总"),
      safeFetch("/api/attendance/request", "补卡请求"),
    ]);

    if (!run.isLatest()) return;
    setTodayRecord((attData).find((r: any) => r.date === today) || null);
    setTodayStatuses(todayData);
    setMonthlySummaries(sumData);
    setAttendanceRequests(reqData);
  };

  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // 读取机构业务总开关
  useEffect(() => {
    fetchWithAuth("/api/settings", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (typeof d.agency_enabled === "boolean") setAgencyEnabled(d.agency_enabled); })
      .catch(() => {});
  }, []);

  // 加载员工列表（供考勤日历下拉框使用）
  useEffect(() => {
    const loadStaff = async () => {
      try {
        const res = await fetchWithAuth("/api/employees", { cache: "no-store" });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
        const data = await res.json();
        const rows: any[] = Array.isArray(data) ? data : [];
        const names: string[] = rows.filter((e: any) => e.role === "employee").map((e: any) => e.name).filter(Boolean);
        setStaffNames(names);
      } catch (e) { console.error("[内部管理] 加载员工列表失败", e); }
    };
    loadStaff();
  }, []);

  const latestCalendar = useLatestRequest();
  const loadCalendar = async () => {
    // 领号：切换日历月份/成员时旧响应不能覆盖新的
    const run = latestCalendar();
    try {
      const [y, m] = calendarMonth.split("-");
      const lastDay = bangkokLastDayOfMonth(Number(y), Number(m));
      const from = `${calendarMonth}-01`;
      const to = `${calendarMonth}-${String(lastDay).padStart(2, "0")}`;
      const emp = calendarEmployee || user?.name || "";
      const res = await fetchWithAuth(`/api/attendance?employee=${encodeURIComponent(emp)}&from=${from}&to=${to}`, { cache: "no-store" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const calData = await res.json();
      if (!run.isLatest()) return;
      setCalendarData(calData);
      // 考勤汇总详情深链跳来：定位到该月后自动打开某天的打卡详情
      const link = pendingAttLinkRef.current;
      if (link && link.date && link.month === calendarMonth && link.emp === emp) {
        const rec = (Array.isArray(calData) ? calData : []).find((r: any) => r.date === link.date);
        const isSunday = bangkokDayOfWeek(link.date!) === 0;
        setCalDetailDay(rec ? { ...rec, date: link.date, isSunday } : { date: link.date, isSunday, check_in: null, check_out: null, type: null, check_in_photo: null, check_out_photo: null, ip_address: null });
        pendingAttLinkRef.current = null;
      }
    } catch (e) { console.error("[内部管理] 加载日历数据失败", e); }
  };
  const handleAnomalyClick = async (type: string, label: string, emp: string) => {
    setAnomalyModal({ type, label, employee: emp });
    setLoadingAnomaly(true);
    try {
      const res = await fetchWithAuth(`/api/attendance/details?employee=${encodeURIComponent(emp)}&month=${summaryMonth}&type=${type}`, { cache: "no-store" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      setAnomalyRecords(await res.json());
    } catch (e) { console.error("[内部管理] 加载异常明细失败", e); }
    setLoadingAnomaly(false);
  };

  useEffect(() => { loadAll(); loadAttendance(); loadCalendar(); }, [summaryMonth, calendarMonth, calendarEmployee, user?.name]);

  // 读取 URL 深链参数：考勤汇总详情点「出勤天数/迟到某天」跳过来，定位打卡日历
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const emp = sp.get("att_emp");
      const month = sp.get("att_month");
      const date = sp.get("att_date");
      if (emp) setCalendarEmployee(emp);
      if (month && /^\d{4}-\d{2}$/.test(month)) setCalendarMonth(month);
      if (emp && month && /^\d{4}-\d{2}$/.test(month)) {
        pendingAttLinkRef.current = { emp, month, date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined };
      }
      if (emp || month) {
        setTimeout(() => document.getElementById("attendance-calendar")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchWithAuth("/api/thai-holidays")
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setHolidays(d); })
      .catch(() => {});
  }, []);

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
    if (isAdmin) { alert("管理员无需打卡"); return; }
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

  const downloadXlsx = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportAttendanceDetail = async () => {
    try {
      const res = await fetchWithAuth(`/api/attendance/export?type=detail&month=${attendanceMonth}`, { cache: "no-store" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || "导出失败"); return; }
      const blob = await res.blob();
      downloadXlsx(blob, `考勤明细_${attendanceMonth}.xlsx`);
    } catch { alert("导出失败"); }
  };

  const handleExportAttendanceSummary = async () => {
    try {
      const res = await fetchWithAuth(`/api/attendance/export?type=summary&month=${attendanceMonth}`, { cache: "no-store" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e.error || "导出失败"); return; }
      const blob = await res.blob();
      downloadXlsx(blob, `考勤汇总_${attendanceMonth}.xlsx`);
    } catch { alert("导出失败"); }
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
    // 后端可能返回 403（非管理员）/404（申请不存在），失败要给提示而不是静默刷新
    const ok = await apiCall("/api/attendance/request", { method: "PATCH", body: { id, status } });
    if (ok) loadAttendance();
  };

  const isAdmin = user?.role === "admin";
  // 考勤导出选中的月份（默认当前曼谷月，切换后明细/汇总导出都按这个月导出）
  const [attendanceMonth, setAttendanceMonth] = useState(bangkokMonthKey());

  // ── 工资设置（管理员）──
  const [salaryRows, setSalaryRows] = useState<any[]>([]);
  const [salaryLoading, setSalaryLoading] = useState(false);
  const [salarySavingId, setSalarySavingId] = useState<number | null>(null);
  const [salarySavedId, setSalarySavedId] = useState<number | null>(null);

  // ── 工作证/签证到期提醒（管理员）──
  const [expiryAlerts, setExpiryAlerts] = useState<{ employee_name: string; label: string; date: string; days_left: number; expired: boolean }[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchWithAuth("/api/internal/expiry-alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setExpiryAlerts(Array.isArray(d) ? d : []))
      .catch(() => setExpiryAlerts([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    setSalaryLoading(true);
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setSalaryRows(d.filter((e: any) => e.role === "employee")); })
      .catch(() => {})
      .finally(() => setSalaryLoading(false));
  }, [isAdmin]);

  const updateSalaryRow = (id: number, field: string, value: string) => {
    setSalaryRows((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  };

  const saveSalary = async (id: number) => {
    const row = salaryRows.find((e) => e.id === id);
    if (!row) return;
    setSalarySavingId(id);
    try {
      const r = await fetchWithAuth("/api/employees", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          base_salary: row.base_salary === "" || row.base_salary === null || row.base_salary === undefined ? 0 : Number(row.base_salary),
          diligence_bonus: row.diligence_bonus === "" || row.diligence_bonus === null || row.diligence_bonus === undefined ? null : Number(row.diligence_bonus),
          skill_allowance: row.skill_allowance === "" || row.skill_allowance === null || row.skill_allowance === undefined ? 0 : Number(row.skill_allowance),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setSalaryRows((prev) => prev.map((e) => (e.id === id ? { ...e, base_salary: d.base_salary ?? 0, diligence_bonus: d.diligence_bonus ?? null, skill_allowance: d.skill_allowance ?? 0 } : e)));
        setSalarySavedId(id);
        setTimeout(() => setSalarySavedId((cur) => (cur === id ? null : cur)), 1500);
      } else {
        alert(d?.error || "保存失败");
      }
    } catch {
      alert("保存失败");
    } finally {
      setSalarySavingId(null);
    }
  };

  // ── 我的工资单（员工）──
  const [myPayslips, setMyPayslips] = useState<any[]>([]);
  const [myPayslipsLoading, setMyPayslipsLoading] = useState(false);
  // 员工端只显示这三种状态的工资单；草稿/打回不显示
  const visiblePayslipStatuses = ["待确认", "已确认", "已发放"];

  useEffect(() => {
    if (isAdmin) return;
    setMyPayslipsLoading(true);
    fetchWithAuth("/api/payslips", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMyPayslips(Array.isArray(d) ? d.filter((p: any) => visiblePayslipStatuses.includes(p.status)) : []))
      .catch(() => setMyPayslips([]))
      .finally(() => setMyPayslipsLoading(false));
  }, [isAdmin]);

  const payslipTotal = (p: any) => (Number(p.base_salary) || 0) + (Number(p.diligence_bonus) || 0) + (Number(p.skill_allowance) || 0) + (Number(p.bonus) || 0) + (Number(p.commission) || 0) + (Number(p.overtime) || 0) + (Number(p.merit_income) || 0);
  const payslipDeduct = (p: any) => (Number(p.social_security) || 0) + (Number(p.late_deduction) || 0) + (Number(p.personal_leave_deduction) || 0) + (Number(p.sick_leave_deduction) || 0) + (Number(p.absence_deduction) || 0) + (Number(p.demerit_deduction) || 0) + (Number(p.withholding_tax) || 0);
  const payslipStatusClass = (s: string) => (
    s === "打回" ? "bg-red-500/15 text-red-600" :
    s === "已发放" ? "bg-emerald-500/15 text-emerald-600" :
    s === "已确认" ? "bg-green-500/15 text-green-600" :
    s === "待确认" ? "bg-blue-500/15 text-blue-600" :
    "bg-slate-500/15 text-slate-600"
  );
  const payslipMoney = (v: any) => (Number(v) || 0).toFixed(2);

  const payslipAction = async (id: number, action: string, reason?: string) => {
    try {
      const r = await fetchWithAuth("/api/payslips/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, reason }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.id) {
        // 打回后从员工端消失；其余状态更新后再过滤一遍（只留待确认/已确认/已发放）
        setMyPayslips((prev) => prev
          .map((p) => (p.id === id ? { ...p, status: d.status, reject_reason: d.reject_reason } : p))
          .filter((p) => visiblePayslipStatuses.includes(p.status)));
      } else {
        alert(d?.error || "操作失败");
      }
    } catch {
      alert("操作失败");
    }
  };

  const confirmPayslip = (id: number) => {
    if (confirm("确认这份工资单无误？")) payslipAction(id, "confirm");
  };
  const rejectPayslip = (id: number) => {
    const reason = prompt("请填写修改意见");
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) { alert("请填写修改意见"); return; }
    payslipAction(id, "reject", trimmed);
  };


  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">内部管理</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">问题工单 · 工作量 · 考勤打卡</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => window.location.href = "/internal/payslips"}>工资单</Button>
            )}
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => window.location.href = "/internal/weekly-report"}>周报</Button>
          </div>
        </div>
      </div>

      {/* ── 工作证 / 签证到期提醒（管理员） ── */}
      {isAdmin && expiryAlerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">证照到期提醒</h2>
          </div>
          <ul className="space-y-1">
            {expiryAlerts.map((a, i) => (
              <li key={i} className="text-sm text-[var(--foreground)]">
                <span className="font-medium">{a.employee_name}</span> 的 <span className="font-medium">{a.label}</span>
                {a.expired ? (
                  <span className="ml-1 font-medium text-red-600">已过期 {a.days_left} 天</span>
                ) : (
                  <span className="ml-1 font-medium text-amber-600">{a.days_left === 0 ? "今天到期" : `${a.days_left} 天后到期`}</span>
                )}
                <span className="ml-1 text-[var(--muted-foreground)]">（{a.date}）</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── 工资设置（管理员） ── */}
      {isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2"><Wallet className="size-4" />工资设置</h2>
          </div>
          <div className="p-5">
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">给每个员工设置底薪、勤奋奖、技能津贴，保存后写入员工档案。</p>
            {salaryLoading ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : salaryRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无员工</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="py-2 px-3 text-left text-xs font-medium text-[var(--muted-foreground)]">员工</th>
                      <th className="py-2 px-3 text-left text-xs font-medium text-[var(--muted-foreground)]">底薪</th>
                      <th className="py-2 px-3 text-left text-xs font-medium text-[var(--muted-foreground)]">勤奋奖（可空）</th>
                      <th className="py-2 px-3 text-left text-xs font-medium text-[var(--muted-foreground)]">技能津贴</th>
                      <th className="py-2 px-3 text-right text-xs font-medium text-[var(--muted-foreground)]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salaryRows.map((e) => (
                      <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="py-2 px-3 whitespace-nowrap text-[var(--foreground)]">{e.name}</td>
                        <td className="py-2 px-3">
                          <input
                            type="number" min="0" step="0.01"
                            value={e.base_salary ?? ""}
                            onChange={(ev) => updateSalaryRow(e.id, "base_salary", ev.target.value)}
                            placeholder="0"
                            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number" min="0" step="0.01"
                            value={e.diligence_bonus ?? ""}
                            onChange={(ev) => updateSalaryRow(e.id, "diligence_bonus", ev.target.value)}
                            placeholder="可空"
                            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <input
                            type="number" min="0" step="0.01"
                            value={e.skill_allowance ?? ""}
                            onChange={(ev) => updateSalaryRow(e.id, "skill_allowance", ev.target.value)}
                            placeholder="0"
                            className="h-8 w-28 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <Button size="sm" onClick={() => saveSalary(e.id)} disabled={salarySavingId === e.id} className="h-7 text-xs">
                            {salarySavingId === e.id ? "保存中…" : salarySavedId === e.id ? "已保存" : "保存"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 我的工资单（员工） ── */}
      {!isAdmin && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><Wallet className="size-4" />我的工资单</h2>
          </div>
          <div className="p-5">
            {myPayslipsLoading ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : myPayslips.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无工资单</p>
            ) : (
              <div className="flex flex-col gap-3">
                {myPayslips.map((p) => {
                  const income = payslipTotal(p);
                  const deduct = payslipDeduct(p);
                  const net = income - deduct;
                  return (
                    <div key={p.id} className="rounded-lg border border-[var(--border)] p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="font-medium text-[var(--foreground)]">{p.month} 工资单</span>
                        <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", payslipStatusClass(p.status))}>{p.status}</span>
                      </div>

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-[var(--muted-foreground)]">收入</p>
                          <div className="space-y-1">
                            {[["底薪", p.base_salary], ["勤奋奖", p.diligence_bonus], ["技能津贴", p.skill_allowance], ["奖金", p.bonus], ["佣金", p.commission], ["加班费", p.overtime], ["功过收入", p.merit_income]].map(([label, val]) => (
                              <div key={String(label)} className="flex justify-between text-sm">
                                <span className="text-[var(--muted-foreground)]">{label}</span>
                                <span className="tabular-nums text-[var(--foreground)]">{payslipMoney(val)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-1.5 flex justify-between border-t border-[var(--border)] pt-1.5 text-sm font-medium">
                            <span>收入合计</span>
                            <span className="tabular-nums">{income.toFixed(2)}</span>
                          </div>
                        </div>
                        <div>
                          <p className="mb-1.5 text-xs font-semibold text-[var(--muted-foreground)]">扣除</p>
                          <div className="space-y-1">
                            {[["社保", p.social_security], ["迟到扣款", p.late_deduction], ["事假扣款", p.personal_leave_deduction], ["病假扣款", p.sick_leave_deduction], ["缺勤扣款", p.absence_deduction], ["功过扣款", p.demerit_deduction], ["预扣税", p.withholding_tax]].map(([label, val]) => (
                              <div key={String(label)} className="flex justify-between text-sm">
                                <span className="text-[var(--muted-foreground)]">{label}</span>
                                <span className="tabular-nums text-[var(--foreground)]">{payslipMoney(val)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-1.5 flex justify-between border-t border-[var(--border)] pt-1.5 text-sm font-medium">
                            <span>扣除合计</span>
                            <span className="tabular-nums">{deduct.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between rounded-md bg-[var(--muted)]/40 px-3 py-2">
                        <span className="text-sm font-medium text-[var(--foreground)]">净收入</span>
                        <span className="text-lg font-semibold tabular-nums text-emerald-600">{net.toFixed(2)}</span>
                      </div>

                      {p.status === "打回" && p.reject_reason && (
                        <p className="mt-2 text-xs text-red-500">修改意见：{p.reject_reason}</p>
                      )}
                      {p.status === "待确认" && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => confirmPayslip(p.id)}>确认</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => rejectPayslip(p.id)}>打回</Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 今日考勤打卡 ── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2"><Calendar className="size-4" />今日考勤打卡</h2>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <input
                  type="month"
                  value={attendanceMonth}
                  onChange={(e) => setAttendanceMonth(e.target.value)}
                  className="h-7 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                />
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportAttendanceDetail}><Download className="size-3" />明细导出</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportAttendanceSummary}><Download className="size-3" />汇总导出</Button>
              </>
            )}
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
              {(Array.isArray(todayStatuses) ? todayStatuses : []).map(s => (
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
          <table className="w-full text-sm hidden md:table">
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
              {(Array.isArray(monthlySummaries) ? monthlySummaries : []).length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无数据</td></tr>
              ) : (
                (Array.isArray(monthlySummaries) ? monthlySummaries : []).map(m => (
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
          {/* 手机端卡片 */}
          <div className="md:hidden flex flex-col gap-2 p-3">
            {(Array.isArray(monthlySummaries) ? monthlySummaries : []).map(m => (
              <div key={m.name} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[var(--foreground)]">{m.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">工时 {m.totalHours}h</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><p className="tabular-nums text-green-600">{m.normalDays}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">正常</p></div>
                  <div onClick={() => m.supplementDays > 0 && handleAnomalyClick("supplement", "补签明细", m.name)}><p className="tabular-nums text-amber-600">{m.supplementDays}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">补签</p></div>
                  <div onClick={() => m.leaveCount > 0 && handleAnomalyClick("leave", "请假明细", m.name)}><p className="tabular-nums text-blue-600">{m.leaveCount}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">请假</p></div>
                  <div onClick={() => m.lateCount > 0 && handleAnomalyClick("late", "迟到明细", m.name)}><p className="tabular-nums text-orange-600">{m.lateCount}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">迟到</p></div>
                  <div onClick={() => m.absentCount > 0 && handleAnomalyClick("absent", "缺勤明细", m.name)}><p className={cn("tabular-nums", m.absentCount > 0 && "text-red-600 font-semibold")}>{m.absentCount}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">缺勤</p></div>
                  <div><p className="tabular-nums text-[var(--muted-foreground)]">{m.workDays}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">工作日</p></div>
                </div>
              </div>
            ))}
          </div>
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

      {/* ── 考勤日历 ── */}
      <div id="attendance-calendar" className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
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
                const rec = (Array.isArray(calendarData) ? calendarData : []).find((r:any) => r.date === ds);
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
                        <p>类型: {r.leave_type} | 目的地: {r.destination || "—"} | 审批人: {r.approved_by || "—"} | 审批时间: {r.approved_at?.slice(0,16) || "—"}</p>
                        {r.rejection_reason && <p className="mt-0.5 text-red-600">驳回原因: {r.rejection_reason}</p>}
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
          {(Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status === "待审批").length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无待审批的补卡申请</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm hidden md:table">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-2.5 px-4 text-left text-xs font-medium">申请人</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">日期</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">时间</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">目的地</th>
              <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium">照片</th>
                    <th className="py-2.5 px-4 text-left text-xs font-medium w-10"></th>
                  {isAdmin && <th className="py-2.5 px-2 text-left text-xs font-medium">拼假</th>}
              <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status === "待审批").map(r => (
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
              {/* 手机端卡片 */}
              <div className="md:hidden flex flex-col gap-2 p-3">
                {(Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status === "待审批").map(r => (
                  <div key={r.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[var(--foreground)]">{r.employee_name}</span>
                      <span className="text-xs text-[var(--muted-foreground)]">{r.date} {r.time}</span>
                    </div>
                    <div className="mt-2 space-y-1.5 text-sm">
                      <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">原因</span><span>{r.reason || "—"}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">照片</span>{r.photo ? <a href={r.photo} target="_blank" className="text-blue-500 underline text-xs">查看</a> : <span>—</span>}</div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" className="h-6 text-xs bg-green-500 hover:bg-green-600" onClick={() => handleApproveRequest(r.id, "已通过")}>通过</Button>
                      <Button size="sm" variant="outline" className="h-6 text-xs text-red-500" onClick={() => handleApproveRequest(r.id, "已驳回")}>驳回</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        {(Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批").length > 0 && (
          <div className="border-t border-[var(--border)]">
            {!showAtdHistory ? (
              <button
                className="w-full px-5 py-3 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors text-left"
                onClick={() => setShowAtdHistory(true)}
              >
                历史记录 ({(Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批").length})
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
                  ? (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 7))
                  : atdHistoryFilter === "30d"
                  ? (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 30))
                  : (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批")
                ).length === 0 ? (
                  <p className="text-xs text-[var(--muted-foreground)] py-2">该时间段内无记录</p>
                ) : (
                  (atdHistoryFilter === "7d"
                    ? (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 7))
                    : atdHistoryFilter === "30d"
                    ? (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批" && isWithinDays(r.created_at, 30))
                    : (Array.isArray(attendanceRequests)?attendanceRequests:[]).filter(r => r.status !== "待审批")
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
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-2.5 px-5 text-left text-xs font-medium text-[var(--muted-foreground)]">员工</th>
                <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">订单笔数</th>
                {agencyEnabled && <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">达人个数</th>}
                {agencyEnabled && <th className="py-2.5 px-4 text-center text-xs font-medium text-[var(--muted-foreground)]">签约跟进</th>}
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
                  {agencyEnabled && (
                    <td className="py-2.5 px-4 text-center tabular-nums">
                      {e.influencerSteps > 0 ? (
                        <button onClick={() => handleWlDetail(e.name, "influencer_steps", `${e.name} 的达人`)} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                          {e.influencerSteps}<ExternalLink className="size-2.5 opacity-60" />
                        </button>
                      ) : "0"}
                    </td>
                  )}
                  {agencyEnabled && (
                    <td className="py-2.5 px-4 text-center tabular-nums">
                      {e.contractInfs > 0 ? (
                        <button onClick={() => handleWlDetail(e.name, "contract_infs", `${e.name} 的签约跟进`)} className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline font-medium cursor-pointer">
                          {e.contractInfs}<ExternalLink className="size-2.5 opacity-60" />
                        </button>
                      ) : "0"}
                    </td>
                  )}
                  <td className={cn(
                    "py-2.5 px-4 text-center tabular-nums font-semibold",
                    e.level === "critical" && "text-red-600",
                    e.level === "warn" && "text-amber-600"
                  )}>{e.total}</td>
                </tr>
              ))}
              {(!wl || wl.employees.length === 0) && (
                <tr><td colSpan={agencyEnabled ? 5 : 3} className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无数据</td></tr>
              )}
            </tbody>
          </table>
          {/* 手机端卡片 */}
          <div className="md:hidden flex flex-col gap-2 p-3">
            {(wl?.employees || []).map((e: Workload) => (
              <div key={e.name} className={cn("rounded-lg border border-[var(--border)] bg-[var(--card)] p-4",
                e.level === "critical" && "bg-red-50/60 dark:bg-red-950/20",
                e.level === "warn" && "bg-amber-50/60 dark:bg-amber-950/20"
              )}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">{e.name}
                    {e.level === "critical" && <AlertTriangle className="size-3 text-red-500" />}
                    {e.level === "warn" && <AlertTriangle className="size-3 text-amber-500" />}
                  </span>
                  <span className={cn("font-semibold tabular-nums", e.level === "critical" && "text-red-600", e.level === "warn" && "text-amber-600")}>{e.total}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                  <div onClick={() => e.orderSteps > 0 && handleWlDetail(e.name, "order_steps", `${e.name} 的订单`)}><p className="tabular-nums text-blue-600">{e.orderSteps}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">订单</p></div>
                  {agencyEnabled && <div onClick={() => e.influencerSteps > 0 && handleWlDetail(e.name, "influencer_steps", `${e.name} 的达人`)}><p className="tabular-nums text-blue-600">{e.influencerSteps}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">达人</p></div>}
                  {agencyEnabled && <div onClick={() => e.contractInfs > 0 && handleWlDetail(e.name, "contract_infs", `${e.name} 的签约跟进`)}><p className="tabular-nums text-blue-600">{e.contractInfs}</p><p className="text-[0.6rem] text-[var(--muted-foreground)]">签约</p></div>}
                </div>
              </div>
            ))}
          </div>
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

      {/* ── 泰国法定假日日历 ── */}
      {holidays.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2">📅 泰国法定假日日历</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 gap-2">
              {holidays.map((h) => {
                const d = new Date(h.date + "T00:00:00+07:00");
                const monthNames = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
                return (
                  <div key={h.date} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-center">
                    <p className="text-[0.6rem] text-amber-600 dark:text-amber-400 font-medium">{monthNames[d.getMonth()]}{d.getDate()}日</p>
                    <p className="text-[0.65rem] text-[var(--foreground)] mt-0.5 leading-tight">{h.name.split(" (")[0]}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
