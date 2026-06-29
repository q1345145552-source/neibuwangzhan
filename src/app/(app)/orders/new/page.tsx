"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save } from "lucide-react";
import { businessLines } from "@/mock/orders";

export default function NewOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    businessLine: "",
    clientName: "",
    contactPerson: "",
    contactPhone: "",
    assignee: "",
    amount: "",
    deadline: "",
    priority: "medium",
    description: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setLoading(false);
    router.push("/orders");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回订单列表">
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
            新建订单
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">把订单信息填好，别漏了</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-medium text-[var(--foreground)]">基本信息</h3>

          <div className="flex flex-col gap-2">
            <Label htmlFor="businessLine" className="text-sm font-medium">业务线</Label>
            <select
              id="businessLine"
              name="businessLine"
              value={form.businessLine}
              onChange={handleChange}
              required
              aria-label="业务线"
              className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
            >
              <option value="">请选择业务线</option>
              {businessLines.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="clientName" className="text-sm font-medium">客户名称</Label>
              <Input id="clientName" name="clientName" value={form.clientName} onChange={handleChange} required className="h-10" placeholder="公司全称" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contactPerson" className="text-sm font-medium">联系人</Label>
              <Input id="contactPerson" name="contactPerson" value={form.contactPerson} onChange={handleChange} required className="h-10" placeholder="姓名" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="contactPhone" className="text-sm font-medium">联系电话</Label>
              <Input id="contactPhone" name="contactPhone" value={form.contactPhone} onChange={handleChange} className="h-10" placeholder="手机号码" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="assignee" className="text-sm font-medium">负责人</Label>
              <select
                id="assignee"
                name="assignee"
                value={form.assignee}
                onChange={handleChange}
                required
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
              >
                <option value="">选择负责人</option>
                <option value="张三">张三</option>
                <option value="李四">李四</option>
                <option value="王五">王五</option>
                <option value="赵六">赵六</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="amount" className="text-sm font-medium">预估金额 (¥)</Label>
              <Input id="amount" name="amount" type="number" value={form.amount} onChange={handleChange} className="h-10" placeholder="0" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="deadline" className="text-sm font-medium">截止日期</Label>
              <Input id="deadline" name="deadline" type="date" value={form.deadline} onChange={handleChange} required className="h-10" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="priority" className="text-sm font-medium">优先级</Label>
              <select
                id="priority"
                name="priority"
                value={form.priority}
                onChange={handleChange}
                className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-medium text-[var(--foreground)]">详细描述</h3>

          <div className="flex flex-col gap-2 flex-1">
            <Label htmlFor="description" className="text-sm font-medium">订单描述</Label>
            <textarea
              id="description"
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={8}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none resize-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20 placeholder:text-[var(--muted-foreground)]"
              placeholder="描述订单需求、服务内容、特殊要求等..."
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={loading} size="sm">
              <Save className="size-3.5" />
              {loading ? "提交中..." : "提交订单"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => router.back()}>取消</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
