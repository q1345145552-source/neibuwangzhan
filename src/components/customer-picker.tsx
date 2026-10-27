"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { cn } from "@/lib/utils";

export type PoolCustomer = { id: number; company_name: string; handler_name?: string };

/** 客户管理里有没有这个名字（前后空格不算，大小写要一样，跟接口的比法一致） */
export function isKnownCustomer(pool: readonly PoolCustomer[], name: string): boolean {
  const n = name.trim();
  return !!n && pool.some(c => c.company_name.trim() === n);
}

/** 订单页能当场新建客户的人：员工、管理员（2026-10-27 起）；客户账号不行，跟接口 order-customer.ts 一致 */
export function canCreateOrderCustomer(role: string | undefined): boolean {
  return role === "admin" || role === "employee";
}

/** 客户名没从下拉里选时的提示：能新建的叫他点「新建客户」，不能的请管理员先建 */
export function pickCustomerHint(canCreate: boolean): string {
  return "客户要从下拉里选客户管理里的客户" + (canCreate ? "，没有的点「新建客户」" : "；客户管理里还没有的，请管理员先新建");
}

/**
 * 下拉名单外的名字去客户管理里核对一下：员工只看得到没人认领的和自己认领的客户，同事认领的打全名也算数。
 * 只回答有没有；查不了（断网等）当作没有，交给接口最后把关。
 */
export async function customerExists(name: string): Promise<boolean> {
  const n = name.trim();
  if (!n) return false;
  try {
    const r = await fetchWithAuth(`/api/orders/customer-check?name=${encodeURIComponent(n)}`);
    return r.ok && !!((await r.json()) as { exists?: boolean }).exists;
  } catch (e) {
    console.error("[客户] 核对客户名失败", e);
    return false;
  }
}

/**
 * 订单的客户名称：从「客户管理」里选（2026-10-16 老板选 2A）。打字是用来搜的；
 * 客户管理里没有的，员工、管理员都可以点「新建客户」（2026-10-27 起），跟订单一起保存；其他账号提示先请管理员建。
 */
export function CustomerPicker({ id, value, isNew, onChange, pool, canCreate, keep, className }: {
  id?: string;
  /** 改单时原来的客户名：没改就照旧保存（老单的名字可能不在客户管理里） */
  keep?: string;
  value: string;
  isNew: boolean;
  onChange: (name: string, isNew: boolean) => void;
  pool: readonly PoolCustomer[];
  canCreate: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const text = value.trim();
  const inPool = isKnownCustomer(pool, value) || (!!keep && text === keep.trim());
  // 名单里没有的全名，停手半秒后去客户管理里核对（同事认领的客户）
  useEffect(() => {
    if (!text || inPool) return;
    let ignore = false;
    const t = setTimeout(() => { customerExists(text).then(ok => { if (!ignore && ok) setFound(text); }).catch(() => {}); }, 400);
    return () => { ignore = true; clearTimeout(t); };
  }, [text, inPool]);
  const known = inPool || found === text;
  // 只差大小写的已经在名单里：让人选那一条，不给「新建客户」
  const similar = !known && pool.some(c => c.company_name.trim().toLowerCase() === text.toLowerCase());
  const matches = pool.filter(c => !text || c.company_name.toLowerCase().includes(text.toLowerCase())).slice(0, 20);
  return (
    <div className="relative">
      <div className="relative">
        <input id={id} value={value} autoComplete="off" placeholder="输入客户名搜索，从下拉里选"
          onChange={e => onChange(e.target.value, false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          aria-invalid={!!text && !known && !isNew}
          className={cn("h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 pr-8 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]",
            !!text && !known && !isNew && "border-[var(--destructive)]", className)} />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
      </div>
      {open && (matches.length > 0 || (text && !known)) && (
        <div className="absolute left-0 right-0 top-[44px] z-30 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-xl">
          {matches.map(c => (
            <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); onChange(c.company_name, false); setOpen(false); }}
              className="flex w-full items-center justify-between border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--muted)]">
              <span>{c.company_name}</span>
              {c.handler_name && <span className="text-xs text-[var(--muted-foreground)]">{c.handler_name}</span>}
            </button>
          ))}
          {text && !known && !similar && (canCreate ? (
            <button type="button" onMouseDown={e => { e.preventDefault(); onChange(text, true); setOpen(false); }}
              className="w-full px-3 py-2 text-left text-sm font-medium text-[var(--primary)] hover:bg-[var(--muted)]">
              + 新建客户「{text}」
            </button>
          ) : (
            <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">客户管理里没有「{text}」，请管理员先在客户管理里新建</p>
          ))}
        </div>
      )}
      {!isKnownCustomer(pool, value) && found === text && <p className="mt-1 text-xs text-[var(--muted-foreground)]">客户管理里有这个客户（同事认领的）</p>}
      {similar && <p className="mt-1 text-xs text-[var(--destructive)]">客户管理里已有大小写不同的同名客户，请从下拉里选它</p>}
      {isNew && text && !known && !similar && <p className="mt-1 text-xs text-[var(--info)]">会新建客户「{text}」，跟订单一起保存</p>}
      {!!text && !known && !isNew && !similar && <p className="mt-1 text-xs text-[var(--destructive)]">要从下拉里选客户管理里的客户{canCreate ? "，没有的点「新建客户」" : ""}</p>}
    </div>
  );
}
