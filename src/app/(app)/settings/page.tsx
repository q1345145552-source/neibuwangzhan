"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Save, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Employee, fetchEmployees, createEmployee, updateEmployee, deleteEmployee } from "@/lib/api";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("employee");
  const [newPassword, setNewPassword] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("");

  useEffect(() => {
    fetchEmployees().then(setEmployees).catch(() => {});
  }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newEmail.trim()) return;
    try {
      const emp = await createEmployee({ name: newName, email: newEmail, role: newRole, password: newPassword || "123456" });
      setEmployees(prev => [...prev, emp]);
      setNewName(""); setNewEmail(""); setNewRole("employee"); setNewPassword("");
      setShowAddForm(false);
    } catch (err) {
      console.error("Add employee failed:", err);
    }
  };

  const handleEdit = (emp: Employee) => {
    setEditingId(Number(emp.id));
    setEditName(emp.name);
    setEditEmail(emp.email ?? "");
    setEditRole(emp.role ?? "");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      const emp = await updateEmployee(editingId, { name: editName, email: editEmail, role: editRole });
      setEmployees(prev => prev.map(e => e.id === editingId ? emp : e));
      setEditingId(null);
    } catch (err) {
      console.error("Update employee failed:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确认删除该员工？")) return;
    try {
      await deleteEmployee(id);
      setEmployees(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error("Delete employee failed:", err);
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
            <Button variant="outline" size="icon-xs" aria-label="添加员工" onClick={() => setShowAddForm(v => !v)}><Plus className="size-3.5" aria-hidden="true" /></Button>
          </div>

          {/* Add form */}
          {showAddForm && (
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
                    </td>
                    <td className="py-2.5">
                      {editingId === emp.id ? (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon-xs" onClick={handleSaveEdit}><Save className="size-3" /></Button>
                          <Button variant="ghost" size="icon-xs" onClick={() => setEditingId(null)}>✕</Button>
                        </div>
                      ) : (
                        <div className="flex gap-1">
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
