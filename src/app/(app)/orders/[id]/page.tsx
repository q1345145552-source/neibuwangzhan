"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, DollarSign, Paperclip } from "lucide-react";
import { orders, statusLabels, priorityLabels, statusClass } from "@/mock/orders";
import { orderProgressSteps, orderDocuments, orderCosts } from "@/mock/order-detail";
import { cn } from "@/lib/utils";

const docStatusClass: Record<string, string> = {
  approved: "text-[var(--success)]",
  pending: "text-[var(--warning)]",
  rejected: "text-[var(--destructive)]",
};

const docStatusLabel: Record<string, string> = {
  approved: "已审核",
  pending: "待审核",
  rejected: "已驳回",
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const order = orders.find((o) => o.id === id);
  const progress = orderProgressSteps[id] || [];

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-[var(--muted-foreground)]">订单不存在</p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => router.push("/orders")}>返回订单列表</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => router.push("/orders")} aria-label="返回订单列表">
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>
              {order.id}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>
                {statusLabels[order.status]}
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">优先级: {priorityLabels[order.priority]}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => console.log("编辑订单", order.id)}>编辑</Button>
          <Button variant="outline" size="sm" onClick={() => console.log("取消订单", order.id)} className="text-[var(--destructive)] border-[var(--destructive)]/20 hover:bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)]">取消订单</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main info */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Basic info */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
            <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">基本信息</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ["客户名称", order.clientName],
                ["联系人", order.contactPerson],
                ["业务线", order.businessLine],
                ["负责人", order.assignee],
                ["预估金额", `¥${order.amount.toLocaleString()}`],
                ["创建日期", order.createdAt],
                ["截止日期", order.deadline],
                ["**描述**", order.description],
              ].map(([label, value]) => (
                <div key={label} className={label === "**描述**" ? "sm:col-span-2" : ""}>
                  <dt className="text-xs text-[var(--muted-foreground)] tracking-wide">{label.replace(/\*\*/g, "")}</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Progress */}
          {progress.length > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-6">
              <h3 className="mb-5 text-sm font-medium text-[var(--foreground)]">进度追踪</h3>
              <div className="flex flex-col gap-0">
                {progress.map((step, i) => (
                  <div key={step.step} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                        step.status === "done" && "bg-[var(--success)] text-[var(--success-foreground)]",
                        step.status === "current" && "bg-[var(--primary)] text-[var(--primary-foreground)] ring-2 ring-[var(--ring)]/30",
                        step.status === "upcoming" && "bg-[var(--muted)] text-[var(--muted-foreground)]"
                      )}>
                        {step.status === "done" ? "✓" : step.step}
                      </div>
                      {i < progress.length - 1 && (
                        <div className={cn("w-px flex-1 min-h-[20px]", step.status === "done" ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
                      )}
                    </div>
                    <div className={cn("pb-5", step.status === "upcoming" && "opacity-50")}>
                      <p className="text-sm font-medium text-[var(--foreground)]">{step.label}</p>
                      {step.date && <p className="text-xs text-[var(--muted-foreground)]">{step.date}</p>}
                      {step.remark && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{step.remark}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          {/* Documents */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-3 flex items-center gap-2">
              <Paperclip className="size-4 text-[var(--muted-foreground)]" />
              <h3 className="text-sm font-medium text-[var(--foreground)]">文档清单</h3>
            </div>
            {orderDocuments.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无文档</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {orderDocuments.map((doc) => (
                  <li key={doc.name} className="flex items-start gap-2 rounded-md p-2 transition-colors hover:bg-[var(--secondary)]">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--muted-foreground)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[var(--foreground)]">{doc.name}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-xs text-[var(--muted-foreground)]">{doc.type}</span>
                        <span className={cn("text-xs font-medium", docStatusClass[doc.status])}>{docStatusLabel[doc.status]}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Costs */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-3 flex items-center gap-2">
              <DollarSign className="size-4 text-[var(--muted-foreground)]" />
              <h3 className="text-sm font-medium text-[var(--foreground)]">费用记录</h3>
            </div>
            {orderCosts.length === 0 ? (
              <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无费用记录</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {orderCosts.map((cost, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="text-xs font-medium text-[var(--foreground)]">{cost.item}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">{cost.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono font-medium tabular-nums text-[var(--foreground)]">¥{cost.amount.toLocaleString()}</p>
                      <p className={cn("text-xs font-medium", cost.status === "paid" ? "text-[var(--success)]" : "text-[var(--warning)]")}>
                        {cost.status === "paid" ? "已付" : "未付"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
