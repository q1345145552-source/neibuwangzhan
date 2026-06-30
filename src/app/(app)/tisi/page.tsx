"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "tisi-main", label: "TISI认证", href: "/tisi" },
  { key: "nbtc", label: "NBTC认证", href: "/tisi/nbtc" },
];

export default function TisiPage() {
  const pathname = usePathname();
  const isSubPage = pathname !== "/tisi";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>TISI</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          泰国工业标准认证，电子产品进泰国市场的通行证。整套流程走下来得3-4个月，Fern一个人从头盯到尾。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              (!isSubPage && tab.key === "tisi-main") || (isSubPage && pathname === tab.href)
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
          businessKey="TISI"
          label="TISI认证"
          accentHue={240}
          description="从收产品图到拿证，整套流程 Fern 一个人盯下来。最磨人的是等检测结果那30-60天，记得提前给客户打好预防针。"
        />
      )}
    </div>
  );
}
