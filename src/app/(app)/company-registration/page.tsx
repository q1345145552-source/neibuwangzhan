"use client";

import { useState } from "react";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { companySubServices } from "@/lib/constants";
import { cn } from "@/lib/utils";

// 「全部」放第一个；每个标签只列自己那类单。新公司注册含没选具体服务的老单（它们走的就是这套流程）。
// 原来除「新公司注册」外都写着「该功能暂未开放」，其实客户站一直有这几类单，都混在新公司注册里（2026-10-15）
const tabs = [{ key: "all", label: "全部" }, ...companySubServices];

export default function CompanyRegistrationPage() {
  const [activeTab, setActiveTab] = useState(tabs[0].key);
  const active = tabs.find(t => t.key === activeTab);

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

      <BusinessLinePage
        key={activeTab}
        businessKey="公司注册"
        label={activeTab === "all" ? "公司注册" : active?.label || "公司注册"}
        accentHue={260}
        description={activeTab === "all"
          ? "11步并行推进：Bam收资料发Pop注册DBD，Pop/Eve/fern/Bam各管一段，互不阻塞。VAT注册、银行开户、地址服务、做账报税、公司变更全部可以在同一套流程里跟进。"
          : activeTab === "change" ? "公司变更单独一套流程：收齐变更资料、递交官方办理、办结交付客户。"
          : `只列「${active?.label}」的单。`}
        subServiceTypes={activeTab === "all" ? undefined : activeTab === "company-reg" ? ["company-reg", ""] : [activeTab]}
      />
    </div>
  );
}
