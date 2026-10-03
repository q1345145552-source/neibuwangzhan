"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchWithAuth, updateEmployee } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
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
  "education", "skills", "notes",
] as const;

export default function EmployeeProfilesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [employees, setEmployees] = useState<ProfileEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProfileEmployee | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEmployees(Array.isArray(d) ? d.filter((e: any) => e.role !== "client") : []))
      .catch(() => setEmployees([]))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const selectEmp = (e: ProfileEmployee) => {
    setSelected(e);
    const f: Record<string, string> = {};
    for (const k of FORM_FIELDS) f[k] = (e as any)[k] ?? "";
    setForm(f);
    setSavedMsg("");
  };

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

  if (!isAdmin) {
    return (
      <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">仅管理员可查看员工档案</div>
    );
  }

  const textField = (label: string, key: string, placeholder?: string, type = "text") => (
    <div className="space-y-1">
      <Label className="text-xs text-[var(--muted-foreground)]">{label}</Label>
      <Input type={type} value={form[key] ?? ""} onChange={(e) => setField(key, e.target.value)} placeholder={placeholder} className="h-9" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工档案</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">基本信息 · 工作信息 · 银行信息 · 紧急联系人 · 其他</p>
        </div>
        <Link href="/internal">
          <Button variant="outline" size="sm" className="h-8 text-xs"><ArrowLeft className="size-3.5" /> 返回内部管理</Button>
        </Link>
      </div>

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

        {/* 档案详情 */}
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

                {/* 基本信息 */}
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
                    {textField("电话", "phone", "电话号码")}
                    {textField("身份证号 / 护照号", "id_number", "证件号码")}
                    <div className="space-y-1 sm:col-span-2">
                      {textField("住址", "address", "居住地址")}
                    </div>
                  </div>
                </section>

                {/* 工作信息 */}
                <section>
                  <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">工作信息</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {textField("部门", "department", "部门")}
                    {textField("职位", "position", "职位")}
                    {textField("合同期限", "contract_term", "如 2026-01-01 至 2026-12-31")}
                  </div>
                </section>

                {/* 银行信息 */}
                <section>
                  <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">银行信息</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {textField("开户银行", "bank_name", "开户银行")}
                    {textField("银行账号", "bank_account", "银行账号")}
                  </div>
                </section>

                {/* 紧急联系人 */}
                <section>
                  <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">紧急联系人</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {textField("姓名", "emergency_name", "紧急联系人姓名")}
                    {textField("电话", "emergency_phone", "紧急联系人电话")}
                    {textField("关系", "emergency_relation", "如 配偶 / 父母")}
                  </div>
                </section>

                {/* 其他 */}
                <section>
                  <h3 className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">其他</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {textField("学历", "education", "学历")}
                    {textField("技能", "skills", "技能")}
                    <div className="space-y-1 sm:col-span-2">
                      {textField("备注", "notes", "备注")}
                    </div>
                  </div>
                </section>

                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
                  {savedMsg && <span className="text-xs text-emerald-600 dark:text-emerald-400">{savedMsg}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
