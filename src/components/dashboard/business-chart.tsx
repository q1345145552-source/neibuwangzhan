"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const chartPalette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const businessNames: Record<number, string> = {
  1: "公司注册",
  2: "商标",
  3: "FDA认证",
  4: "TISI",
  5: "DLD",
  6: "清关",
  7: "地址认证",
  8: "Mall开店",
  9: "NBTC",
  10: "社保开户",
};

interface Props {
  data: Record<string, number>;
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { value: number; name: string }[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--popover)] px-3 py-2 text-sm shadow-lg">
      <span className="font-mono font-medium tabular-nums text-[var(--foreground)]">{payload[0].value} 单</span>
    </div>
  );
};

export function BusinessChart({ data }: Props) {
  const chartData = Object.entries(data)
    .map(([key, orders]) => ({
      name: businessNames[Number(key)] || "",
      orders,
    }))
    .filter((d) => d.name);

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl border-0 bg-[var(--card)] px-5 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
        <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">各业务线订单分布</h3>
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无数据</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-0 bg-[var(--card)] px-5 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">各业务线订单分布</h3>
      <div className="-mx-2" aria-label={`各业务线订单分布柱状图：${chartData.map(d => `${d.name}${d.orders}单`).join("，")}`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--font-sans)" }} interval={0} angle={-30} textAnchor="end" height={60} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--font-mono)" }} width={48} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="orders" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
