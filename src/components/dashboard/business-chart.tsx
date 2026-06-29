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

const chartColors = [
  "var(--chart-1)",
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-4)",
  "var(--chart-3)",
];

const data = [
  { name: "公司注册", orders: 142 },
  { name: "商标", orders: 98 },
  { name: "FDA认证", orders: 67 },
  { name: "TISI", orders: 53 },
  { name: "DLD", orders: 41 },
  { name: "清关", orders: 115 },
  { name: "地址认证", orders: 34 },
  { name: "Mall开店", orders: 78 },
];

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { value: number }[];
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--popover)] px-3 py-2 text-sm shadow-lg">
      <span className="font-mono font-medium tabular-nums text-[var(--foreground)]">
        {payload[0].value} 单
      </span>
    </div>
  );
};

export function BusinessChart() {
  return (
    <div className="rounded-2xl border-0 bg-[var(--card)] px-5 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <h3 className="mb-4 text-sm font-medium text-[var(--foreground)]">
        各业务线订单分布
      </h3>
      <div className="-mx-2" aria-label="各业务线订单分布柱状图：公司注册142单，商标98单，FDA认证67单，TISI 53单，DLD 41单，清关115单，地址认证34单，Mall开店78单">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, left: -16, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="4 4"
              stroke="var(--border)"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 12,
                fontFamily: "var(--font-sans)",
              }}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={60}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{
                fill: "var(--muted-foreground)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
              }}
              width={48}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="orders" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {data.map((_, i) => (
                <Cell key={i} fill={chartColors[i % chartColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
