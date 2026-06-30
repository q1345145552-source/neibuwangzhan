"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { BusinessLinePage } from "@/components/dashboard/business-line-page";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "product", label: "产品认证", href: "/dld" },
  { key: "site", label: "场地确认", href: "/dld/site" },
];

export default function DldPage() {
  const pathname = usePathname();
  const isSubPage = pathname !== "/dld";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>DLD</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          陆运厅认证，汽车配件和整车都归这儿管。产品认证走Ing和Bam，场地确认暂时还没专人负责。
        </p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "rounded-md px-3.5 py-1.5 text-sm font-medium transition-all",
              (!isSubPage && tab.key === "product") || (isSubPage && pathname === tab.href)
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
          businessKey="DLD"
          label="产品认证"
          accentHue={10}
          description="汽车零配件的DLD产品认证，Ing整理材料、Bam提交审批。审批过不过看官员心情，别忘了现场检查要提前准备货架和合规标识。"
        />
      )}
    </div>
  );
}
