"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "cosmetics", label: "化妆品认证", href: "/fda-certification" },
  { key: "food", label: "食品认证", href: "/fda-certification/food" },
  { key: "hazard", label: "危险品认证", href: "/fda-certification/hazard" },
  { key: "medical", label: "医疗器械认证", href: "/fda-certification/medical" },
];

export default function FdaCertificationPage() {
  const pathname = usePathname();
  const isSubPage = pathname !== "/fda-certification";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>FDA认证</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          医疗器械和食品的FDA认证——门槛高、周期长，但利润也高。510(k)和产品列名是我们主要做的两类，技术文档是关键。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              (!isSubPage && tab.key === "cosmetics") || (isSubPage && pathname === tab.href)
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {!isSubPage && (
        <BusinessLinePage
          businessKey="FDA产品认证"
          label="化妆品认证"
          accentHue={155}
          description="化妆品FDA认证，从收集工厂文件到拿证，全程跟。文件齐全的话最快7天出证。"
        />
      )}
    </div>
  );
}
