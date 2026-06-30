"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "shopee", label: "Shopee Mall", href: "/mall-store" },
  { key: "tiktok", label: "TikTok Mall", href: "/mall-store/tiktok" },
  { key: "lazada", label: "Lazada Mall", href: "/mall-store/lazada" },
];

export default function MallStorePage() {
  const pathname = usePathname();
  const isSubPage = pathname !== "/mall-store";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>Mall开店</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          三大平台一站式代开店——Shopee、TikTok、Lazada。每家店流程不一样，Shopee最复杂（9步+15天等待），TikTok要1万粉丝，Lazada要先有FDA/TISI认证。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              (!isSubPage && tab.key === "shopee") || (isSubPage && pathname === tab.href)
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
          businessKey="Mall开店"
          label="Shopee Mall"
          accentHue={340}
          description="Shopee Mall开店——从收资料到店铺上线，Bam和Fern负责前端，Pop管缴费。1家公司最多开5家店，套餐费约32,000泰铢。"
        />
      )}
    </div>
  );
}
