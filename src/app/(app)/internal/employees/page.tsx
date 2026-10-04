"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWithAuth, updateEmployee, fetchEmployeeRecords, createEmployeeRecord, fetchEmployeeFiles, uploadEmployeeFile, deleteEmployeeFile, fetchDemerits, createDemerit, fetchHandover, toggleHandoverItem, fetchEmployeeInfoChanges, createEmployeeInfoChange, reviewEmployeeInfoChange, fetchEducations, createEducation, updateEducation, deleteEducation, type EmployeeRecord, type EmployeeFile, type Demerit, type HandoverItem, type EmployeeInfoChange, type EmployeeEducation } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, fileUrl, zodiacFromBirthDate } from "@/lib/utils";
import { ArrowLeft, IdCard, Download, Eye, Trash2 } from "lucide-react";

interface ProfileEmployee {
  id: number;
  name: string;
  email?: string;
  role?: string;
  status?: string;
  [key: string]: any;
}

const FORM_FIELDS = [
  "email", "gender", "birth_date", "phone", "address", "id_number",
  "department", "position", "contract_term",
  "bank_name", "bank_account",
  "emergency_name", "emergency_phone", "emergency_relation",
  "skills", "notes", "bazi", "fortune",
  "passport_number", "social_security_number", "tax_number", "work_permit_number", "work_permit_expiry", "visa_expiry",
] as const;

const EDUCATION_LEVELS = ["高中", "中专", "大专", "本科", "硕士", "博士", "其他"] as const;

