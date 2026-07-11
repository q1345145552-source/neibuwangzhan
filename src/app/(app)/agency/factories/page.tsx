"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus } from "lucide-react";

interface Factory {
  id: number;
  name: string;
  category: string;
  moq: string;
  contact: string;
  contact_phone: string;
  address: string;
  notes: string;
  created_at: string;
}

export default function FactoriesPage() {
  const [factories, setFactories] = useState<Factory[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/factories", { cache: "no-store" });
      const data = await res.json();
      setFactories(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filtered = factories.filter((f) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return f.name.toLowerCase().includes(s) || f.category.toLowerCase().includes(s) || f.contact.toLowerCase().includes(s);
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">工厂管理</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            共 {factories.length} 家工厂
          </p>
        </div>
        <Button size="sm"><Plus className="size-3.5" />添加工厂</Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input placeholder="搜索工厂名称、品类..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-8 text-sm" />
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中...</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">工厂名称</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">擅长品类</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-md:hidden">最小起订量</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">联系人</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">联系方式</th>
                <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] max-lg:hidden">地址</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="border-b border-[var(--border)] hover:bg-[var(--secondary)] transition-colors">
                  <td className="py-3 px-4 font-medium text-[var(--foreground)]">{f.name}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{f.category || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-md:hidden">{f.moq || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{f.contact || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{f.contact_phone || "-"}</td>
                  <td className="py-3 px-4 text-[var(--muted-foreground)] max-lg:hidden">{f.address || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">暂无工厂数据</div>
          )}
        </div>
      )}
    </div>
  );
}
