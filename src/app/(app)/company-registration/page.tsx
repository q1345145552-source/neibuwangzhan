"use client";

import { useState } from "react";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { companySubServices } from "@/lib/constants";
import { cn } from "@/lib/utils";

const tabs = companySubServices;

export default function CompanyRegistrationPage() {
  const [activeTab, setActiveTab] = useState(tabs[0].key);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>公司注册</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          帮客户在泰国落地公司，从核名到开户一条龙。11步并行推进，各个模块不互相阻塞。
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

      {activeTab === "company-reg" ? (
        <BusinessLinePage
          businessKey="公司注册"
          label="公司注册"
          accentHue={260}
          description="11步并行推进：Bam收资料发Pop注册DBD，Pop/Eve/fern/Bam各管一段，互不阻塞。VAT注册、银行开户、地址服务、做账报税、公司变更全部可以在同一套流程里跟进。"
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{tabs.find(t => t.key === activeTab)?.label}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">该功能暂未开放</p>
        </div>
      )}
    </div>
  );
}
