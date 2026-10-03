"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWithAuth, updateEmployee, fetchEmployeeRecords, createEmployeeRecord, type EmployeeRecord } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { ArrowLeft, IdCard } from "lucide-react";

interface ProfileEmployee {
  id: number;
  name: string;
  email?: string;
  role?: string;
  status?: string;
  [key: string]: any;
}

const FORM_FIELDS = [
  "gender", "birth_date", "phone", "address", "id_number",
  "department", "position", "contract_term",
  "bank_name", "bank_account",
  "emergency_name", "emergency_phone", "emergency_relation",
  "education", "skills", "notes", "bazi", "fortune",
] as const;

// 出生日期（YYYY-MM-DD）对应的西方星座，自动算
function zodiacFromBirthDate(birthDate: string): string {
  const m = (birthDate || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const month = Number(m[1]);
  const day = Number(m[2]);
  const boundaries: [number, number, string][] = [
    [1, 20, "水瓶座"], [2, 19, "双鱼座"], [3, 21, "白羊座"], [4, 20, "金牛座"],
    [5, 21, "双子座"], [6, 21, "巨蟹座"], [7, 23, "狮子座"], [8, 23, "处女座"],
    [9, 23, "天秤座"], [10, 23, "天蝎座"], [11, 22, "射手座"], [12, 22, "摩羯座"],
  ];
  let zodiac = "摩羯座";
  for (const [bm, bd, name] of boundaries) {
    if (month > bm || (month === bm && day >= bd)) zodiac = name;
  }
  return zodiac;
}

export default function EmployeeProfilesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [employees, setEmployees] = useState<ProfileEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProfileEmployee | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  // 记过/记优点
  const [records, setRecords] = useState<EmployeeRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordType, setRecordType] = useState<"demerit" | "merit">("merit");
  const [recordPoints, setRecordPoints] = useState("");
  const [recordContent, setRecordContent] = useState("");
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordErr, setRecordErr] = useState("");

  const selectEmp = (e: ProfileEmployee) => {
    setSelected(e);
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
  };

  useEffect(() => {
    setLoading(true);
    const url = isAdmin ? "/api/employees" : "/api/employees?self=1";
    fetchWithAuth(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d.filter((e: any) => e.role !== "client") : [];
        setEmployees(list);
        if (!isAdmin && list.length > 0) selectEmp(list[0]);
      })
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const setField = (k: string, v: string) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setSavedMsg("");
    try {
      const emp = await updateEmployee(selected.id, form);
      setSelected({ ...selected, ...emp });
      setEmployees((prev) => prev.map((x) => (x.id === emp.id ? { ...x, ...emp } : x)));
      setSavedMsg("已保存");
      setTimeout(() => setSavedMsg((m) => (m === "已保存" ? "" : m)), 1500);
    } catch {
      alert("保存失败");
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
                {r.type === "demerit" ? "记过" : "记优点"}
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工档案</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "基本信息 · 工作信息 · 银行信息 · 紧急联系人 · 记过记优点" : "我的档案（只读）"}</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

      {isAdmin ? (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* 员工列表 */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h2 className="text-sm font-medium">员工列表</h2>
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
                      <button
                        onClick={() => selectEmp(e)}
                        className={cn(
                          "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-[var(--muted)]/40",
                          selected?.id === e.id && "bg-[var(--muted)]/40"
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                          {e.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--foreground)]">{e.name}</span>
                          <span className="block truncate text-xs text-[var(--muted-foreground)]">{e.role === "admin" ? "管理员" : "员工"}</span>
                        </span>
                      </button>
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
                <div className="space-y-6">
                  <div>
                    <Label className="text-xs text-[var(--muted-foreground)]">员工</Label>
                    <p className="mt-1 text-base font-medium text-[var(--foreground)]">{selected.name}</p>
                  </div>

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
                      {textField("电话", "phone", "电话号码")}
                      {textField("身份证号 / 护照号", "id_number", "证件号码")}
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
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">其他</h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {textField("学历", "education", "学历")}
                      {textField("技能", "skills", "技能")}
                      {textField("生辰八字", "bazi", "如 1995年6月15日 子时")}
                      {textField("算命", "fortune", "命理分析 / 算命结果")}
                      <div className="space-y-1 sm:col-span-2">
                        {textField("备注", "notes", "备注")}
                      </div>
                    </div>
                  </section>

                  <div className="flex items-center gap-3">
                    <Button size="sm" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
                    {savedMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{savedMsg}</span>}
                  </div>

                  <section className="border-t border-[var(--border)] pt-4">
                    <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">记过 / 记优点</h3>
                    <div className="mb-4 rounded-md border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={recordType} onChange={(e) => setRecordType(e.target.value as "demerit" | "merit")} className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                          <option value="merit">记优点（加分）</option>
                          <option value="demerit">记过（扣分）</option>
                        </select>
                        <Input type="number" min="1" step="1" value={recordPoints} onChange={(e) => setRecordPoints(e.target.value)} placeholder="分值" className="h-9 w-24" />
                        <Input value={recordContent} onChange={(e) => setRecordContent(e.target.value)} placeholder="内容（做了什么 / 犯了什么错）" className="h-9 min-w-[160px] flex-1" />
                        <Button size="sm" onClick={addRecord} disabled={recordSaving} className="h-9">{recordSaving ? "记录中…" : "记录"}</Button>
                      </div>
                      {recordErr && <p className="mt-1.5 text-xs text-red-500">{recordErr}</p>}
                      <p className="mt-1.5 text-[0.65rem] text-[var(--muted-foreground)]">一分 = 十泰铢</p>
                    </div>
                    {recordsList()}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* 员工端：只看自己的档案，只读 */
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-medium flex items-center gap-2"><IdCard className="size-4" />我的档案</h2>
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

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">基本信息</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("性别", selected.gender)}
                    {readOnlyRow("出生日期", selected.birth_date)}
                    {readOnlyRow("星座", zodiacFromBirthDate(selected.birth_date))}
                    {readOnlyRow("电话", selected.phone)}
                    {readOnlyRow("住址", selected.address)}
                    {readOnlyRow("身份证号 / 护照号", selected.id_number)}
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
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">其他</h3>
                  <div className="rounded-md border border-[var(--border)] px-3">
                    {readOnlyRow("学历", selected.education)}
                    {readOnlyRow("技能", selected.skills)}
                    {readOnlyRow("生辰八字", selected.bazi)}
                    {readOnlyRow("算命", selected.fortune)}
                    {readOnlyRow("备注", selected.notes)}
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-xs font-semibold text-[var(--muted-foreground)]">记过 / 记优点</h3>
                  {recordsList()}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
