import { cn } from "@/lib/utils";
import Link from "next/link";
import type { Order } from "@/lib/api";
import { statusClass, statusLabels } from "@/lib/api";

interface Props {
  orders: Order[];
}

export function TodoList({ orders }: Props) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-5 py-5">
      <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">近期待办</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">订单号</th>
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">客户</th>
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">说明</th>
              <th className="py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const cls = statusClass[order.status] || "";
              const label = statusLabels[order.status] || order.status;
              return (
                <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                  <td className="py-3 pr-4 font-mono text-xs font-medium tabular-nums"><Link href={`/orders/${order.id}`} className="text-[var(--accent-foreground)] hover:underline">{order.id}</Link></td>
                  <td className="py-3 pr-4 max-sm:hidden">
                    <span className="font-medium text-[var(--foreground)]">{order.customer_name}</span>
                  </td>
                  <td className="py-3 pr-4 max-w-[220px] truncate text-[var(--foreground)]">{order.description}</td>
                  <td className="py-3">
                    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>{label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {orders.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无待办</div>
      )}
    </div>
  );
}
