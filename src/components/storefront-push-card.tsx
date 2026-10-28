"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Globe, Loader2, Search, Send, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStorefrontCustomer, fetchStorefrontPush, pushOrderToStorefront, searchStorefrontCustomers, type StorefrontAccount, type StorefrontPushState } from "@/lib/api";
import { useLeaveGuard } from "@/lib/use-leave-guard";

/** 复制到剪贴板；浏览器不让复制（http 访问等）就返回 false，界面上的文字可以手动选中复制 */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function randomPassword(): string {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

function accountLine(a: Pick<StorefrontAccount, "name" | "phone" | "email" | "group_name">): string {
  return a.group_name ? `${a.group_name}（${a.phone || a.email}）` : [a.name, a.phone, a.email].filter(Boolean).join(" · ");
}

/**
 * 业务系统（2026-10-22 老板选 B）：员工在内部录的线下单，推到客户在业务系统的账号下；
 * 推过去后显示客户链接，复制发给客户，客户点开、登录后直接看到这张单的进度和账单。
 * 2026-10-28 起新建订单时选了客户账号就自动推过去；这里只剩老单（或建单时没推过去的）要手动推，员工都能推。
 * 客户网上下的单本来就在业务系统里，也能复制链接。
 */
export function StorefrontPushCard({ orderId, canPush, onPushed }: { orderId: string; canPush: boolean; onPushed: (newId: string) => void }) {
  const [state, setState] = useState<StorefrontPushState | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    fetchStorefrontPush(orderId)
      .then(d => { if (alive) setState(d); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "取业务系统信息失败"); });
    return () => { alive = false; };
  }, [orderId]);
  useEffect(() => load(), [load]);

  if (error) return <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--muted-foreground)]">业务系统：{error}</div>;
  if (!state) return null;

  if (state.linked) {
    const link = state.link;
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="mb-2 flex items-center gap-2">
          <Globe className="size-4 shrink-0 text-[var(--muted-foreground)]" />
          <h3 className="shrink-0 text-sm font-medium">业务系统</h3>
        </div>
        <p className="mb-1 break-all text-xs text-[var(--muted-foreground)]">单号：<span className="font-mono">{state.source_order_no}</span></p>
        {state.customer && <p className="mb-2 break-all text-xs text-[var(--muted-foreground)]">客户：{state.customer.name}{state.customer.login && <>，登录账号 <span className="font-mono">{state.customer.login}</span></>}</p>}
        {link ? (
          <>
            <input readOnly value={link} onFocus={e => e.target.select()} className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--muted)] px-2 py-1 font-mono text-xs outline-none" />
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={async () => {
              if (await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
              else window.alert("浏览器不让自动复制，请选中上面的链接手动复制");
            }}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制客户链接"}
            </Button>
            <p className="mt-1.5 text-[0.7rem] text-[var(--muted-foreground)]">发给客户，客户点开、登录后直接看到这张单的进度和账单。客户忘了密码：在业务系统后台「客户列表」里重置。</p>
          </>
        ) : <p className="text-xs text-[var(--muted-foreground)]">没有配置业务系统地址，生成不了客户链接</p>}
      </div>
    );
  }

  if (!canPush || (!state.can_push && !state.reason)) return null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <Globe className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        <h3 className="shrink-0 text-sm font-medium">业务系统</h3>
      </div>
      {state.can_push ? (
        <>
          <p className="mb-3 text-xs text-[var(--muted-foreground)]">这张单还没推到业务系统，客户看不到。推过去以后，客户登录业务系统能看到进度和账单，能传付款水单。</p>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Send className="size-3.5" />推到业务系统</Button>
        </>
      ) : <p className="text-xs text-[var(--muted-foreground)]">推不了：{state.reason}</p>}
      {open && <PushDialog orderId={orderId} state={state} onClose={() => setOpen(false)} onPushed={onPushed} />}
    </div>
  );
}

