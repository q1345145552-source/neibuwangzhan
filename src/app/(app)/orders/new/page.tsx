"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save } from "lucide-react";
import { fetchBusinessTypes, fetchEmployees, createOrder } from "@/lib/api";
import { StorefrontAccountPicker, accountLoginOf } from "@/components/storefront-account-picker";
import { subServices } from "@/lib/constants";
import type { BusinessType, Employee, StorefrontAccount } from "@/lib/api";

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
  // 客户 = 客户在业务系统的账号（2026-10-28 老板：订单直接挂到客户账号下，提交就推过去，客户登录就看得到）
  const [account, setAccount] = useState<StorefrontAccount | null>(null);
  // 选的老账号还没有客户群名时补的群名
  const [groupName, setGroupName] = useState("");
  const [form, setForm] = useState({
    business_type_id: "",
    responsible_person: "",
    description: "",
    total_amount: "",
    sub_service_type: "",
    trademark_name: "",
    address_type: "client",
    monthly_rent: "",
  });

  const availableSubServices = subServices[Number(form.business_type_id)] || [];
  // 地址认证业务线：需要选择客户地址 / 湘泰地址（湘泰地址会自动追加租赁合同和首月租金步骤）
  const isAddressBiz = businessTypes.find((t) => t.id === Number(form.business_type_id))?.name === "地址认证";

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
      // 切换业务线时，清空子类型（除非从 URL 自动填充；只有一种可选时直接选上）
      if (name === "business_type_id" && value !== prev.business_type_id) {
        const urlSub = searchParams.get("sub");
        const newSubs = subServices[Number(value)] || [];
        if (urlSub && newSubs.some(s => s.key === urlSub)) {
          next.sub_service_type = urlSub;
        } else {
          next.sub_service_type = newSubs.length === 1 ? newSubs[0].key : "";
        }
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!account) { setError("请选客户：搜客户群名或登录名，新客户点「开新客户账号」"); return; }
    if (!account.group_name && !groupName.trim()) { setError("这个客户账号还没有客户群名，请补一个"); return; }
    if (!form.business_type_id) { setError("请选择业务线"); return; }
    // 有具体服务的业务线必须选一个：不选会套成通用流程（如 FDA 不选就是通用 5 步），建完改不了（2026-10-15）
    if (availableSubServices.length > 0 && !form.sub_service_type) { setError("请选择子类型"); return; }
    const amount = Number(form.total_amount);
    if (!form.total_amount.trim() || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      setError("请填金额（人民币，大于 0，最多两位小数）：客户登录就能看到这张单的账单"); return;
    }
    setLoading(true);
    try {
      const created = await createOrder({
        customer_name: account.group_name || groupName.trim(),
        storefront_account_id: account.id,
        group_name: account.group_name ? undefined : groupName.trim(),
        account_login: accountLoginOf(account),
        business_type_id: Number(form.business_type_id),
        responsible_person: form.responsible_person,
        description: form.description,
        total_amount: amount,
        currency: "CNY",
        sub_service_type: form.sub_service_type,
        trademark_name: form.business_type_id === "2" ? form.trademark_name : "",
        address_type: isAddressBiz ? form.address_type : "client",
        monthly_rent: isAddressBiz && form.address_type === "xiangtai" ? Number(form.monthly_rent) || 0 : 0,
      });
      // 订单建好了但没挂到客户账号（业务系统连不上等）：说清楚，到订单页「业务系统」里再推
      if (created?.storefront_error) window.alert(`订单建好了，但还没挂到客户账号：${created.storefront_error}\n到订单页右边「业务系统」点「推到业务系统」再试一次。`);
      // 建完直接进这张单（接着派人、传资料、复制客户链接）；用 replace，详情页点返回回到原来的列表而不是空表单
      // 跳转期间按钮保持「提交中」，别让人再点一次又建一张（这张单客户马上看得到）
      router.replace(created?.id ? `/orders/${encodeURIComponent(created.id)}` : "/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建订单失败，稍后再试");
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
              {/* 「待分类」只给客户站、商城转来的单用：手建的待分类单改派不了、只能取消重建 */}
              {businessTypes.filter((b) => b.name !== "待分类").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          {availableSubServices.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub_service_type" className="text-sm font-medium">子类型</Label>
            <select id="sub_service_type" name="sub_service_type" value={form.sub_service_type} onChange={handleChange} required className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
              <option value="">请选择子类型</option>
              {availableSubServices.map((s: { key: string; label: string }) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          )}
          {isAddressBiz && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="address_type" className="text-sm font-medium">地址类型</Label>
            <select id="address_type" name="address_type" value={form.address_type} onChange={handleChange} className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
              <option value="client">客户地址</option>
              <option value="xiangtai">湘泰地址（含租赁合同+首月租金步骤）</option>
            </select>
          </div>
          )}
          {isAddressBiz && form.address_type === "xiangtai" && (
          <div className="flex flex-col gap-2">
            <Label htmlFor="monthly_rent" className="text-sm font-medium">月租金</Label>
            <Input id="monthly_rent" name="monthly_rent" type="number" value={form.monthly_rent} onChange={handleChange} className="h-10" placeholder="0" />
          </div>
          )}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">客户</Label>
            <StorefrontAccountPicker account={account} onAccount={setAccount} groupName={groupName} onGroupName={setGroupName} />
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">提交后这张单就挂到客户账号下，客户登录业务系统就能看到进度和账单</p>
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
              {employees.filter((e) => e.role !== "client").map((e) => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="total_amount" className="text-sm font-medium">金额（人民币）</Label>
            <Input id="total_amount" name="total_amount" type="number" min="0" step="0.01" value={form.total_amount} onChange={handleChange} className="h-10" placeholder="客户账单上的金额" />
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">客户登录就能看到这个金额的账单；泰铢的请换算成人民币填</p>
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
