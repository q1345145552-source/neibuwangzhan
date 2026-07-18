"use client";

import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function WorkVisaPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>工作签证</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          给外国人办理泰国工作签证和劳工部工作证。一单对应一个外国人，客户先付费，分两个阶段——Non-B签证90天+工作证，一年续签。
        </p>
      </div>

      <BusinessLinePage
        businessKey="工作签证"
        label="工作签证"
        accentHue={210}
        description="13步办理外国人工作签证：Pop 全程负责，从公司文件收集 → WP3预批 → Non-B签证 → 工作证蓝本 → 一年续签。外包团队跑腿，费用客户先付无垫付。"
      />
    </div>
  );
}
