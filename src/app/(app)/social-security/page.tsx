"use client";

import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function SocialSecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>社保开户</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          帮客户到泰国社保局办理雇主登记开户。一单对应一家公司，收费 6,000 泰铢一次性，文件齐全当天办完。
        </p>
      </div>

      <BusinessLinePage
        businessKey="社保开户"
        label="社保开户"
        accentHue={140}
        description="9步办理雇主登记：Eve 收集公司资料、填表、签字盖章、递交社保局当天拿登记号，Pop 负责付款环节。注册证明书6个月内有效，外籍董事需实地考察。"
      />
    </div>
  );
}
