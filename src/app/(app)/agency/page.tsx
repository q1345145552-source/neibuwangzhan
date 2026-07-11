"use client";

import Link from "next/link";
import { Users, FileSignature, Factory } from "lucide-react";

const cards = [
  {
    title: "达人管理",
    desc: "TikTok 达人库，评估、筛选、跟进、签约全流程",
    href: "/agency/influencers",
    icon: Users,
    color: "from-pink-500 to-rose-500",
  },
  {
    title: "签约跟进",
    desc: "已签约达人的合同、佣金、付款状态一目了然",
    href: "/agency/contracts",
    icon: FileSignature,
    color: "from-blue-500 to-indigo-500",
  },
  {
    title: "工厂管理",
    desc: "合作工厂信息库，擅长品类、起订量、联系人",
    href: "/agency/factories",
    icon: Factory,
    color: "from-amber-500 to-orange-500",
  },
];

export default function AgencyPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">
          机构管理
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          达人孵化 · 签约跟进 · 供应链工厂
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="group relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 transition-all duration-200 hover:shadow-lg hover:border-[var(--ring)]"
          >
            <div
              className={`absolute right-0 top-0 h-24 w-24 translate-x-6 -translate-y-6 rounded-full bg-gradient-to-br ${card.color} opacity-10 transition-opacity group-hover:opacity-20`}
            />
            <div className="relative flex flex-col gap-3">
              <div className={`flex size-10 items-center justify-center rounded-lg bg-gradient-to-br ${card.color}`}>
                <card.icon className="size-5 text-white" />
              </div>
              <div>
                <h2 className="font-medium text-[var(--foreground)]">{card.title}</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{card.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
