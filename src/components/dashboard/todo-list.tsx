import { cn } from "@/lib/utils";

const statusMap: Record<
  string,
  { label: string; className: string }
> = {
  pending: {
    label: "待处理",
    className:
      "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  },
  in_progress: {
    label: "进行中",
    className:
      "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  },
  completed: {
    label: "已完成",
    className:
      "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  },
  overdue: {
    label: "已逾期",
    className:
      "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
  },
};

interface Todo {
  id: number;
  task: string;
  business: string;
  deadline: string;
  status: "pending" | "in_progress" | "completed" | "overdue";
}

const todos: Todo[] = [
  {
    id: 1,
    task: "审核 FDA 产品认证申请材料",
    business: "FDA产品认证",
    deadline: "2026-07-02",
    status: "pending",
  },
  {
    id: 2,
    task: "提交商标续展文件",
    business: "商标",
    deadline: "2026-06-30",
    status: "in_progress",
  },
  {
    id: 3,
    task: "确认 TISI 检测报告",
    business: "TISI",
    deadline: "2026-07-01",
    status: "pending",
  },
  {
    id: 4,
    task: "Mall 开店资料整理",
    business: "Mall开店",
    deadline: "2026-07-05",
    status: "in_progress",
  },
  {
    id: 5,
    task: "补交清关文件",
    business: "清关",
    deadline: "2026-06-28",
    status: "overdue",
  },
  {
    id: 6,
    task: "完成公司注册地址认证",
    business: "地址认证",
    deadline: "2026-07-03",
    status: "completed",
  },
  {
    id: 7,
    task: "更新 DLD 车辆检测记录",
    business: "DLD",
    deadline: "2026-07-06",
    status: "pending",
  },
];

export function TodoList() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] px-5 py-5">      <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">
        近期待办
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">
                任务
              </th>
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden">
                业务线
              </th>
              <th className="py-2.5 pr-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">
                截止
              </th>
              <th className="py-2.5 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">
                状态
              </th>
            </tr>
          </thead>
          <tbody>
            {todos.map((todo) => {
              const status = statusMap[todo.status];
              return (
                <tr
                  key={todo.id}
                  className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]"
                >
                  <td className="py-3 pr-4 font-medium text-[var(--foreground)] max-w-[220px] truncate">
                    {todo.task}
                  </td>
                  <td className="py-3 pr-4 text-[var(--muted-foreground)] max-sm:hidden">
                    {todo.business}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)]">
                    {todo.deadline}
                  </td>
                  <td className="py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
                        status.className
                      )}
                    >
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
