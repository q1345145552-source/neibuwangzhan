"use client";

import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function NbtcPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>NBTC</h1>
        <p className="mt-1.5 text-sm text-[var(--muted-foreground)] leading-relaxed">
          泰国广播和电信委员会认证，无线通信设备进泰国市场的准入许可。12步走完，Fern一个人盯下来。
        </p>
      </div>

      <BusinessLinePage
        businessKey="NBTC"
        label="NBTC认证"
        accentHue={260}
        description="NBTC认证流程和TISI几乎一模一样，从收产品图到拿证要3-4个月。最磨人的还是等检测结果那30-60天。"
      />
    </div>
  );
}
