"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { StoreLedgerTab } from "./stores-tab";
import { SimTab } from "./sim-tab";

type ShopeeTab = "stores" | "sim";

export default function ShopeePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<ShopeeTab>("stores");

  if (user?.role === "client") {
    return (
      <div className="py-16 text-center text-sm text-[var(--muted-foreground)]">
        你没有权限访问该页面
      </div>
    );
  }

  const tabs: { key: ShopeeTab; label: string }[] = [
    { key: "stores", label: "店铺台账" },
    { key: "sim", label: "SIM卡" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/internal"><Button variant="ghost" size="icon-sm"><ArrowLeft className="size-4" /></Button></Link>
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">Shopee店铺管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">店铺台账 · SIM卡管理</p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="inline-flex w-fit rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded px-4 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >{t.label}</button>
        ))}
      </div>

      {tab === "stores" ? <StoreLedgerTab /> : <SimTab />}
    </div>
  );
}