function PushDialog({ orderId, state, onClose, onPushed }: {
  orderId: string;
  state: Extract<StorefrontPushState, { linked: false }>;
  onClose: () => void;
  onPushed: (newId: string) => void;
}) {
  const [mode, setMode] = useState<"search" | "create">("search");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StorefrontAccount[]>([]);
  const [searching, setSearching] = useState(false);
  // 这张单的客户名称就是某个账号的客户群名：直接选上那个账号，不能换（2026-10-28）
  const fixedAccount = state.account ?? null;
  const [account, setAccount] = useState<StorefrontAccount | null>(fixedAccount);
  const [newAccount, setNewAccount] = useState({ login: "", group_name: "", password: randomPassword() });
  const [createdPassword, setCreatedPassword] = useState("");
  const [groupWarning, setGroupWarning] = useState("");
  const [title, setTitle] = useState(state.prefill.title);
  const [amount, setAmount] = useState(state.prefill.amount != null ? String(state.prefill.amount) : "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<{ id: string; source_order_no: string; link: string | null; pending: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [handedOut, setHandedOut] = useState(false);
  useLeaveGuard(!!createdPassword && !handedOut);

  useEffect(() => {
    if (mode !== "search" || account) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchStorefrontCustomers(q.trim())
        .then(list => { if (alive) { setResults(list); setMessage(""); } })
        .catch(e => { if (alive) setMessage(e instanceof Error ? e.message : "查客户账号失败"); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, mode, account]);

  const createAccount = async () => {
    setBusy(true); setMessage("");
    try {
      const created = await createStorefrontCustomer({ login: newAccount.login.trim(), group_name: newAccount.group_name.trim(), password: newAccount.password });
      setAccount(created);
      setCreatedPassword(newAccount.password);
      setGroupWarning(created.group_warning || "");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "建客户账号失败");
    } finally { setBusy(false); }
  };

  const amountValue = Number(amount);
  const amountOk = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;
  const push = async () => {
    if (!account || !amountOk) return;
    const ask = `推给「${accountLine(account)}」，金额 ${amountValue} 人民币？\n推了以后客户就能在业务系统看到这张单和账单，这张单的编号会换成业务系统的单号。`;
    if (!window.confirm(ask)) return;
    setBusy(true); setMessage("");
    try {
      setDone(await pushOrderToStorefront(orderId, { customer_id: account.id, amount: amountValue, title: title.trim() }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "推单失败");
    } finally { setBusy(false); }
  };

  // 刚建的账号，初始密码只在这个弹窗里有：没复制就关，先提醒一句
  const finish = () => {
    if (busy) return;
    if (createdPassword && !handedOut && !window.confirm(`客户的初始密码是 ${createdPassword}，关掉以后这里就看不到了。\n记下来、或者已经手动复制了再关；忘了也可以在业务系统后台「客户列表」里重置密码。确定关掉？`)) return;
    if (done) onPushed(done.id); else onClose();
  };
  const loginName = account ? (account.phone || account.email) : "";
  const handout = done?.link ? [`订单链接：${done.link}`, createdPassword ? `登录账号：${loginName}` : "", createdPassword ? `初始密码：${createdPassword}` : ""].filter(Boolean).join("\n") : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={finish}>
      <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-[var(--background)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-medium">{done ? "已推到业务系统" : "推到业务系统"}</h2>
          <button onClick={finish} disabled={busy} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
        </div>

        {done ? (
          <div className="space-y-3 p-5 text-sm">
            <p>这张单在业务系统的单号是 <span className="font-mono">{done.source_order_no}</span>，内部的编号也换成了这个号。</p>
            {done.pending && <p className="text-xs text-[oklch(0.40_0.14_85)]">业务系统那边刚才没连上，会自动补建，一般几分钟内客户就能看到这张单。</p>}
            {handout ? (
              <>
                <p className="text-xs text-[var(--muted-foreground)]">把下面的内容发给客户{createdPassword ? "（初始密码只在这里显示一次）" : ""}：</p>
                <textarea readOnly value={handout} rows={handout.split("\n").length} onFocus={e => e.target.select()}
                  className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 font-mono text-xs outline-none" />
                <Button size="sm" variant="outline" className="gap-1" onClick={async () => {
                  if (await copyText(handout)) { setCopied(true); setHandedOut(true); setTimeout(() => setCopied(false), 2000); }
                  else window.alert("浏览器不让自动复制，请选中上面的内容手动复制");
                }}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制"}</Button>
              </>
            ) : <p className="text-xs text-[var(--muted-foreground)]">没有配置业务系统地址，生成不了客户链接</p>}
            <div className="flex justify-end"><Button size="sm" onClick={finish}>完成</Button></div>
          </div>
        ) : (
          <div className="space-y-4 p-5 text-sm">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">客户在业务系统的账号</span>
                {!account && !fixedAccount && (
                  <button className="text-xs text-[var(--primary)] hover:underline" onClick={() => { setMode(mode === "search" ? "create" : "search"); setMessage(""); }}>
                    {mode === "search" ? "客户还没有账号，开一个" : "已有账号，去搜"}
                  </button>
                )}
              </div>
              {account ? (
                <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-xs">
                  <span className="flex-1">{accountLine(account)}{createdPassword && <span className="ml-1 text-[var(--muted-foreground)]">（刚建，初始密码 {createdPassword}）</span>}</span>
                  {!createdPassword && !fixedAccount && <button className="text-[var(--primary)] hover:underline" onClick={() => setAccount(null)}>换一个</button>}
                </div>
              ) : mode === "search" ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="搜客户群名、登录名或手机号" className="pl-7" autoFocus />
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border)]">
                    {searching && results.length === 0 ? <p className="p-3 text-xs text-[var(--muted-foreground)]"><Loader2 className="mr-1 inline size-3 animate-spin" />查找中…</p>
                      : results.length === 0 ? <p className="p-3 text-xs text-[var(--muted-foreground)]">没有找到，可以点右上角新建账号</p>
                      : results.map(a => (
                        <button key={a.id} onClick={() => setAccount(a)} className="block w-full border-b border-[var(--border)] px-3 py-2 text-left text-xs last:border-b-0 hover:bg-[var(--muted)]">{accountLine(a)}</button>
                      ))}
                  </div>
                </>
              ) : (
                <div className="space-y-2 rounded-md border border-[var(--border)] p-3">
                  <Input value={newAccount.login} onChange={e => setNewAccount({ ...newAccount, login: e.target.value })} placeholder="登录名：手机号、邮箱，或字母开头的字母数字（客户用它登录）" />
                  <Input value={newAccount.group_name} onChange={e => setNewAccount({ ...newAccount, group_name: e.target.value })} placeholder="客户群名（只有内部看得到）" />
                  <Input value={newAccount.password} onChange={e => setNewAccount({ ...newAccount, password: e.target.value })} placeholder="初始密码（至少 6 位）" />
                  <Button size="sm" variant="outline" className="gap-1" disabled={busy || !newAccount.login.trim() || !newAccount.group_name.trim() || newAccount.password.length < 6} onClick={createAccount}>
                    <UserPlus className="size-3.5" />建账号
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-1">
              <span className="text-xs font-medium">客户看到的服务名</span>
              <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} />
            </section>

            <section className="space-y-1">
              <span className="text-xs font-medium">金额（人民币）</span>
              <Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="客户账单上的金额" />
              {state.original.currency !== "CNY" && (
                <p className="text-[0.7rem] text-[oklch(0.40_0.14_85)]">这张单原来是 {state.original.amount} {state.original.currency}，业务系统只收人民币，请换算成人民币填进来；推过去以后内部这张单的金额也变成这个人民币金额。</p>
              )}
            </section>

            {groupWarning && <p className="text-xs text-[oklch(0.40_0.14_85)]">{groupWarning}</p>}
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">推过去以后，客户在业务系统能看到这张单的进度和账单，能传付款水单；收到钱后在「客户付款」里点确认收款。这张单的编号会换成业务系统的单号。</p>
            {message && <p className="text-xs text-[var(--destructive)]">{message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={finish} disabled={busy}>取消</Button>
              <Button size="sm" className="gap-1.5" onClick={push} disabled={busy || !account || !amountOk || !title.trim()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}确认推送
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
