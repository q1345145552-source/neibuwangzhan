"use client";

import { useState } from "react";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { companySubServices } from "@/lib/constants";
import { cn } from "@/lib/utils";

const tabs = companySubServices;

const tabDescriptions: Record<string, string> = {
  "company-reg": "Bam收客户资料整理到飞书发给Pop，Pop帮客户注册DBD eBiz核名。身份验证通过后Pop负责全套注册流程，不通过Eve担保签。审核完成Pop制作印章，最后Bam交付全套文件给客户。",
  "vat": "Pop准备VAT注册文件交给Fern。Fern去税务局跑一趟，文件有误得回来改再跑，单次交通约1000泰铢。如果Fern在清迈，Pop或Piang代办。",
  "bank": "Eve先预审文件、约时间（1-2周）。通过后通知客户来泰国，Bam或Pop陪去银行。注意公司须有1名泰籍股东，银行会审背景。",
  "address": "老板定地址（Hong Tower或其它），Pop联系房东签合同、付款、拿证件地址文件。年租金管理暂无固定负责人。",
  "accounting": "Eve每月整理账目。当前零申报，老板要求改正常每月报税，等老板安排。",
  "change": "Pop接变更需求（改董事/改地址/增资），Eve协助办文件，分工暂未完全明确。完成后Pop交付全套更新文件。",
};

export default function CompanyRegistrationPage() {
  const [activeTab, setActiveTab] = useState(tabs[0].key);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>公司注册</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          帮客户在泰国落地公司，从核名到开户一条龙。最近公司注册这块挺忙的，有好几个客户同时在跑。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              activeTab === tab.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <BusinessLinePage
        businessKey="公司注册"
        label={tabs.find(t => t.key === activeTab)?.label || ""}
        accentHue={260}
        description={tabDescriptions[activeTab] || ""}
        subServiceType={activeTab}
      />
    </div>
  );
}
