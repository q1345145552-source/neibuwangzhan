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

      {activeTab === "company-reg" && (
        <BusinessLinePage
          businessKey="公司注册"
          label="新公司注册"
          accentHue={260}
          description="帮客户在泰国落地公司，从核名到开户一条龙。最近公司注册这块挺忙的，有好几个客户同时在跑。"
        />
      )}
      {activeTab !== "company-reg" && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{tabs.find(t => t.key === activeTab)?.label} 开发中</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">即将支持独立进度跟踪</p>
        </div>
      )}
    </div>
  );
}
