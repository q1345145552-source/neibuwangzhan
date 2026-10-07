"use client";

import { useState, useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, Loader2 } from "lucide-react";
import { MedicalProofModal } from "./medical-proof-modal";

interface LeaveRecord {
  id: number;
  employee_name: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  destination: string;
  reason: string;
  status: string;
  created_at: string;
}

export function LeaveSubmitTab() {
  const { user } = useAuth();
  const [annualBalance, setAnnualBalance] = useState<{ total: number; used: number; remaining: number } | null>(null);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leave_type: "事假", start_date: "", end_date: "", start_time: "09:00", end_time: "17:00", destination: "", reason: "" });
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [proofLeaveId, setProofLeaveId] = useState<number | null>(null);
  const [supplementLeaveId, setSupplementLeaveId] = useState<number | null>(null);
  const [supplementUploading, setSupplementUploading] = useState(false);
  const supplementInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user?.name) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/leave?employee=${encodeURIComponent(user.name)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setLeaves(Array.isArray(data) ? data : []);
      }
    } catch {}
    try {
      const res = await fetchWithAuth(`/api/leave/annual-balance?employee=${encodeURIComponent(user.name)}`, { cache: "no-store" });
      if (res.ok) setAnnualBalance(await res.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.name]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.append("file", files[i]);
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
    setImages((prev) => [...prev, ...uploaded]);
    setUploading(false);
    e.target.value = "";
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // 补传附件：给已提交的请假追加图片
  const handleSupplementImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || supplementLeaveId === null) return;
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append("file", files[i]);
    }
    setSupplementUploading(true);
    try {
      const uploadRes = await fetchWithAuth("/api/upload", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();
      const newFilename = (uploadData.url || uploadData.filename || "").replace(/^\/api\/files\//, "");
      const patchRes = await fetchWithAuth("/api/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: supplementLeaveId, append_images: [newFilename] }),
      });
      if (!patchRes.ok) throw new Error("补传失败");
      load();
    } catch (err) {
      console.error("[请假] 补传附件失败", err);
      alert("补传附件失败");
    } finally {
      setSupplementUploading(false);
      setSupplementLeaveId(null);
      e.target.value = "";
    }
  };

  // ── 表单校验衍生值 ──
  const sevenDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  })();
  const dateTooOld = (() => {
    if (!form.start_date && !form.end_date) return false;
    const limit = new Date(sevenDaysAgo + "T00:00:00+07:00");
    if (form.start_date && new Date(form.start_date + "T00:00:00+07:00") < limit) return true;
    if (form.end_date && new Date(form.end_date + "T00:00:00+07:00") < limit) return true;
    return false;
  })();
  const reasonLen = form.reason.trim().length;
  const reasonTooShort = reasonLen < 10;
  const needDestination = form.leave_type === "事假" && !form.destination.trim();
  const canSubmit = form.start_date && form.end_date && !reasonTooShort && !needDestination && !dateTooOld;

  const handleSubmit = async () => {
    if (!form.start_date || !form.end_date) { setErr("请选择日期"); return; }
    if (reasonTooShort) { setErr(`事由至少10个字，当前${reasonLen}字`); return; }
    if (needDestination) { setErr("事假必须填写目的地"); return; }
    if (dateTooOld) { setErr("不能申请超过七天前的日期"); return; }
    setErr("");
    setSaving(true);
    try {
      const res = await fetchWithAuth("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, employee_name: user?.name, images: images.map((url) => url.replace("/api/files/", "")) }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setErr(errData.error || "提交失败，请重试");
        return;
      }
      const newRecord = await res.json();
      setLeaves((prev) => [newRecord, ...prev]);
      setShowForm(false);
      setForm({ leave_type: "事假", start_date: "", end_date: "", start_time: "09:00", end_time: "17:00", destination: "", reason: "" });
      setImages([]);
      if (newRecord.leave_type === "年假" && user?.name) {
        fetchWithAuth(`/api/leave/annual-balance?employee=${encodeURIComponent(user.name)}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d) setAnnualBalance(d); })
          .catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络错误";
      setErr(msg === "NO_TOKEN" ? "登录已过期，请刷新页面重新登录" : "提交失败，请检查网络后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 年假余额 + 申请按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {annualBalance ? (
            <p className="text-sm text-[var(--foreground)]">
              年假额度：<span className="font-medium">总额 {annualBalance.total} 天</span> · 已用 <span className="font-medium">{annualBalance.used} 天</span> · 剩余{" "}
              <span className={cn("font-semibold", annualBalance.remaining <= 0 ? "text-red-500" : "text-emerald-600 dark:text-emerald-400")}>{annualBalance.remaining} 天</span>
              {annualBalance.total === 0 && <span className="ml-1 text-[var(--muted-foreground)]">（工龄满一年后每年 6 天，当年未用不结转）</span>}
            </p>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">年假额度加载中…</p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="gap-1"><Plus className="size-3.5" />申请请假</Button>
      </div>

      {/* 提交请假表单 */}
      {showForm && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs font-medium">请假类型</label>
              <select value={form.leave_type} onChange={(e) => setForm((p) => ({ ...p, leave_type: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                <option value="事假">事假</option><option value="病假">病假</option><option value="年假">年假</option><option value="调休">调休</option><option value="法定假日">法定假日</option><option value="其他">其他</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">开始日期</label>
              <input type="date" value={form.start_date} min={sevenDaysAgo} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))}
                className={cn("mt-1 w-full h-9 rounded border px-3 text-sm outline-none focus:border-[var(--ring)]", dateTooOld ? "border-red-400 bg-red-50" : "border-[var(--border)]")} />
            </div>
            <div>
              <label className="text-xs font-medium">结束日期</label>
              <input type="date" value={form.end_date} min={sevenDaysAgo} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))}
                className={cn("mt-1 w-full h-9 rounded border px-3 text-sm outline-none focus:border-[var(--ring)]", dateTooOld ? "border-red-400 bg-red-50" : "border-[var(--border)]")} />
            </div>
            <div>
              <label className="text-xs font-medium">开始时间</label>
              <input type="time" value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">结束时间</label>
              <input type="time" value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm" />
            </div>
            {dateTooOld && (
              <div className="sm:col-span-3">
                <p className="text-xs text-red-500">不能申请超过七天前的日期，最早可申请 {sevenDaysAgo}</p>
              </div>
            )}
            <div>
              <label className="text-xs font-medium">目的地 {form.leave_type === "事假" ? <span className="text-red-500">*必填</span> : <span className="text-[var(--muted-foreground)]">(选填)</span>}</label>
              <input value={form.destination} onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))}
                placeholder={form.leave_type === "事假" ? "事假必填目的地" : "目的地（选填）"}
                className={cn("mt-1 w-full h-9 rounded border px-3 text-sm outline-none focus:border-[var(--ring)]", needDestination ? "border-red-400 bg-red-50" : "border-[var(--border)]")} />
              {needDestination && <p className="mt-0.5 text-xs text-red-500">事假必须填写目的地</p>}
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium">
                事由 <span className={cn(reasonLen < 10 ? "text-red-500" : "text-[var(--muted-foreground)]")}>({reasonLen}/10字{reasonLen < 10 ? `，还差${10 - reasonLen}字` : ""})</span>
              </label>
              <input value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} placeholder="请假原因，至少填写10个字..."
                className={cn("mt-1 w-full h-9 rounded border px-3 text-sm outline-none focus:border-[var(--ring)]", reasonLen > 0 && reasonTooShort ? "border-orange-400" : "border-[var(--border)]")} />
              {reasonTooShort && <p className="mt-0.5 text-xs text-orange-500">事由至少10个字，当前{reasonLen}字，还差{10 - reasonLen}字</p>}
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs font-medium">附件上传（选填）</label>
            <div className="mt-1 flex flex-wrap gap-2 items-center">
              {images.map((img, idx) => (
                <div key={idx} className="relative group w-16 h-16 rounded border border-[var(--border)] overflow-hidden bg-[var(--muted)] shrink-0">
                  <img src={fileUrl(img)} alt="" className="w-full h-full object-cover" />
                  <button onClick={() => removeImage(idx)} className="absolute -top-1 -right-1 size-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><X className="size-3" /></button>
                </div>
              ))}
              <label className="w-16 h-16 rounded border-2 border-dashed border-[var(--border)] hover:border-[var(--ring)] flex items-center justify-center cursor-pointer transition-colors shrink-0">
                {uploading ? <Loader2 className="size-5 animate-spin text-[var(--muted-foreground)]" /> : <Plus className="size-5 text-[var(--muted-foreground)]" />}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} disabled={uploading} />
              </label>
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">支持 jpg/png/webp，每张不超过 10MB</p>
          </div>

          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || saving}>{saving ? "提交中…" : "提交申请"}</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>取消</Button>
          </div>
        </div>
      )}

      {/* 我的请假记录 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">我的请假记录</h2>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
        ) : leaves.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无请假记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted-foreground)]">
                  <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">日期</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">目的地</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">原因</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">状态</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">提交时间</th>
                </tr>
              </thead>
              <tbody>
                {leaves.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2.5 px-4">
                      {l.leave_type}
                      {l.leave_type === "病假" && (
                        <button onClick={() => setProofLeaveId(l.id)} className="ml-2 text-xs text-blue-600 hover:underline">补交凭证</button>
                      )}
                      <button
                        onClick={() => { setSupplementLeaveId(l.id); setTimeout(() => supplementInputRef.current?.click(), 50); }}
                        disabled={supplementUploading}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                      >
                        {supplementUploading && supplementLeaveId === l.id ? <Loader2 className="size-3 animate-spin" /> : "补传附件"}
                      </button>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{l.start_date || "—"} {l.start_time || "09:00"} ~ {l.end_date || "—"} {l.end_time || "17:00"}</td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)] max-w-[100px] truncate">{l.destination || "—"}</td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)] max-w-[150px] truncate">{l.reason || "—"}</td>
                    <td className="py-2.5 px-4">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", l.status === "已通过" ? "bg-green-100 text-green-700" : l.status === "已驳回" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>{l.status}</span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-[var(--muted-foreground)]">{toThaiTime(l.created_at) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {leaves.map((l) => (
                <div key={l.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {l.leave_type}
                      {l.leave_type === "病假" && (
                        <button onClick={() => setProofLeaveId(l.id)} className="ml-2 text-xs text-blue-600 hover:underline">补交凭证</button>
                      )}
                      <button
                        onClick={() => { setSupplementLeaveId(l.id); setTimeout(() => supplementInputRef.current?.click(), 50); }}
                        disabled={supplementUploading}
                        className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                      >
                        {supplementUploading && supplementLeaveId === l.id ? <Loader2 className="size-3 animate-spin" /> : "补传附件"}
                      </button>
                    </span>
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", l.status === "已通过" ? "bg-green-100 text-green-700" : l.status === "已驳回" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700")}>{l.status}</span>
                  </div>
                  <div className="mt-2 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">日期</span><span className="text-xs">{l.start_date || "—"} {l.start_time || "09:00"} ~ {l.end_date || "—"} {l.end_time || "17:00"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">目的地</span><span>{l.destination || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">原因</span><span className="min-w-0 break-words text-right">{l.reason || "—"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 补传附件的隐藏文件输入 */}
      <input ref={supplementInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleSupplementImage} />

      {proofLeaveId != null && (
        <MedicalProofModal leaveId={proofLeaveId} onClose={() => setProofLeaveId(null)} onSaved={() => load()} />
      )}
    </div>
  );
}
