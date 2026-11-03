import { buildPayslipBreakdown, type BreakdownPayslip } from "@/lib/payslip-breakdown";

export function PayslipBreakdown({ payslip }: { payslip: BreakdownPayslip }) {
  const data = buildPayslipBreakdown(payslip);
  return <section aria-label="计算明细" className="my-4 min-w-0 rounded-lg border border-[var(--border)] p-3 [overflow-wrap:anywhere]">
    <h3 className="font-semibold">计算明细</h3>
    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{data.note}</p>
    {data.sections.map(section => <div key={section.title} className="mt-4">
      <h4 className="mb-2 text-sm font-semibold">{section.title}</h4>
      <dl className="space-y-2">{section.lines.map((line, index) => <div key={index} className="border-b border-[var(--border)] pb-2 text-sm last:border-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><dt>{line.label}</dt>{line.amount !== undefined && <dd className="font-medium tabular-nums">{line.amount.toFixed(2)} 铢</dd>}</div>
        <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted-foreground)]">{line.formula}</p>
      </div>)}</dl>
    </div>)}
  </section>;
}
