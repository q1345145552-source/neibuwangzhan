"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Save, Pencil, Trash2, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Employee, fetchEmployees, createEmployee, updateEmployee, deleteEmployee, fetchOrderCustomerNames, fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [saved, setSaved] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empError, setEmpError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("employee");
  const [newPassword, setNewPassword] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editPassword, setEditPassword] = useState("");

  // 客户账号可见范围：该账号在外部客户端口能看到哪些公司的订单
  const [scopeTarget, setScopeTarget] = useState<Employee | null>(null);
  const [scopeSelected, setScopeSelected] = useState<string[]>([]);
  const [allCustomerNames, setAllCustomerNames] = useState<string[]>([]);
  const [scopeSearch, setScopeSearch] = useState("");
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState("");

  // 修改自己的密码
  const [curPwd, setCurPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetchEmployees().then(setEmployees).catch(() => {});
  }, []);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdMsg(null);
    if (!curPwd) return setPwdMsg({ ok: false, text: "请输入当前密码" });
    if (newPwd !== confirmPwd) return setPwdMsg({ ok: false, text: "两次输入的新密码不一致" });
    if (newPwd.length < 8) return setPwdMsg({ ok: false, text: "新密码至少 8 位" });

    setPwdSaving(true);
    try {
      const res = await fetchWithAuth("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: curPwd, new_password: newPwd }),
      });
      if (!res.ok) {
        // 后端会返回具体原因（密码太常见、纯数字等），直接透给用户
        const d = await res.json().catch(() => ({}));
        setPwdMsg({ ok: false, text: d.error || "修改失败，请重试" });
        return;
      }
      setPwdMsg({ ok: true, text: "密码已修改，下次登录用新密码" });
      setCurPwd(""); setNewPwd(""); setConfirmPwd("");
    } catch {
      setPwdMsg({ ok: false, text: "网络错误，请重试" });
    } finally {
      setPwdSaving(false);
    }
  }

  const openScope = async (emp: Employee) => {
    setScopeTarget(emp);
    setScopeSelected(emp.customer_names ?? []);
    setScopeSearch("");
    setScopeError("");
    if (allCustomerNames.length === 0) {
      try { setAllCustomerNames(await fetchOrderCustomerNames()); }
      catch { setScopeError("客户名列表加载失败，可手动输入"); }
    }
  };

  const toggleScope = (name: string) => {
    setScopeSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleSaveScope = async () => {
    if (!scopeTarget) return;
    setScopeSaving(true); setScopeError("");
    try {
      const emp = await updateEmployee(Number(scopeTarget.id), { customer_names: scopeSelected });
      setEmployees(prev => prev.map(e => e.id === scopeTarget.id ? { ...e, ...emp } : e));
      setScopeTarget(null);
    } catch (err) {
      setScopeError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setScopeSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    setEmpError("");
    try {
      const emp = await createEmployee({ name: newName, email: newEmail, role: newRole, password: newPassword || "123456" });
      setEmployees(prev => [...prev, emp]);
      setNewName(""); setNewEmail(""); setNewRole("employee"); setNewPassword("");
      setShowAddForm(false);
    } catch (err) {
      console.error("Add employee failed:", err);
      setEmpError("添加失败，仅管理员可操作");
    }
  };

  const handleEdit = (emp: Employee) => {
    setEditingId(Number(emp.id));
    setEditName(emp.name);
    setEditEmail(emp.email ?? "");
    setEditRole(emp.role ?? "");
    setEditPassword("");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setEmpError("");
    try {
      const emp = await updateEmployee(editingId, { name: editName, email: editEmail, role: editRole, ...(editPassword.trim() ? { password: editPassword.trim() } : {}) });
      setEmployees(prev => prev.map(e => e.id === editingId ? emp : e));
      setEditingId(null);
    } catch (err) {
      console.error("Update employee failed:", err);
      setEmpError("保存失败，仅管理员可操作");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除该员工？")) return;
    setEmpError("");
    try {
      await deleteEmployee(id);
      setEmployees(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error("Delete employee failed:", err);
      setEmpError("删除失败，仅管理员可操作");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    await new Promise((r) => setTimeout(r, 1200));
    setSaved(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
          系统设置
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">管人、管配置，都在这儿</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Employee management */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[var(--foreground)]">员工管理</h3>
            {isAdmin && <Button variant="outline" size="icon-xs" aria-label="添加员工" onClick={() => setShowAddForm(v => !v)}><Plus className="size-3.5" aria-hidden="true" /></Button>}
          </div>
          {!isAdmin && <p className="text-xs text-[var(--muted-foreground)]">仅管理员可以添加、编辑或删除员工</p>}
          {empError && <p className="text-xs text-[var(--destructive)]">{empError}</p>}

          {/* Add form */}
          {isAdmin && showAddForm && (
            <div className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
              <Input placeholder="姓名" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" />
              <Input placeholder="邮箱" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-8 text-sm" />
              <div className="flex gap-2">
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
                  <option value="employee">员工</option>
                  <option value="admin">管理员</option>
                  <option value="client">客户</option>
                </select>
                <Input placeholder="密码(默认123456)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-8 text-sm flex-1" />
                <Button size="xs" onClick={handleAdd} className="h-8 text-xs">添加</Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">姓名</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">角色</th>
                  <th className="py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                    <td className="py-2.5 pr-4">
                      {editingId === emp.id ? (
                        <div className="space-y-1">
                          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm" />
                          <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-7 text-sm" />
                          <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="h-7 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs">
                            <option value="employee">员工</option>
                            <option value="admin">管理员</option>
                            <option value="client">客户</option>
                          </select>
                          <Input value={editPassword} onChange={(e) => setEditPassword(e.target.value)} type="password" placeholder="新密码（留空则不修改）" className="h-7 text-sm" />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                            {emp.name.slice(0, 1)}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[var(--foreground)]">{emp.name}</p>
                            <p className="text-xs text-[var(--muted-foreground)] max-sm:hidden">{emp.email}</p>
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--muted-foreground)] max-sm:hidden">
                      <span className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        emp.role === "admin" ? "bg-[color-mix(in_oklch,var(--destructive),var(--background)_85%)] text-[var(--destructive)]" :
                        emp.role === "client" ? "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[var(--info)]" :
                        "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]"
                      )}>
                        {emp.role === "admin" ? "管理员" : emp.role === "client" ? "客户" : "员工"}
                      </span>
                      {/* 客户账号：显示它在外部端口能看到哪些公司的订单 */}
                      {emp.role === "client" && (
                        <div className="mt-1 text-xs">
                          {(emp.customer_names?.length ?? 0) > 0 ? (
                            <span className="text-[var(--muted-foreground)]">
                              可见 {emp.customer_names!.length} 家：{emp.customer_names!.slice(0, 2).join("、")}
                              {emp.customer_names!.length > 2 ? " 等" : ""}
                            </span>
                          ) : (
                            <span className="text-[var(--warning)]">未配置可见公司（暂按账号姓名匹配）</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5">
                      {!isAdmin ? (
                        <span className="text-xs text-[var(--muted-foreground)]">—</span>
                      ) : editingId === emp.id ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon-xs" onClick={handleSaveEdit}><Save className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => setEditingId(null)}>✕</Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          {emp.role === "client" && (
                            <Button variant="ghost" size="icon-xs" onClick={() => openScope(emp)} title="配置可见公司" aria-label="配置可见公司">
                              <Building2 className="size-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-xs" onClick={() => handleEdit(emp)}><Pencil className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(emp.id)} className="text-[var(--destructive)] hover:text-[var(--destructive)]"><Trash2 className="size-3" /></Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 客户账号可见范围配置 */}
        {scopeTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="配置可见公司">
            <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg">
              <h3 className="text-sm font-medium text-[var(--foreground)]">
                配置可见公司 · {scopeTarget.name}
              </h3>
              <p className="mt-1 text-xs text-[var(--muted-foreground)] leading-relaxed">
                该客户账号登录外部端口后，只能看到这里勾选的公司的订单。
                一个都不选 = 暂时回退到按账号姓名匹配（旧行为，同名客户会互相看到）。
              </p>

              {scopeError && (
                <p role="alert" className="mt-3 rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-3 py-2 text-xs text-[var(--destructive)]">{scopeError}</p>
              )}

              <div className="mt-4">
                <Input
                  value={scopeSearch}
                  onChange={(e) => setScopeSearch(e.target.value)}
                  placeholder="搜索公司名，或输入后回车手动添加"
                  className="h-9 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = scopeSearch.trim();
                      if (v && !scopeSelected.includes(v)) setScopeSelected(prev => [...prev, v]);
                      setScopeSearch("");
                    }
                  }}
                />
              </div>

              {scopeSelected.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {scopeSelected.map((n) => (
                    <button
                      key={n}
                      onClick={() => toggleScope(n)}
                      className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] px-2.5 py-1 text-xs text-[var(--info)] hover:bg-[color-mix(in_oklch,var(--info),var(--background)_75%)] transition-colors"
                      title="点击移除"
                    >
                      {n}<span aria-hidden="true">✕</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-[var(--border)]">
                {allCustomerNames.filter(n => !scopeSearch || n.includes(scopeSearch)).length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">
                    {allCustomerNames.length === 0 ? "暂无订单客户，可在上方手动输入后回车添加" : "没有匹配的公司名"}
                  </p>
                ) : (
                  allCustomerNames
                    .filter(n => !scopeSearch || n.includes(scopeSearch))
                    .map((n) => (
                      <label key={n} className="flex cursor-pointer items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-sm last:border-b-0 hover:bg-[var(--secondary)]">
                        <input
                          type="checkbox"
                          checked={scopeSelected.includes(n)}
                          onChange={() => toggleScope(n)}
                          className="size-3.5 accent-[var(--primary)]"
                        />
                        <span className="text-[var(--foreground)]">{n}</span>
                      </label>
                    ))
                )}
              </div>

              <div className="mt-5 flex items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setScopeTarget(null)} disabled={scopeSaving}>取消</Button>
                <Button size="sm" onClick={handleSaveScope} disabled={scopeSaving}>
                  <Save className="size-3.5" />{scopeSaving ? "保存中…" : `保存（已选 ${scopeSelected.length} 家）`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 修改自己的密码 */}
        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <div>
            <h3 className="text-sm font-medium text-[var(--foreground)]">修改密码</h3>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              改自己账号的登录密码。至少 8 位，不能全是数字。
            </p>
          </div>
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4 max-w-sm">
            <div className="flex flex-col gap-2">
              <Label htmlFor="curPwd" className="text-sm font-medium">当前密码</Label>
              <Input id="curPwd" type="password" autoComplete="current-password"
                value={curPwd} onChange={(e) => setCurPwd(e.target.value)}
                disabled={pwdSaving} className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="newPwd2" className="text-sm font-medium">新密码</Label>
              <Input id="newPwd2" type="password" autoComplete="new-password" placeholder="至少 8 位"
                value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                disabled={pwdSaving} className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmPwd2" className="text-sm font-medium">再输一次</Label>
              <Input id="confirmPwd2" type="password" autoComplete="new-password"
                value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                disabled={pwdSaving} className="h-10" />
            </div>
            {pwdMsg && (
              <p className={`rounded-md px-3 py-2 text-xs ${
                pwdMsg.ok
                  ? "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]"
                  : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]"
              }`}>
                {pwdMsg.text}
              </p>
            )}
            <Button type="submit" size="sm" className="self-start" disabled={pwdSaving}>
              {pwdSaving ? "保存中..." : "修改密码"}
            </Button>
          </form>
        </div>

        {/* Basic settings form */}
        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-medium text-[var(--foreground)]">基础设置</h3>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="company" className="text-sm font-medium">公司名称</Label>
              <Input id="company" defaultValue="湘泰企业服务有限公司" className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contactEmail" className="text-sm font-medium">联系邮箱</Label>
              <Input id="contactEmail" type="email" defaultValue="contact@xiangtai.com" className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contactPhone" className="text-sm font-medium">联系电话</Label>
              <Input id="contactPhone" defaultValue="+86 400-000-0000" className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="timezone" className="text-sm font-medium">时区</Label>
              <select id="timezone" defaultValue="Asia/Bangkok" className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency" className="text-sm font-medium">默认货币</Label>
              <select id="currency" defaultValue="THB" className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
                <option value="THB">THB (泰铢)</option>
                <option value="CNY">CNY (人民币)</option>
                <option value="USD">USD (美元)</option>
              </select>
            </div>
            <Button type="submit" size="sm" className="self-start mt-2" disabled={saved}>
              <Save className="size-3.5" />
              {saved ? "已保存" : "保存设置"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
