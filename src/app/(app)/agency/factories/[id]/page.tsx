"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const statusClass: Record<string, string> = {
  "待评估": "bg-gray-100 text-gray-700",
  "已签约": "bg-emerald-100 text-emerald-700",
  "品牌孵化中": "bg-cyan-100 text-cyan-700",
  "已完成": "bg-green-100 text-green-700",
  "已停止": "bg-red-100 text-red-700",
};

interface FactoryInfluencer {
  id: number;
  influencer_id: number;
  influencer_name: string;
  tiktok_link: string;
  influencer_status: string;
  relationship: string;
  notes: string;
  created_at: string;
}

interface Factory {
  id: number;
  name: string;
  category: string;
  moq: string;
  contact: string;
  contact_phone: string;
  address: string;
  notes: string;
  influencers: FactoryInfluencer[];
}

export default function FactoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [factory, setFactory] = useState<Factory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/factories/${id}`, { cache: "no-store" })
      .then(r => r.json())
      .then(setFactory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="py-20 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>;
  if (!factory) return <div className="py-20 text-center text-sm text-[var(--destructive)]">工厂不存在</div>;

  const influencers = factory.influencers || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => router.push("/agency/factories")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">{factory.name}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {[factory.category, factory.moq ? `MOQ: ${factory.moq}` : "", factory.address]
              .filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      {/* Factory info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h3 className="text-sm font-medium text-[var(--foreground)]">基本信息</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">擅长品类</dt><dd>{factory.category || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">最小起订量</dt><dd>{factory.moq || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">联系人</dt><dd>{factory.contact || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">联系方式</dt><dd>{factory.contact_phone || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-[var(--muted-foreground)]">地址</dt><dd>{factory.address || "-"}</dd></div>
          </dl>
          {factory.notes && <p className="mt-3 text-xs text-[var(--muted-foreground)]">{factory.notes}</p>}
        </div>

        {/* Linked influencers */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h3 className="text-sm font-medium text-[var(--foreground)]">
            合作达人 ({influencers.length})
          </h3>
          {influencers.length > 0 ? (
            <div className="mt-3 space-y-2">
              {influencers.map((inf) => (
                <div key={inf.id} className="flex items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link href={`/agency/influencers/${inf.influencer_id}`} className="font-medium text-[var(--foreground)] hover:underline truncate">
                      {inf.influencer_name}
                    </Link>
                    {inf.tiktok_link && (
                      <a href={inf.tiktok_link} target="_blank" rel="noopener noreferrer" className="text-[var(--muted-foreground)] shrink-0">
                        <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", statusClass[inf.influencer_status] || "bg-gray-100")}>
                      {inf.influencer_status}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">{inf.relationship}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">暂无合作达人</p>
          )}
        </div>
      </div>
    </div>
  );
}
