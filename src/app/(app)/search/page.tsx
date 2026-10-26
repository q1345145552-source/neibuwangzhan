"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { fileUrl } from "@/lib/utils";
import type { WorkspaceGroup } from "@/lib/workspace-types";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<{query:string; groups:WorkspaceGroup[]; error:string}>({query:"",groups:[],error:""});
  const keyword = query.trim();
  useEffect(() => {
    if (!keyword) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`/api/search?q=${encodeURIComponent(keyword)}`, {cache:"no-store",signal:controller.signal});
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "搜索失败，请重试");
        if (!controller.signal.aborted) setResponse({query:keyword,groups:data,error:""});
      } catch (error) {
        if (!controller.signal.aborted) setResponse({query:keyword,groups:[],error:error instanceof Error ? error.message : "搜索失败，请重试"});
      }
    },250);
    return () => { clearTimeout(timer); controller.abort(); };
  },[keyword]);
  const ready = keyword === response.query;
  const groups = ready && keyword ? response.groups.filter(g=>g.items.length) : [];
  return <div className="flex min-w-0 flex-col gap-6">
    <div><h1 className="font-display text-2xl font-light">全局搜索</h1><p className="mt-1 text-sm text-[var(--muted-foreground)]">搜索订单、文档、会议、日报、待办、客户和上传文件</p></div>
    <label className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 focus-within:border-[var(--primary)]">
      <Search aria-hidden="true" className="size-5 shrink-0 text-[var(--muted-foreground)]" />
      <input autoFocus type="search" aria-label="搜索系统资料" placeholder="输入关键词搜索…" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none" />
    </label>
    <div role="status" aria-live="polite" className="text-sm text-[var(--muted-foreground)]">
      {!keyword ? "输入关键词，即可搜索你有权查看的资料" : !ready ? "搜索中…" : response.error || (groups.length ? `找到 ${groups.reduce((n,g)=>n+g.items.length,0)} 条相关结果` : "没有找到相关结果")}
    </div>
    {groups.map(group=><section key={group.type} aria-label={group.label} className="min-w-0 rounded-xl border border-[var(--border)]">
      <h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">{group.label}<span className="ml-2 text-sm text-[var(--muted-foreground)]">{group.items.length}</span></h2>
      <ul className="divide-y divide-[var(--border)]">{group.items.map(item=><li key={item.id}>
        {item.type === "files" ? <a href={fileUrl(item.href)} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 hover:bg-[var(--muted)]"><span className="block break-words text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">打开文件 · {item.time.slice(0,10)}</span></a> : <Link href={item.href} className="block px-4 py-3 hover:bg-[var(--muted)]"><span className="block break-words text-sm font-medium">{item.title}</span><span className="mt-1 block line-clamp-2 break-words text-xs text-[var(--muted-foreground)]">{item.summary} · {item.time.slice(0,10)}</span></Link>}
      </li>)}</ul>
    </section>)}
  </div>;
}
