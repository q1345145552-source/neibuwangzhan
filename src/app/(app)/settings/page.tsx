"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Save } from "lucide-react";
import { employees } from "@/mock/employees";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);

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
            <Button variant="outline" size="icon-xs" aria-label="添加员工" onClick={() => console.log("添加员工")}><Plus className="size-3.5" aria-hidden="true" /></Button>
          </div>
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">姓名</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">角色</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">部门</th>
                  <th className="py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">
                          {emp.name.slice(0, 1)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[var(--foreground)]">{emp.name}</p>
                          <p className="text-xs text-[var(--muted-foreground)] max-sm:hidden">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-[var(--muted-foreground)] max-sm:hidden">{emp.role}</td>
                    <td className="py-2.5 pr-4 text-[var(--muted-foreground)] max-md:hidden">{emp.department}</td>
                    <td className="py-2.5">
                      <span className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                        emp.status === "active"
                          ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[var(--success)]"
                          : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[var(--destructive)]"
                      )}>
                        {emp.status === "active" ? "在职" : "离职"}
                      </span>
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
              <select id="timezone" defaultValue="Asia/Shanghai" className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
                <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="currency" className="text-sm font-medium">默认货币</Label>
              <select id="currency" defaultValue="CNY" className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
                <option value="CNY">CNY (人民币)</option>
                <option value="USD">USD (美元)</option>
                <option value="THB">THB (泰铢)</option>
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
