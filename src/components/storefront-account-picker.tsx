"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchStorefrontAccounts, type StorefrontAccount } from "@/lib/api";
import { OpenCustomerAccountDialog } from "@/components/storefront-account-dialog";

/** 客户登录用的账号：手机号，没有就是邮箱 / 登录名 */
export function accountLoginOf(a: Pick<StorefrontAccount, "phone" | "email">): string {
  return a.phone || a.email;
}

function accountLabel(a: StorefrontAccount): string {
  const login = accountLoginOf(a);
  return a.group_name ? `${a.group_name}（${login}）` : [a.name, login].filter(Boolean).join(" · ");
}

/**
 * 新建订单选客户（2026-10-28 老板：订单直接挂到客户在业务系统的账号下）：
 * 按客户群名、登录名、手机号搜客户账号；没有就当场开一个（登录名、客户群名、初始密码），开好直接选上。
 * 选了还没有客户群名的老账号，要补一个群名（只有内部看得到）。
 */
export function StorefrontAccountPicker({ account, onAccount, groupName, onGroupName }: {
  account: StorefrontAccount | null;
  onAccount: (a: StorefrontAccount | null) => void;
  groupName: string;
  onGroupName: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StorefrontAccount[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (account) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchStorefrontAccounts(q.trim())
        .then(r => { if (alive) { setResults(r.customers); setWarning(r.warning || ""); setMessage(""); } })
        .catch(e => { if (alive) { setResults([]); setWarning(""); setMessage(e instanceof Error ? e.message : "查客户账号失败"); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, account]);

  if (account) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-sm">
          <span className="flex-1 break-all">{accountLabel(account)}</span>
          <button type="button" className="shrink-0 text-xs text-[var(--primary)] hover:underline" onClick={() => { onAccount(null); onGroupName(""); }}>换一个</button>
        </div>
        {!account.group_name && (
          <div className="space-y-1">
            <Input value={groupName} onChange={e => onGroupName(e.target.value)} placeholder="这个账号还没有客户群名，补一个（只有内部看得到）" />
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">以后按这个名字就能找到这个客户</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="搜客户群名、登录名或手机号" className="h-10 pl-8" />
        </div>
        <button type="button" onClick={() => setCreating(true)} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 text-sm font-medium hover:bg-[var(--muted)]">
          <UserPlus className="size-3.5" />开新客户账号
        </button>
      </div>
      {warning && <p className="text-xs text-[oklch(0.40_0.14_85)]">{warning}</p>}
      <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--border)]">
        {searching && results.length === 0 ? <p className="p-3 text-xs text-[var(--muted-foreground)]"><Loader2 className="mr-1 inline size-3 animate-spin" />查找中…</p>
          : message ? <p className="p-3 text-xs text-[var(--destructive)]">{message}</p>
          : results.length === 0 ? <p className="p-3 text-xs text-[var(--muted-foreground)]">没有找到。新客户点「开新客户账号」</p>
          : results.map(a => (
            <button type="button" key={a.id} onClick={() => { onAccount(a); onGroupName(""); }} className="block w-full border-b border-[var(--border)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--muted)]">
              {accountLabel(a)}{!a.group_name && <span className="ml-1 text-xs text-[var(--muted-foreground)]">（还没有客户群名）</span>}
            </button>
          ))}
      </div>
      {/* 挂到 body 上：弹框在建单表单里面，里面的按钮不能当成「提交订单」 */}
      {creating && createPortal(<OpenCustomerAccountDialog initialGroupName={q.trim()} onClose={() => setCreating(false)}
        onCreated={created => { setCreating(false); onAccount(created); onGroupName(""); }} />, document.body)}
    </div>
  );
}
