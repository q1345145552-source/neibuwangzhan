"use client";

import { useState, useEffect } from "react";
import { fetchMedicalProof, saveMedicalProof, refuseMedicalProof, reviewMedicalProof, type MedicalProof } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const PHOTO_SLOTS: [string, string, string][] = [
  ["photo1", "第一张：医疗证明或就诊单", "三天以上要完整假条，一到两天要门诊挂号单"],
  ["photo2", "第二张：处方药袋", "药袋上要有员工姓名、就诊日期、药名、医院名"],
  ["photo3", "第三张：门诊档案袋或挂号卡", ""],
  ["photo4", "第四张：付款收据", "要有金额、收费日期、财务章"],
];

export function MedicalProofModal({ leaveId, onClose, onSaved }: { leaveId: number; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [form, setForm] = useState({ institution: "", doctor: "", cert_number: "", issue_date: "", sick_days: "" });
  const [photos, setPhotos] = useState<{ photo1?: File; photo2?: File; photo3?: File; photo4?: File }>({});
  const [existing, setExisting] = useState<MedicalProof | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [needAuth, setNeedAuth] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [reviewStatus, setReviewStatus] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const r = await fetchMedicalProof(leaveId);
        if (!active) return;
        if (r) {
          setNeedAuth(!!r.need_authorization);
          if (r.institution) {
            setExisting(r);
            setForm({ institution: r.institution, doctor: r.doctor, cert_number: r.cert_number, issue_date: r.issue_date, sick_days: String(r.sick_days || "") });
            setReviewStatus(r.review_status || "");
            setReviewReason(r.review_reason || "");
          }
        }
      } catch {}
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [leaveId]);

  const setPhoto = (key: "photo1" | "photo2" | "photo3" | "photo4", file: File | undefined) => {
    setPhotos((prev) => ({ ...prev, [key]: file }));
  };

  const submit = async () => {
    const f = form;
    if (!f.institution.trim()) { setErr("请填写医疗机构名称"); return; }
    if (!f.doctor.trim()) { setErr("请填写医师姓名及执照号"); return; }
    if (!f.cert_number.trim()) { setErr("请填写医疗证明编号"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.issue_date)) { setErr("请填写开具日期（YYYY-MM-DD）"); return; }
    const days = Number(f.sick_days);
    if (!Number.isInteger(days) || days <= 0) { setErr("请填写病假天数（正整数）"); return; }
    if (needAuth && !agreed) { setErr("本年度病假已累计 3 次及以上，需先勾选同意授权才能提交"); return; }
    if (!photos.photo1 || !photos.photo2 || !photos.photo3 || !photos.photo4) {
      setErr("四张照片缺一不可，请上传完整"); return;
    }
    setSaving(true);
    setErr("");
    try {
      const r = await saveMedicalProof(leaveId, {
        institution: f.institution.trim(),
        doctor: f.doctor.trim(),
        cert_number: f.cert_number.trim(),
        issue_date: f.issue_date.trim(),
        sick_days: days,
        agreed,
      }, {
        photo1: photos.photo1!,
        photo2: photos.photo2!,
        photo3: photos.photo3!,
        photo4: photos.photo4!,
      });
      setExisting(r);
      setMsg("已保存");
      setPhotos({});
      setTimeout(() => setMsg((m) => (m === "已保存" ? "" : m)), 1500);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  };

  const refuse = async () => {
    setSaving(true);
    setErr("");
    try {
      const r = await refuseMedicalProof(leaveId);
      setExisting(r);
      setMsg("已记录拒绝授权");
      setTimeout(() => setMsg((m) => (m === "已记录拒绝授权" ? "" : m)), 1500);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSaving(false);
    }
  };

  const submitReview = async () => {
    if (!reviewStatus) { setErr("请选择核查状态"); return; }
    if (reviewStatus === "不通过" && !reviewReason) { setErr("请选择不通过原因"); return; }
    setReviewSaving(true);
    setErr("");
    try {
      const r = await reviewMedicalProof(leaveId, reviewStatus, reviewStatus === "不通过" ? reviewReason : undefined);
      setExisting(r);
      setReviewStatus(r.review_status || "");
      setReviewReason(r.review_reason || "");
      setMsg("核查已保存");
      setTimeout(() => setMsg((m) => (m === "核查已保存" ? "" : m)), 1500);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "核查失败");
    } finally {
      setReviewSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-[var(--foreground)]">补交医疗证明（四合一）</p>
          <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted-foreground)] text-center py-8">加载中…</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">医疗机构名称 <span className="text-red-500">*</span></label>
                <input value={form.institution} onChange={(e) => setForm((p) => ({ ...p, institution: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 曼谷医院" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">医师姓名及执照号 <span className="text-red-500">*</span></label>
                <input value={form.doctor} onChange={(e) => setForm((p) => ({ ...p, doctor: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 张三 医执字第123号" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">医疗证明编号 <span className="text-red-500">*</span></label>
                <input value={form.cert_number} onChange={(e) => setForm((p) => ({ ...p, cert_number: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="证明编号" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">开具日期 <span className="text-red-500">*</span></label>
                <input type="date" value={form.issue_date} onChange={(e) => setForm((p) => ({ ...p, issue_date: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
              <div>
                <label className="text-xs text-[var(--muted-foreground)]">病假天数 <span className="text-red-500">*</span></label>
                <input type="number" min="1" step="1" value={form.sick_days} onChange={(e) => setForm((p) => ({ ...p, sick_days: e.target.value }))} className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" placeholder="如 2" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {PHOTO_SLOTS.map(([key, label, hint]) => {
                const file = photos[key as "photo1"];
                const existingUrl = existing ? (existing as any)[`${key}_url`] : "";
                return (
                  <div key={key} className="rounded-md border border-[var(--border)] p-2.5">
                    <p className="text-xs font-medium text-[var(--foreground)]">{label} <span className="text-red-500">*</span></p>
                    {hint && <p className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{hint}</p>}
                    <label className="mt-2 flex h-9 cursor-pointer items-center justify-center rounded border border-dashed border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:border-[var(--ring)]">
                      {file ? file.name : existingUrl ? "已上传（点击替换）" : "点击上传"}
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; setPhoto(key as "photo1", f); e.target.value = ""; }} />
                    </label>
                    {existingUrl && !file && (
                      <a href={fileUrl(existingUrl)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-blue-600 hover:underline">查看已上传</a>
                    )}
                  </div>
                );
              })}
            </div>

            {needAuth && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
                <p className="text-xs font-medium text-[var(--foreground)]">授权书（本年度病假累计 3 次及以上，需签署）</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                  本人同意授权公司就本次病假所提交的医疗证明，联系相关医疗机构核实该证明的真实性。本授权仅限核查本次医疗证明，不查询、不获取本人其他历史病史及就诊记录，符合泰国隐私法（PDPA）相关规定。
                </p>
                <label className="mt-2 flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-3.5 accent-[var(--primary)]" />
                  <span className="text-xs text-[var(--foreground)]">我同意授权公司核查我的医疗证明真伪</span>
                </label>
                {existing?.authorization && (
                  <p className="mt-1.5 text-xs font-medium text-[var(--foreground)]">授权状态：{existing.authorization}</p>
                )}
              </div>
            )}

            {isAdmin && existing && (
              <div className="rounded-md border border-[var(--border)] p-3">
                <p className="text-xs font-medium text-[var(--foreground)]">管理员核查</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--muted-foreground)]">当前状态：</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                    existing.review_status === "不通过" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" :
                    existing.review_status === "已通过" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" :
                    existing.review_status === "核查中" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" :
                    existing.review_status === "拒绝授权" ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" :
                    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300")}>{existing.review_status || "待核查"}</span>
                  {existing.review_reason && <span className="text-xs text-red-600 dark:text-red-400">原因：{existing.review_reason}</span>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className="h-8 rounded border border-[var(--border)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                    <option value="">选择核查状态</option>
                    <option value="核查中">核查中</option>
                    <option value="已通过">已通过</option>
                    <option value="不通过">不通过</option>
                  </select>
                  {reviewStatus === "不通过" && (
                    <select value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} className="h-8 rounded border border-[var(--border)] px-2 text-xs outline-none focus:border-[var(--ring)]">
                      <option value="">选择不通过原因</option>
                      <option value="证明信息对不上">证明信息对不上</option>
                      <option value="伪造假条假证明">伪造假条假证明</option>
                      <option value="拒绝配合核查">拒绝配合核查</option>
                    </select>
                  )}
                  <Button size="sm" onClick={submitReview} disabled={reviewSaving}>{reviewSaving ? "保存中…" : "保存核查"}</Button>
                </div>
              </div>
            )}

            {err && <p className="text-xs text-red-500">{err}</p>}
            {msg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{msg}</p>}

            <div className="flex justify-end gap-2 pt-1">
              {needAuth && <Button variant="outline" size="sm" className="text-red-500" onClick={refuse} disabled={saving}>拒绝授权</Button>}
              <Button variant="outline" size="sm" onClick={onClose}>关闭</Button>
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "提交中…" : "保存"}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