export default function EmployeeProfilesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [employees, setEmployees] = useState<ProfileEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProfileEmployee | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [formErr, setFormErr] = useState("");
  // 记过/记优点
  const [records, setRecords] = useState<EmployeeRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordType, setRecordType] = useState<"demerit" | "merit">("merit");
  const [recordPoints, setRecordPoints] = useState("");
  const [recordContent, setRecordContent] = useState("");
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordErr, setRecordErr] = useState("");
  // 档案文件
  const [files, setFiles] = useState<EmployeeFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileCategory, setFileCategory] = useState("合同");
  const [fileUploading, setFileUploading] = useState(false);
  const [fileErr, setFileErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 记过（严重处分）
  const [demerits, setDemerits] = useState<Demerit[]>([]);
  const [demeritCount, setDemeritCount] = useState(0);
  const [demeritsLoading, setDemeritsLoading] = useState(false);
  const [demeritContent, setDemeritContent] = useState("");
  const [demeritSaving, setDemeritSaving] = useState(false);
  const [demeritErr, setDemeritErr] = useState("");
  const demeritFileInputRef = useRef<HTMLInputElement>(null);
  // 离职交接清单 + 员工状态
  const [handover, setHandover] = useState<HandoverItem[]>([]);
  const [handoverLoading, setHandoverLoading] = useState(false);
  const [showResignForm, setShowResignForm] = useState(false);
  const [resignDate, setResignDate] = useState("");
  const [resignReason, setResignReason] = useState("");
  const [resignSaving, setResignSaving] = useState(false);
  const [resignErr, setResignErr] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  // 信息变更申请
  const [infoChanges, setInfoChanges] = useState<EmployeeInfoChange[]>([]);
  const [infoChangesLoading, setInfoChangesLoading] = useState(false);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [changeForm, setChangeForm] = useState({ phone: "", address: "", emergency_name: "", emergency_phone: "", emergency_relation: "" });
  const [changeSaving, setChangeSaving] = useState(false);
  const [changeErr, setChangeErr] = useState("");
  const [rejectModal, setRejectModal] = useState<{ id: number; employee: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // 标签页：基本信息 / 考勤 / 请假 / 工资历史
  const [activeTab, setActiveTab] = useState<"info" | "attendance" | "leave" | "payslip">("info");
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [leaveRecords, setLeaveRecords] = useState<any[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [payslipRecords, setPayslipRecords] = useState<any[]>([]);
  const [payslipLoading, setPayslipLoading] = useState(false);
  // 批量导出勾选
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  // 教育履历
  const [educations, setEducations] = useState<EmployeeEducation[]>([]);
  const [educationsLoading, setEducationsLoading] = useState(false);
  const [eduForm, setEduForm] = useState({ level: "本科", school: "", major: "", grad_year: "" });
  const [editingEduId, setEditingEduId] = useState<number | null>(null);
  const [eduSaving, setEduSaving] = useState(false);
  const [eduErr, setEduErr] = useState("");

  const selectEmp = (e: ProfileEmployee) => {
    setSelected(e);
    setActiveTab("info");
    setAttendanceRecords([]);
    setLeaveRecords([]);
    setPayslipRecords([]);
    const f: Record<string, string> = {};
    for (const k of FORM_FIELDS) f[k] = (e as any)[k] ?? "";
    setForm(f);
    setSavedMsg("");
    // 加载该员工的记过/记优点记录
    setRecords([]);
    setRecordsLoading(true);
    setRecordErr("");
    setRecordPoints("");
    setRecordContent("");
    fetchEmployeeRecords(e.id)
      .then((r) => setRecords(Array.isArray(r) ? r : []))
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
    // 加载该员工的档案文件
    setFiles([]);
    setFilesLoading(true);
    setFileErr("");
    fetchEmployeeFiles(e.id)
      .then((r) => setFiles(Array.isArray(r) ? r : []))
      .catch(() => setFiles([]))
      .finally(() => setFilesLoading(false));
    // 加载该员工的记过（严重处分）记录
    setDemerits([]);
    setDemeritCount(0);
    setDemeritsLoading(true);
    setDemeritErr("");
    setDemeritContent("");
    fetchDemerits(e.id)
      .then((r) => { setDemerits(Array.isArray(r.records) ? r.records : []); setDemeritCount(Number(r.count) || 0); })
      .catch(() => { setDemerits([]); setDemeritCount(0); })
      .finally(() => setDemeritsLoading(false));
    // 加载离职交接清单
    setHandover([]);
    setHandoverLoading(true);
    fetchHandover(e.id)
      .then((r) => setHandover(Array.isArray(r) ? r : []))
      .catch(() => setHandover([]))
      .finally(() => setHandoverLoading(false));
    // 重置离职表单
    setShowResignForm(false);
    setResignDate("");
    setResignReason("");
    setResignErr("");
    // 加载教育履历
    setEducations([]);
    setEducationsLoading(true);
    setEditingEduId(null);
    setEduForm({ level: "本科", school: "", major: "", grad_year: "" });
    setEduErr("");
    fetchEducations(e.id)
      .then((r) => setEducations(Array.isArray(r) ? r : []))
      .catch(() => setEducations([]))
      .finally(() => setEducationsLoading(false));
  };

  const uploadFile = async () => {
    if (!selected) return;
    const file = fileInputRef.current?.files?.[0];
    if (!file) { setFileErr("请选择文件"); return; }
    setFileUploading(true);
    setFileErr("");
    try {
      const rec = await uploadEmployeeFile(selected.id, fileCategory, file);
      setFiles((prev) => [rec, ...prev]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setFileErr(err instanceof Error ? err.message : "上传失败");
    } finally {
      setFileUploading(false);
    }
  };

  const removeFile = async (id: number) => {
    if (!confirm("确定删除这个文件？")) return;
    try {
      await deleteEmployeeFile(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const downloadPdf = async () => {
    if (!selected) return;
    try {
      const res = await fetchWithAuth(`/api/employees/${selected.id}/pdf`, {});
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e?.error || "导出失败"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `员工档案-${selected.name}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("导出失败");
    }
  };

  // 批量导出：勾选/全选/导出
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllEmployees = () => {
    setSelectedIds(new Set(employees.map((e) => e.id)));
  };
  const clearSelect = () => setSelectedIds(new Set());
  const allSelected = employees.length > 0 && selectedIds.size === employees.length;

  const downloadZip = async (ids: number[] | "all") => {
    setExporting(true);
    try {
      const res = await fetchWithAuth("/api/employees/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); alert(e?.error || "导出失败"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "员工档案-批量导出.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("导出失败");
    } finally {
      setExporting(false);
    }
  };
  const exportSelected = () => {
    if (selectedIds.size === 0) { alert("请先勾选要导出的员工"); return; }
    downloadZip([...selectedIds]);
  };
  const exportAll = () => downloadZip("all");

  const loadInfoChanges = () => {
    setInfoChangesLoading(true);
    fetchEmployeeInfoChanges()
      .then((r) => setInfoChanges(Array.isArray(r) ? r : []))
      .catch(() => setInfoChanges([]))
      .finally(() => setInfoChangesLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    const url = isAdmin ? "/api/employees?include_left=1" : "/api/employees?self=1";
    fetchWithAuth(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d.filter((e: any) => e.role === "employee") : [];
        setEmployees(list);
        if (!isAdmin && list.length > 0) selectEmp(list[0]);
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
    loadInfoChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const setField = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  // 档案格式校验：身份证13位数字 / 电话数字长度 / 银行账号数字 / 邮箱格式+去重
  const validateForm = (): string | null => {
    const email = (form.email || "").trim();
    const phone = (form.phone || "").trim();
    const idNumber = (form.id_number || "").trim();
    const bankAccount = (form.bank_account || "").trim();

    if (email && !/^\S+@\S+\.\S+$/.test(email)) return "邮箱格式不正确";
    if (email && employees.some((e) => e.email && e.id !== selected?.id && e.email.toLowerCase() === email.toLowerCase())) {
      return "邮箱已存在";
    }
    if (phone && !/^\d{9,11}$/.test(phone)) return "电话需为9-11位数字";
    if (idNumber && !/^\d{13}$/.test(idNumber)) return "身份证号需为13位数字（泰国身份证）";
    if (bankAccount && !/^\d+$/.test(bankAccount)) return "银行账号只能为数字";
    return null;
  };

  const save = async () => {
    if (!selected) return;
    setFormErr("");
    setSavedMsg("");
    const err = validateForm();
    if (err) { setFormErr(err); return; }
    setSaving(true);
    try {
      const emp = await updateEmployee(selected.id, form);
      setSelected({ ...selected, ...emp });
      setEmployees((prev) => prev.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)));
      setSavedMsg("已保存");
      setTimeout(() => setSavedMsg((m) => (m === "已保存" ? "" : m)), 1500);
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const addRecord = async () => {
    if (!selected) return;
    const points = Number(recordPoints);
    if (!Number.isInteger(points) || points <= 0) { setRecordErr("分值需为正整数"); return; }
    if (!recordContent.trim()) { setRecordErr("请填写内容"); return; }
    setRecordSaving(true);
    setRecordErr("");
    try {
      const rec = await createEmployeeRecord({ employee_id: selected.id, type: recordType, points, content: recordContent.trim() });
      setRecords((prev) => [rec, ...prev]);
      setRecordPoints("");
      setRecordContent("");
    } catch (err) {
      setRecordErr(err instanceof Error ? err.message : "记录失败");
    } finally {
      setRecordSaving(false);
    }
  };

  const addDemerit = async () => {
    if (!selected) return;
    if (!demeritContent.trim()) { setDemeritErr("请填写记过内容"); return; }
    const file = demeritFileInputRef.current?.files?.[0] || null;
    setDemeritSaving(true);
    setDemeritErr("");
    try {
      const rec = await createDemerit(selected.id, demeritContent.trim(), file);
      setDemerits((prev) => [rec, ...prev]);
      setDemeritCount((c) => c + 1);
      setDemeritContent("");
      if (demeritFileInputRef.current) demeritFileInputRef.current.value = "";
    } catch (err) {
      setDemeritErr(err instanceof Error ? err.message : "记过失败");
    } finally {
      setDemeritSaving(false);
    }
  };

  // 切换状态（试用期 / 待离职 / 停薪留职 / 恢复在职）
  const changeStatus = async (status: string) => {
    if (!selected) return;
    setStatusUpdating(true);
    try {
      const emp = await updateEmployee(selected.id, { status });
      setSelected({ ...selected, ...emp });
      setEmployees((prev) => prev.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "状态更新失败");
    } finally {
      setStatusUpdating(false);
    }
  };

  // 提交离职：离职日期 + 离职原因两个都必填
  const submitResign = async () => {
    if (!selected) return;
    if (!resignDate.trim()) { setResignErr("请填写离职日期"); return; }
    if (!resignReason.trim()) { setResignErr("请填写离职原因"); return; }
    setResignSaving(true);
    setResignErr("");
    try {
      const emp = await updateEmployee(selected.id, { status: "离职", resignation_date: resignDate.trim(), resignation_reason: resignReason.trim() });
      setSelected({ ...selected, ...emp });
      setEmployees((prev) => prev.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)));
      setShowResignForm(false);
      setResignDate("");
      setResignReason("");
      // 标记离职后服务器会补全默认交接事项，重新拉取
      fetchHandover(selected.id)
        .then((r) => setHandover(Array.isArray(r) ? r : []))
        .catch(() => {});
    } catch (err) {
      setResignErr(err instanceof Error ? err.message : "标记离职失败");
    } finally {
      setResignSaving(false);
    }
  };

  // 交接清单逐项打勾 / 取消
  const toggleHandover = async (item: HandoverItem) => {
    try {
      const updated = await toggleHandoverItem(item.id, item.done !== 1);
      setHandover((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
    }
  };

  // 教育履历：新增 / 编辑 / 删除
  const saveEducation = async () => {
    if (!selected) return;
    if (!eduForm.level.trim() || !eduForm.school.trim()) { setEduErr("学历层次和学校名称必填"); return; }
    setEduSaving(true);
    setEduErr("");
    try {
      const payload = {
        level: eduForm.level.trim(),
        school: eduForm.school.trim(),
        major: eduForm.major.trim(),
        grad_year: eduForm.grad_year.trim(),
      };
      if (editingEduId != null) {
        const updated = await updateEducation(editingEduId, payload);
        setEducations((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        setEditingEduId(null);
      } else {
        const rec = await createEducation({ employee_id: selected.id, ...payload });
        setEducations((prev) => [rec, ...prev]);
      }
      setEduForm({ level: "本科", school: "", major: "", grad_year: "" });
    } catch (err) {
      setEduErr(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEduSaving(false);
    }
  };
  const startEditEducation = (e: EmployeeEducation) => {
    setEditingEduId(e.id);
    setEduForm({ level: e.level, school: e.school, major: e.major, grad_year: e.grad_year });
    setEduErr("");
  };
  const cancelEditEducation = () => {
    setEditingEduId(null);
    setEduForm({ level: "本科", school: "", major: "", grad_year: "" });
    setEduErr("");
  };
  const removeEducation = async (id: number) => {
    if (!confirm("确定删除这条学历？")) return;
    try {
      await deleteEducation(id);
      setEducations((prev) => prev.filter((e) => e.id !== id));
      if (editingEduId === id) cancelEditEducation();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  // 员工自助提交信息变更申请
  const submitInfoChange = async () => {
    if (!selected) return;
    if (!changeForm.phone.trim() || !changeForm.address.trim() || !changeForm.emergency_name.trim() || !changeForm.emergency_phone.trim()) {
      setChangeErr("电话、地址、紧急联系人（姓名和电话）都必填");
      return;
    }
    setChangeSaving(true);
    setChangeErr("");
    try {
      const rec = await createEmployeeInfoChange({
        phone: changeForm.phone.trim(),
        address: changeForm.address.trim(),
        emergency_name: changeForm.emergency_name.trim(),
        emergency_phone: changeForm.emergency_phone.trim(),
        emergency_relation: changeForm.emergency_relation.trim(),
      });
      setInfoChanges((prev) => [rec, ...prev]);
      setShowChangeForm(false);
    } catch (err) {
      setChangeErr(err instanceof Error ? err.message : "提交失败");
    } finally {
      setChangeSaving(false);
    }
  };

  // 管理员审核：通过（通过后新信息生效）
  const approveChange = async (id: number) => {
    try {
      const updated = await reviewEmployeeInfoChange(id, "已通过");
      setInfoChanges((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      // 若通过的是当前选中员工的申请，刷新其档案显示（电话/地址/紧急联系人已生效）
      const req = infoChanges.find((c) => c.id === id);
      if (selected && req && req.employee_id === selected.id) {
        const res = await fetchWithAuth("/api/employees?include_left=1", { cache: "no-store" });
        const data = await res.json();
        const list = (Array.isArray(data) ? data : []).filter((e: any) => e.role === "employee");
        setEmployees(list);
        const me = list.find((e: any) => e.id === selected.id);
        if (me) setSelected(me);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "审核失败");
    }
  };

  // 管理员审核：驳回（需填原因）
  const confirmReject = async () => {
    if (!rejectModal) return;
    if (!rejectReason.trim()) { alert("请填写驳回原因"); return; }
    setRejecting(true);
    try {
      const updated = await reviewEmployeeInfoChange(rejectModal.id, "已驳回", rejectReason.trim());
      setInfoChanges((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setRejectModal(null);
      setRejectReason("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "驳回失败");
    } finally {
      setRejecting(false);
    }
  };

  // 标签页数据加载
  const loadAttendance = async () => {
    if (!selected) return;
    setAttendanceLoading(true);
    try {
      const res = await fetchWithAuth(`/api/attendance?employee=${encodeURIComponent(selected.name)}`, { cache: "no-store" });
      const data = await res.json();
      setAttendanceRecords(Array.isArray(data) ? data : []);
    } catch { setAttendanceRecords([]); } finally { setAttendanceLoading(false); }
  };
  const loadLeave = async () => {
    if (!selected) return;
    setLeaveLoading(true);
    try {
      const res = await fetchWithAuth(`/api/leave?employee=${encodeURIComponent(selected.name)}`, { cache: "no-store" });
      const data = await res.json();
      setLeaveRecords(Array.isArray(data) ? data : []);
    } catch { setLeaveRecords([]); } finally { setLeaveLoading(false); }
  };
  const loadPayslips = async () => {
    if (!selected) return;
    setPayslipLoading(true);
    try {
      const res = await fetchWithAuth("/api/payslips?month=all", { cache: "no-store" });
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setPayslipRecords(isAdmin ? list.filter((p: any) => p.employee_id === selected.id) : list);
    } catch { setPayslipRecords([]); } finally { setPayslipLoading(false); }
  };
  const switchTab = (tab: "info" | "attendance" | "leave" | "payslip") => {
    setActiveTab(tab);
    if (!selected) return;
    if (tab === "attendance" && attendanceRecords.length === 0) loadAttendance();
    if (tab === "leave" && leaveRecords.length === 0) loadLeave();
    if (tab === "payslip" && payslipRecords.length === 0) loadPayslips();
  };

  const payslipIncome = (p: any) => (Number(p.base_salary) || 0) + (Number(p.diligence_bonus) || 0) + (Number(p.skill_allowance) || 0) + (Number(p.bonus) || 0) + (Number(p.commission) || 0) + (Number(p.overtime) || 0) + (Number(p.merit_income) || 0);
  const payslipDeduct = (p: any) => (Number(p.social_security) || 0) + (Number(p.late_deduction) || 0) + (Number(p.personal_leave_deduction) || 0) + (Number(p.sick_leave_deduction) || 0) + (Number(p.absence_deduction) || 0) + (Number(p.demerit_deduction) || 0) + (Number(p.withholding_tax) || 0);

  const textField = (label: string, key: string, placeholder?: string, type = "text") => (
    <div className="space-y-1">
      <Label className="text-xs text-[var(--muted-foreground)]">{label}</Label>
      <Input type={type} value={form[key] ?? ""} onChange={(e) => setField(key, e.target.value)} placeholder={placeholder} className="h-9" />
    </div>
  );

  const readOnlyRow = (label: string, value?: string) => (
    <div className="flex justify-between gap-4 border-b border-[var(--border)] py-2 text-sm last:border-0">
      <span className="shrink-0 text-[var(--muted-foreground)]">{label}</span>
      <span className="text-right text-[var(--foreground)]">{value && value.trim() ? value : "—"}</span>
    </div>
  );

  const recordsList = () => {
    if (recordsLoading) return <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>;
    if (records.length === 0) return <p className="text-xs text-[var(--muted-foreground)]">暂无记录</p>;
    return (
      <ul className="space-y-2">
        {records.map((r) => (
          <li key={r.id} className="rounded-md border border-[var(--border)] px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", r.type === "demerit" ? "bg-red-500/15 text-red-600" : "bg-emerald-500/15 text-emerald-600")}>
                {r.type === "demerit" ? "扣分" : "记优点"}
              </span>
              <span className={cn("text-sm font-semibold tabular-nums", r.type === "demerit" ? "text-red-600" : "text-emerald-600")}>
                {r.type === "demerit" ? "-" : "+"}{r.points} 分
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--foreground)]">{r.content}</p>
            <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">{r.created_by} · {toThaiTime(r.created_at)}</p>
          </li>
        ))}
      </ul>
    );
  };

  const demeritsList = () => {
    if (demeritsLoading) return <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>;
    if (demerits.length === 0) return <p className="text-xs text-[var(--muted-foreground)]">暂无记过记录</p>;
    return (
      <ul className="space-y-2">
        {demerits.map((d) => (
          <li key={d.id} className="rounded-md border border-red-300/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full px-2 py-0.5 text-[0.65rem] font-medium bg-red-500/15 text-red-600">记过（严重处分）</span>
              <span className="text-[0.65rem] text-[var(--muted-foreground)]">{d.created_by} · {toThaiTime(d.created_at)}</span>
            </div>
            <p className="mt-1 text-sm text-[var(--foreground)]">{d.content}</p>
            {d.file_url && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <a href={fileUrl(d.file_url)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Eye className="size-3" />警告函</a>
                <a href={fileUrl(d.file_url)} download={d.original_name || "警告函"} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Download className="size-3" />下载</a>
                <span className="text-xs text-[var(--muted-foreground)]">{d.original_name}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const pendingInfoChanges = infoChanges.filter((c) => c.status === "待审核");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工档案</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "基本信息 · 工作信息 · 银行信息 · 紧急联系人 · 扣分记优点 · 记过" : "我的档案（只读）"}</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      {isAdmin ? (
        <div className="space-y-6">
          {/* 信息变更申请审核 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-medium">信息变更申请</h2>
              <span className="text-xs text-[var(--muted-foreground)]">待审核 {pendingInfoChanges.length} 条</span>
            </div>
            {infoChangesLoading ? (
              <p className="p-4 text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : pendingInfoChanges.length === 0 ? (
              <p className="p-4 text-xs text-[var(--muted-foreground)]">暂无待审核的变更申请</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {pendingInfoChanges.map((c) => (
                  <li key={c.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[var(--foreground)]">{c.employee_name}</span>
                      <span className="text-[0.65rem] text-[var(--muted-foreground)]">{c.created_at?.slice(0, 16)}</span>
                    </div>
                    <div className="mt-1 grid gap-x-6 gap-y-0.5 text-xs text-[var(--muted-foreground)] sm:grid-cols-2">
                      <span>电话：{c.phone}</span>
                      <span>住址：{c.address}</span>
                      <span className="sm:col-span-2">紧急联系人：{c.emergency_name}（{c.emergency_phone}）{c.emergency_relation ? ` · ${c.emergency_relation}` : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={() => approveChange(c.id)}>通过</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => { setRejectModal({ id: c.id, employee: c.employee_name }); setRejectReason(""); }}>驳回</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* 员工列表 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] space-y-2">
              <h2 className="text-sm font-medium">员工列表</h2>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] cursor-pointer">
                  <input type="checkbox" checked={allSelected} onChange={() => (allSelected ? clearSelect() : selectAllEmployees())} className="size-3.5 accent-[var(--primary)]" />
                  全选
                </label>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportSelected} disabled={exporting || selectedIds.size === 0}>导出选中{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</Button>
                <Button size="sm" className="h-7 text-xs" onClick={exportAll} disabled={exporting}>{exporting ? "导出中…" : "一键导出全部"}</Button>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <p className="p-4 text-xs text-[var(--muted-foreground)]">加载中…</p>
              ) : employees.length === 0 ? (
                <p className="p-4 text-xs text-[var(--muted-foreground)]">暂无员工</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {employees.map((e) => (
                    <li key={e.id}>
                      <div className={cn("flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--muted)]/40", selected?.id === e.id && "bg-[var(--muted)]/40")}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                          className="size-4 shrink-0 accent-[var(--primary)]"
                        />
                        <button onClick={() => selectEmp(e)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                            {e.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-[var(--foreground)]">{e.name}</span>
                            <span className="flex items-center gap-1.5 truncate text-xs text-[var(--muted-foreground)]">
                              {e.role === "admin" ? "管理员" : "员工"}
                              {e.status && e.status !== "在职" && (
                                <span className={cn("rounded-full px-1.5 py-0.5 text-[0.6rem] font-medium",
                                  e.status === "离职" ? "bg-red-500/15 text-red-600" :
                                  e.status === "试用期" ? "bg-blue-500/15 text-blue-600" :
                                  e.status === "待离职" ? "bg-orange-500/15 text-orange-600" :
                                  "bg-purple-500/15 text-purple-600")}>{e.status}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 档案详情（可编辑） */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium flex items-center gap-2"><IdCard className="size-4" />档案详情</h2>
            </div>
            <div className="p-5">
              {!selected ? (
                <p className="text-sm text-[var(--muted-foreground)]">请从左侧选择一个员工查看档案</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-xs text-[var(--muted-foreground)]">员工</Label>
                      <p className="mt-1 text-base font-medium text-[var(--foreground)]">{selected.name}</p>
                    </div>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium",
                      selected.status === "离职" ? "bg-red-500/15 text-red-600" :
                      selected.status === "试用期" ? "bg-blue-500/15 text-blue-600" :
                      selected.status === "待离职" ? "bg-orange-500/15 text-orange-600" :
                      selected.status === "停薪留职" ? "bg-purple-500/15 text-purple-600" :
                      "bg-emerald-500/15 text-emerald-600")}>
                      {selected.status || "在职"}
                    </span>
                  </div>

                  {/* 标签页：基本信息 / 考勤 / 请假 / 工资历史 */}
                  <div className="flex gap-1 border-b border-[var(--border)]">
                    {([["info", "基本信息"], ["attendance", "考勤"], ["leave", "请假"], ["payslip", "工资历史"]] as const).map(([key, label]) => (
                      <button key={key} onClick={() => switchTab(key)}
                        className={cn("px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
                          activeTab === key ? "border-[var(--primary)] text-[var(--foreground)] font-medium" : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeTab === "info" && (
                  <div className="space-y-6">

                  {/* 员工状态 + 离职流程 */}
                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">员工状态</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium",
                        selected.status === "离职" ? "bg-red-500/15 text-red-600" :
                        selected.status === "试用期" ? "bg-blue-500/15 text-blue-600" :
                        selected.status === "待离职" ? "bg-orange-500/15 text-orange-600" :
                        selected.status === "停薪留职" ? "bg-purple-500/15 text-purple-600" :
                        "bg-emerald-500/15 text-emerald-600")}>
                        当前状态：{selected.status || "在职"}
                      </span>
                      {selected.status !== "在职" && selected.status !== "离职" && (
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => changeStatus("在职")} disabled={statusUpdating}>恢复在职</Button>
                      )}
                      <span className="mx-1 text-[var(--border)]">|</span>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => changeStatus("试用期")} disabled={statusUpdating || selected.status === "试用期"}>标记试用期</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => changeStatus("待离职")} disabled={statusUpdating || selected.status === "待离职"}>标记待离职</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => changeStatus("停薪留职")} disabled={statusUpdating || selected.status === "停薪留职"}>标记停薪留职</Button>
                      <Button size="sm" className="h-8 text-xs" onClick={() => setShowResignForm(true)} disabled={selected.status === "离职"}>标记离职</Button>
                    </div>

                    {showResignForm && selected.status !== "离职" && (
                      <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 dark:bg-red-950/20">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs">离职日期 <span className="text-red-500">*</span></Label>
                            <Input type="date" value={resignDate} onChange={(e) => setResignDate(e.target.value)} className="mt-1 h-9" />
                          </div>
                          <div>
                            <Label className="text-xs">离职原因 <span className="text-red-500">*</span></Label>
                            <Input value={resignReason} onChange={(e) => setResignReason(e.target.value)} placeholder="必填，说明离职原因" className="mt-1 h-9" />
                          </div>
                        </div>
                        {resignErr && <p className="mt-1.5 text-xs text-red-500">{resignErr}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <Button size="sm" onClick={submitResign} disabled={resignSaving}>{resignSaving ? "提交中…" : "确认离职"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setShowResignForm(false)}>取消</Button>
                        </div>
                      </div>
                    )}

                    {selected.status === "离职" && (
                      <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm">
                        <p className="text-[var(--muted-foreground)]">离职日期：{selected.resignation_date || "—"}　|　离职原因：{selected.resignation_reason || "—"}</p>
                      </div>
                    )}
                  </section>

                  {/* 离职交接清单 */}
                  {(selected.status === "离职" || selected.status === "待离职") && (
                    <section className="border-t border-[var(--border)] pt-4">
                      <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">离职交接清单</h3>
                      {handoverLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                      ) : handover.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无交接事项</p>
                      ) : (
                        <ul className="space-y-2">
                          {handover.map((h) => (
                            <li key={h.id} className="flex items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2">
                              <input
                                type="checkbox"
                                checked={h.done === 1}
                                onChange={() => toggleHandover(h)}
                                className="size-4 shrink-0 accent-emerald-600"
                              />
                              <span className={cn("text-sm", h.done === 1 ? "text-[var(--muted-foreground)] line-through" : "text-[var(--foreground)]")}>{h.item}</span>
                              {h.done === 1 && <span className="ml-auto text-[0.65rem] text-emerald-600">已办完{h.updated_by ? ` · ${h.updated_by}` : ""}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">基本信息</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-[var(--muted-foreground)]">性别</Label>
                        <select value={form.gender ?? ""} onChange={(e) => setField("gender", e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                          <option value="">未填写</option>
                          <option value="男">男</option>
                          <option value="女">女</option>
                          <option value="其他">其他</option>
                        </select>
                      </div>
                      {textField("出生日期", "birth_date", undefined, "date")}
                      <div className="space-y-1">
                        <Label className="text-xs text-[var(--muted-foreground)]">星座（自动）</Label>
                        <p className="flex h-9 items-center text-sm text-[var(--foreground)]">{zodiacFromBirthDate(form.birth_date) || "—"}</p>
                      </div>
                      {textField("邮箱", "email", "邮箱地址")}
                      {textField("电话", "phone", "电话号码")}
                      {textField("身份证号", "id_number", "身份证号码")}
                      <div className="space-y-1 sm:col-span-2">
                        {textField("住址", "address", "居住地址")}
                      </div>
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">工作信息</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("部门", "department", "部门")}
                      {textField("职位", "position", "职位")}
                      {textField("合同期限", "contract_term", "如 2026-01-01 至 2026-12-31")}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">银行信息</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("开户银行", "bank_name", "开户银行")}
                      {textField("银行账号", "bank_account", "银行账号")}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">紧急联系人</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("姓名", "emergency_name", "紧急联系人姓名")}
                      {textField("电话", "emergency_phone", "紧急联系人电话")}
                      {textField("关系", "emergency_relation", "如 配偶 / 父母")}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">泰国合规</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("护照号", "passport_number", "护照号码")}
                      {textField("社保号", "social_security_number", "社保号码")}
                      {textField("税号", "tax_number", "税号")}
                      {textField("工作证号", "work_permit_number", "工作证号码")}
                      {textField("工作证到期日", "work_permit_expiry", undefined, "date")}
                      {textField("签证到期日", "visa_expiry", undefined, "date")}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">其他</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("技能", "skills", "技能")}
                      {textField("生辰八字", "bazi", "如 1995年6月15日 子时")}
                      {textField("算命", "fortune", "命理分析 / 算命结果")}
                      <div className="space-y-1 sm:col-span-2">
                        {textField("备注", "notes", "备注")}
                      </div>
                    </div>
                  </section>

                  {/* 教育履历 */}
                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">教育履历</h3>
                    <div className="mb-4 rounded-md border border-[var(--border)] p-3">
                      <div className="grid gap-2 sm:grid-cols-4">
                        <select value={eduForm.level} onChange={(e) => setEduForm((p) => ({ ...p, level: e.target.value }))} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                          {EDUCATION_LEVELS.map((lv) => <option key={lv} value={lv}>{lv}</option>)}
                        </select>
                        <Input value={eduForm.school} onChange={(e) => setEduForm((p) => ({ ...p, school: e.target.value }))} placeholder="学校名称" className="h-9" />
                        <Input value={eduForm.major} onChange={(e) => setEduForm((p) => ({ ...p, major: e.target.value }))} placeholder="专业" className="h-9" />
                        <Input value={eduForm.grad_year} onChange={(e) => setEduForm((p) => ({ ...p, grad_year: e.target.value }))} placeholder="毕业年份" className="h-9" />
                      </div>
                      {eduErr && <p className="mt-1.5 text-xs text-red-500">{eduErr}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" onClick={saveEducation} disabled={eduSaving}>{eduSaving ? "保存中…" : editingEduId != null ? "保存修改" : "添加"}</Button>
                        {editingEduId != null && <Button size="sm" variant="ghost" onClick={cancelEditEducation}>取消</Button>}
                      </div>
                    </div>

                    {educationsLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                    ) : educations.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">暂无学历记录</p>
                    ) : (
                      <ul className="space-y-2">
                        {educations.map((e) => (
                          <li key={e.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-sm font-medium text-[var(--foreground)]">{e.school}</span>
                                <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-[0.65rem] font-medium text-blue-600">{e.level}</span>
                                {e.major && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{e.major}</span>}
                                {e.grad_year && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{e.grad_year}届</span>}
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => startEditEducation(e)}>编辑</Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => removeEducation(e.id)}>删除</Button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
                    <Button size="sm" variant="outline" onClick={downloadPdf}><Download className="size-3.5" />导出 PDF</Button>
                    {savedMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{savedMsg}</span>}
                  </div>
                  {formErr && <p className="text-xs text-red-500">{formErr}</p>}

                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">扣分 / 记优点</h3>
                    <div className="mb-4 rounded-md border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={recordType} onChange={(e) => setRecordType(e.target.value as "demerit" | "merit")} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                          <option value="merit">记优点（加分）</option>
                          <option value="demerit">扣分（轻微过失）</option>
                        </select>
                        <Input type="number" min="1" step="1" value={recordPoints} onChange={(e) => setRecordPoints(e.target.value)} placeholder="分值" className="h-9 w-24" />
                        <Input value={recordContent} onChange={(e) => setRecordContent(e.target.value)} placeholder="内容（做了什么 / 犯了什么错）" className="h-9 min-w-[160px] flex-1" />
                        <Button size="sm" onClick={addRecord} disabled={recordSaving} className="h-9">{recordSaving ? "记录中…" : "记录"}</Button>
                      </div>
                      {recordErr && <p className="mt-1.5 text-xs text-red-500">{recordErr}</p>}
                      <p className="mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">一分 = 十泰铢（轻微过失扣分，与记过处分是两回事）</p>
                    </div>
                    {recordsList()}
                  </section>

                  {/* 记过（严重处分） */}
                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">记过（严重处分）<span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[0.65rem] text-red-600">已记过 {demeritCount} 次</span></h3>
                    {demeritCount >= 2 && selected.status !== "离职" && (
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 dark:bg-red-950/20">
                        <p className="text-xs text-red-700 dark:text-red-400">该员工已累计记过 {demeritCount} 次，可标记离职（需手动判决，系统不会自动离职）。</p>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-600" onClick={() => setShowResignForm(true)}>标记离职</Button>
                      </div>
                    )}
                    <div className="mb-4 rounded-md border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input value={demeritContent} onChange={(e) => setDemeritContent(e.target.value)} placeholder="记过内容（犯了什么严重错误）" className="h-9 min-w-[160px] flex-1" />
                        <input ref={demeritFileInputRef} type="file" className="h-9 min-w-[160px] flex-1 text-sm text-[var(--foreground)]" title="警告函文件" />
                        <Button size="sm" onClick={addDemerit} disabled={demeritSaving} className="h-9">{demeritSaving ? "记过中…" : "记过"}</Button>
                      </div>
                      {demeritErr && <p className="mt-1.5 text-xs text-red-500">{demeritErr}</p>}
                      <p className="mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">可上传警告函文件；记过两次后提醒管理员手动判决是否标记离职。</p>
                    </div>
                    {demeritsList()}
                  </section>

                  {/* 档案文件 */}
                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">档案文件</h3>
                    <div className="mb-4 rounded-md border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={fileCategory} onChange={(e) => setFileCategory(e.target.value)} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                          <option value="合同">合同</option>
                          <option value="错误承认书">错误承认书</option>
                          <option value="其他">其他</option>
                        </select>
                        <input ref={fileInputRef} type="file" className="h-9 min-w-[160px] flex-1 text-sm text-[var(--foreground)]" />
                        <Button size="sm" onClick={uploadFile} disabled={fileUploading} className="h-9">{fileUploading ? "上传中…" : "上传"}</Button>
                      </div>
                      {fileErr && <p className="mt-1.5 text-xs text-red-500">{fileErr}</p>}
                    </div>

                    {filesLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                    ) : files.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">暂无文件</p>
                    ) : (
                      <ul className="space-y-2">
                        {files.map((f) => (
                          <li key={f.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0">
                                <span className="mr-2 rounded-full px-2 py-0.5 text-[0.65rem] font-medium bg-[var(--muted)]/40 text-[var(--muted-foreground)]">{f.category}</span>
                                <span className="text-sm text-[var(--foreground)]">{f.original_name || f.filename}</span>
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <a href={fileUrl(f.url)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Eye className="size-3" />查看</a>
                                <a href={fileUrl(f.url)} download={f.original_name || f.filename} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Download className="size-3" />下载</a>
                                <Button size="sm" variant="outline" className="h-7 text-xs text-red-500" onClick={() => removeFile(f.id)}><Trash2 className="size-3" />删除</Button>
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  </div>
                  )}

                  {activeTab === "attendance" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[var(--muted-foreground)]">考勤记录</h3>
                        <span className="text-[0.65rem] text-[var(--muted-foreground)]">{attendanceRecords.length} 条</span>
                      </div>
                      {attendanceLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                      ) : attendanceRecords.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无考勤记录</p>
                      ) : (
                        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]">日期</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]">签到</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]">签退</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]">工时</th>
                                <th className="px-3 py-2 text-left text-xs font-medium text-[var(--muted-foreground)]">类型</th>
                              </tr>
                            </thead>
                            <tbody>
                              {attendanceRecords.map((a: any) => (
                                <tr key={a.id} className="border-b border-[var(--border)] last:border-0">
                                  <td className="px-3 py-2 text-[var(--foreground)]">{a.date}</td>
                                  <td className="px-3 py-2 text-[var(--foreground)]">{a.check_in ? toThaiTime(a.check_in).slice(11, 16) : "—"}</td>
                                  <td className="px-3 py-2 text-[var(--foreground)]">{a.check_out ? toThaiTime(a.check_out).slice(11, 16) : "—"}</td>
                                  <td className="px-3 py-2 tabular-nums text-[var(--foreground)]">{a.work_hours != null ? `${a.work_hours}h` : "—"}</td>
                                  <td className="px-3 py-2">
                                    <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                                      a.type === "请假" ? "bg-orange-500/15 text-orange-600" :
                                      a.type === "补签" ? "bg-blue-500/15 text-blue-600" :
                                      "bg-emerald-500/15 text-emerald-600")}>{a.type || "正常"}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "leave" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[var(--muted-foreground)]">请假记录</h3>
                        <span className="text-[0.65rem] text-[var(--muted-foreground)]">{leaveRecords.length} 条</span>
                      </div>
                      {leaveLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                      ) : leaveRecords.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无请假记录</p>
                      ) : (
                        <ul className="space-y-2">
                          {leaveRecords.map((l: any) => (
                            <li key={l.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-[var(--foreground)]">{l.leave_type}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                                  l.status === "已通过" ? "bg-emerald-500/15 text-emerald-600" :
                                  l.status === "已驳回" ? "bg-red-500/15 text-red-600" :
                                  "bg-orange-500/15 text-orange-600")}>{l.status}</span>
                              </div>
                              <p className="mt-1 text-sm text-[var(--foreground)]">{l.start_date} ~ {l.end_date}</p>
                              {l.reason && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{l.reason}</p>}
                              <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">{l.approved_by ? `审批人：${l.approved_by} · ` : ""}提交于 {toThaiTime(l.created_at)}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {activeTab === "payslip" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-semibold text-[var(--muted-foreground)]">工资单历史</h3>
                        <span className="text-[0.65rem] text-[var(--muted-foreground)]">{payslipRecords.length} 条</span>
                      </div>
                      {payslipLoading ? (
                        <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                      ) : payslipRecords.length === 0 ? (
                        <p className="text-xs text-[var(--muted-foreground)]">暂无工资单</p>
                      ) : (
                        <ul className="space-y-2">
                          {payslipRecords.map((p: any) => (
                            <li key={p.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-medium text-[var(--foreground)]">{p.month}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                                  p.status === "已发放" ? "bg-emerald-500/15 text-emerald-600" :
                                  p.status === "打回" ? "bg-red-500/15 text-red-600" :
                                  p.status === "已确认" ? "bg-blue-500/15 text-blue-600" :
                                  "bg-orange-500/15 text-orange-600")}>{p.status || "草稿"}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-xs">
                                <span className="text-[var(--muted-foreground)]">应发：<span className="text-emerald-600 tabular-nums">{payslipIncome(p).toFixed(2)}</span></span>
                                <span className="text-[var(--muted-foreground)]">扣款：<span className="text-red-500 tabular-nums">{payslipDeduct(p).toFixed(2)}</span></span>
                                <span className="text-[var(--muted-foreground)]">实发：<span className="font-medium text-[var(--foreground)] tabular-nums">{(payslipIncome(p) - payslipDeduct(p)).toFixed(2)}</span></span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      ) : (
        /* 员工端：只看自己的档案，只读 */
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2"><IdCard className="size-4" />我的档案</h2>
            <Button size="sm" variant="outline" onClick={downloadPdf} disabled={!selected}><Download className="size-3.5" />导出 PDF</Button>
          </div>
          <div className="p-5">
            {loading ? (
              <p className="text-sm text-[var(--muted-foreground)]">加载中…</p>
            ) : !selected ? (
              <p className="text-sm text-[var(--muted-foreground)]">暂无档案</p>
            ) : (
              <div className="space-y-6">
                <div>
                  <Label className="text-xs text-[var(--muted-foreground)]">员工</Label>
                  <p className="mt-1 text-base font-medium text-[var(--foreground)]">{selected.name}</p>
                </div>

                {/* 信息变更申请（员工自助） */}
                <section className="border-t border-[var(--border)] pt-4">
                  <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">信息变更申请</h3>
                  {!showChangeForm ? (
                    <Button size="sm" variant="outline" onClick={() => {
                      setChangeForm({
                        phone: selected.phone || "",
                        address: selected.address || "",
                        emergency_name: selected.emergency_name || "",
                        emergency_phone: selected.emergency_phone || "",
                        emergency_relation: selected.emergency_relation || "",
                      });
                      setChangeErr("");
                      setShowChangeForm(true);
                    }}>申请信息变更（电话 / 地址 / 紧急联系人）</Button>
                  ) : (
                    <div className="rounded-md border border-[var(--border)] p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">新电话 <span className="text-red-500">*</span></Label>
                          <Input value={changeForm.phone} onChange={(e) => setChangeForm((p) => ({ ...p, phone: e.target.value }))} className="mt-1 h-9" />
                        </div>
                        <div>
                          <Label className="text-xs">新住址 <span className="text-red-500">*</span></Label>
                          <Input value={changeForm.address} onChange={(e) => setChangeForm((p) => ({ ...p, address: e.target.value }))} className="mt-1 h-9" />
                        </div>
                        <div>
                          <Label className="text-xs">紧急联系人姓名 <span className="text-red-500">*</span></Label>
                          <Input value={changeForm.emergency_name} onChange={(e) => setChangeForm((p) => ({ ...p, emergency_name: e.target.value }))} className="mt-1 h-9" />
                        </div>
                        <div>
                          <Label className="text-xs">紧急联系人电话 <span className="text-red-500">*</span></Label>
                          <Input value={changeForm.emergency_phone} onChange={(e) => setChangeForm((p) => ({ ...p, emergency_phone: e.target.value }))} className="mt-1 h-9" />
                        </div>
                        <div>
                          <Label className="text-xs">紧急联系人关系</Label>
                          <Input value={changeForm.emergency_relation} onChange={(e) => setChangeForm((p) => ({ ...p, emergency_relation: e.target.value }))} className="mt-1 h-9" />
                        </div>
                      </div>
                      {changeErr && <p className="mt-1.5 text-xs text-red-500">{changeErr}</p>}
                      <div className="mt-2 flex items-center gap-2">
                        <Button size="sm" onClick={submitInfoChange} disabled={changeSaving}>{changeSaving ? "提交中…" : "提交申请"}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowChangeForm(false)}>取消</Button>
                      </div>
                      <p className="mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">提交后需管理员审核，通过后新信息才生效；驳回则信息不变。</p>
                    </div>
                  )}

                  <div className="mt-3">
                    {infoChangesLoading ? (
                      <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                    ) : infoChanges.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">暂无申请记录</p>
                    ) : (
                      <ul className="space-y-2">
                        {infoChanges.map((c) => (
                          <li key={c.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                                c.status === "已通过" ? "bg-emerald-500/15 text-emerald-600" :
                                c.status === "已驳回" ? "bg-red-500/15 text-red-600" :
                                "bg-orange-500/15 text-orange-600")}>{c.status}</span>
                              <span className="text-[0.65rem] text-[var(--muted-foreground)]">{c.created_at?.slice(0, 16)}</span>
                            </div>
                            <div className="mt-1 grid gap-x-4 gap-y-0.5 text-xs text-[var(--muted-foreground)] sm:grid-cols-2">
                              <span>电话：{c.phone}</span>
                              <span>住址：{c.address}</span>
                              <span className="sm:col-span-2">紧急联系人：{c.emergency_name}（{c.emergency_phone}）{c.emergency_relation ? ` · ${c.emergency_relation}` : ""}</span>
                            </div>
                            {c.status === "已驳回" && c.reject_reason && (
                              <p className="mt-1 text-xs text-red-500">驳回原因：{c.reject_reason}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">基本信息</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("性别", selected.gender)}
                    {readOnlyRow("出生日期", selected.birth_date)}
                    {readOnlyRow("星座", zodiacFromBirthDate(selected.birth_date))}
                    {readOnlyRow("电话", selected.phone)}
                    {readOnlyRow("住址", selected.address)}
                    {readOnlyRow("身份证号", selected.id_number)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">工作信息</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("部门", selected.department)}
                    {readOnlyRow("职位", selected.position)}
                    {readOnlyRow("合同期限", selected.contract_term)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">银行信息</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("开户银行", selected.bank_name)}
                    {readOnlyRow("银行账号", selected.bank_account)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">紧急联系人</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("姓名", selected.emergency_name)}
                    {readOnlyRow("电话", selected.emergency_phone)}
                    {readOnlyRow("关系", selected.emergency_relation)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">泰国合规</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("护照号", selected.passport_number)}
                    {readOnlyRow("社保号", selected.social_security_number)}
                    {readOnlyRow("税号", selected.tax_number)}
                    {readOnlyRow("工作证号", selected.work_permit_number)}
                    {readOnlyRow("工作证到期日", selected.work_permit_expiry)}
                    {readOnlyRow("签证到期日", selected.visa_expiry)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">其他</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("技能", selected.skills)}
                    {readOnlyRow("生辰八字", selected.bazi)}
                    {readOnlyRow("算命", selected.fortune)}
                    {readOnlyRow("备注", selected.notes)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">教育履历</h3>
                  {educationsLoading ? (
                    <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                  ) : educations.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">暂无学历记录</p>
                  ) : (
                    <ul className="space-y-2">
                      {educations.map((e) => (
                        <li key={e.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[var(--foreground)]">{e.school}</span>
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[0.65rem] font-medium text-blue-600">{e.level}</span>
                            {e.major && <span className="text-xs text-[var(--muted-foreground)]">{e.major}</span>}
                            {e.grad_year && <span className="text-xs text-[var(--muted-foreground)]">{e.grad_year}届</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">扣分 / 记优点</h3>
                  {recordsList()}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">记过（严重处分）<span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[0.65rem] text-red-600">已记过 {demeritCount} 次</span></h3>
                  {demeritsList()}
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">档案文件</h3>
                  {filesLoading ? (
                    <p className="text-xs text-[var(--muted-foreground)]">加载中…</p>
                  ) : files.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)]">暂无文件</p>
                  ) : (
                    <ul className="space-y-2">
                      {files.map((f) => (
                        <li key={f.id} className="rounded-md border border-[var(--border)] px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0">
                              <span className="mr-2 rounded-full px-2 py-0.5 text-[0.65rem] font-medium bg-[var(--muted)]/40 text-[var(--muted-foreground)]">{f.category}</span>
                              <span className="text-sm text-[var(--foreground)]">{f.original_name || f.filename}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <a href={fileUrl(f.url)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Eye className="size-3" />查看</a>
                              <a href={fileUrl(f.url)} download={f.original_name || f.filename} className="inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 text-xs text-[var(--foreground)] hover:bg-[var(--muted)]"><Download className="size-3" />下载</a>
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
            <h3 className="text-sm font-medium">驳回变更申请 — {rejectModal.employee}</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="请填写驳回原因"
              className="mt-3 h-24 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRejectModal(null)}>取消</Button>
              <Button size="sm" onClick={confirmReject} disabled={rejecting}>{rejecting ? "驳回中…" : "确认驳回"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
