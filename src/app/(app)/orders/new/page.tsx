"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save } from "lucide-react";
import { fetchBusinessTypes, fetchEmployees } from "@/lib/api";
import { subServices } from "@/lib/constants";
import type { BusinessType, Employee } from "@/lib/api";

export default function NewOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bizName = searchParams.get("biz");
  const subServiceType = searchParams.get("sub");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [appliedBizName, setAppliedBizName] = useState<string | null>(null);
  const [form, setForm] = useState({
    business_type_id: "",
    customer_name: "",
    responsible_person: "",
    description: "",
    total_amount: "",
    currency: "CNY",
    sub_service_type: "",
    trademark_name: "",
  });

  const availableSubServices = subServices[Number(form.business_type_id)] || [];

  useEffect(() => {
    fetchBusinessTypes().then(setBusinessTypes).catch(() => setError("加载业务线失败"));
    fetchEmployees().then(setEmployees).catch(() => {});
  }, []);

  // 业务线加载完成后，根据 URL 上的 biz 参数预选一次（渲染期间派生状态，而非在 effect 里 setState）
  if (bizName && bizName !== appliedBizName && businessTypes.length > 0) {
    const bt = businessTypes.find((t) => t.name === bizName);
    if (bt) {
      setAppliedBizName(bizName);
      setForm((prev) => ({
        ...prev,
        business_type_id: String(bt.id),
        sub_service_type: subServiceType || prev.sub_service_type,
      }));
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // 切换业务线时，清空子类型（除非从 URL 自动填充）
      if (name === "business_type_id" && value !== prev.business_type_id) {
        const urlSub = searchParams.get("sub");
        const newSubs = subServices[Number(value)] || [];
        if (urlSub && newSubs.some(s => s.key === urlSub)) {
          next.sub_service_type = urlSub;
        } else {
          next.sub_service_type = "";
        }
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.customer_name.trim()) { setError("客户名不能为空"); return; }
    if (!form.business_type_id) { setError("请选择业务线"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("authToken")}` },
        body: JSON.stringify({
          customer_name: form.customer_name,
          business_type_id: Number(form.business_type_id),
          responsible_person: form.responsible_person,
          description: form.description,
          total_amount: Number(form.total_amount) || 0,
          currency: form.currency,
          sub_service_type: form.sub_service_type,
          trademark_name: form.business_type_id === "2" ? form.trademark_name : "",
        }),
      });
      const data = await res.json();
      console.log("[创建订单] 响应:", res.status, data);
      if (!res.ok) throw new Error(data.error || `服务器错误 ${res.status}`);
      router.push("/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建订单失败，稍后再试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.back()} aria-label="返回订单列表"><ArrowLeft className="size-4" aria-hidden="true" /></Button>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>新建订单</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">把订单信息填好，别漏了</p>
        </div>
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-medium text-[var(--foreground)]">基本信息</h3>
          <div className="flex flex-col gap-2">
            <Label htmlFor="business_type_id" className="text-sm font-medium">业务线</Label>
            <select id="business_type_id" name="business_type_id" value={form.business_type_id} onChange={handleChange} required className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
              <option value="">请选择业务线</option>
              {businessTypes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {availableSubServices.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub_service_type" className="text-sm font-medium">子类型</Label>
            <select id="sub_service_type" name="sub_service_type" value={form.sub_service_type} onChange={handleChange} className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
              <option value="">请选择子类型</option>
              {availableSubServices.map((s: { key: string; label: string }) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="customer_name" className="text-sm font-medium">客户名称</Label>
            <Input id="customer_name" name="customer_name" value={form.customer_name} onChange={handleChange} required className="h-10" placeholder="公司全称" />
          </div>
          {form.business_type_id === "2" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="trademark_name" className="text-sm font-medium">商标名称</Label>
            <Input id="trademark_name" name="trademark_name" value={form.trademark_name} onChange={handleChange} className="h-10" placeholder="输入商标名称" />
          </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="responsible_person" className="text-sm font-medium">负责人</Label>
            <select id="responsible_person" name="responsible_person" value={form.responsible_person} onChange={handleChange} className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
              <option value="">选择负责人</option>
              {employees.map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="total_amount" className="text-sm font-medium">预估金额</Label>
            <div className="flex gap-2">
              <Input id="total_amount" name="total_amount" type="number" value={form.total_amount} onChange={handleChange} className="h-10 flex-1" placeholder="0" />
              <select name="currency" value={form.currency} onChange={handleChange} className="h-10 w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]">
                <option value="CNY">¥ 人民币</option>
                <option value="THB">฿ 泰铢</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h3 className="text-sm font-medium text-[var(--foreground)]">详细描述</h3>
          <div className="flex flex-col gap-2 flex-1">
            <Label htmlFor="description" className="text-sm font-medium">订单描述</Label>
            <textarea id="description" name="description" value={form.description} onChange={handleChange} rows={8} className="flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none resize-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20 placeholder:text-[var(--muted-foreground)]" placeholder="描述订单需求…" />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={loading} size="sm"><Save className="size-3.5" />{loading ? "提交中…" : "提交订单"}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => router.back()}>取消</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
