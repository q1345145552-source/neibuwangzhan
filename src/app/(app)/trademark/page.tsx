"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "tm-reg", label: "TM标注册", href: "/trademark" },
  { key: "international", label: "国际商标", href: "/trademark/international" },
  { key: "buy-r", label: "购买R标", href: "/trademark/buy-r" },
];

export default function TrademarkPage() {
  const pathname = usePathname();
  const isSubPage = pathname !== "/trademark";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>商标</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          商标检索、申请、续展全搞定。第35类和第42类问得最多，记得提醒客户提前准备使用证据。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              (!isSubPage && tab.key === "tm-reg") || (isSubPage && pathname === tab.href)
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
          businessKey="商标"
          label="TM标注册"
          accentHue={30}
          description="检索查重、分类申请、一路到拿TM标。第35类和第42类问得最多，记得提醒客户提前准备商标使用证据。"
        />
      )}
    </div>
  );
}
