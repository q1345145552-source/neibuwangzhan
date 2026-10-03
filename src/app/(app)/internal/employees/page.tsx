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
  gender?: string;
  birth_date?: string;
  phone?: string;
  address?: string;
  id_number?: string;
}

export default function EmployeeProfilesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [employees, setEmployees] = useState<ProfileEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ProfileEmployee | null>(null);
  const [gender, setGender] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [idNumber, setIdNumber] = useState("");
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
    setGender(e.gender ?? "");
    setBirthDate(e.birth_date ?? "");
    setPhone(e.phone ?? "");
    setAddress(e.address ?? "");
    setIdNumber(e.id_number ?? "");
    setSavedMsg("");
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setSavedMsg("");
    try {
      const emp = await updateEmployee(selected.id, { gender, birth_date: birthDate, phone, address, id_number: idNumber });
      setSelected({ ...selected, gender: emp.gender ?? "", birth_date: emp.birth_date ?? "", phone: emp.phone ?? "", address: emp.address ?? "", id_number: emp.id_number ?? "" });
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">员工档案</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">员工基本信息 · 性别 / 出生日期 / 电话 / 住址 / 证件号</p>
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
            <h2 className="text-sm font-medium flex items-center gap-2"><IdCard className="size-4" />基本信息</h2>
          </div>
          <div className="p-5">
            {!selected ? (
              <p className="text-sm text-[var(--muted-foreground)]">请从左侧选择一个员工查看档案</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-[var(--muted-foreground)]">员工</Label>
                  <p className="mt-1 text-base font-medium text-[var(--foreground)]">{selected.name}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--muted-foreground)]">性别</Label>
                    <select value={gender} onChange={(e) => setGender(e.target.value)} className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                      <option value="">未填写</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                      <option value="其他">其他</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--muted-foreground)]">出生日期</Label>
                    <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--muted-foreground)]">电话</Label>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="电话号码" className="h-9" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-[var(--muted-foreground)]">身份证号 / 护照号</Label>
                    <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="证件号码" className="h-9" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs text-[var(--muted-foreground)]">住址</Label>
                    <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="居住地址" className="h-9" />
                  </div>
                </div>

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
