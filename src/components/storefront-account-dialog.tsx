"use client";

import { useState } from "react";
import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createStorefrontCustomer, type StorefrontAccount } from "@/lib/api";
import { useLeaveGuard } from "@/lib/use-leave-guard";

/** 复制到剪贴板；浏览器不让复制（http 访问等）就返回 false，界面上的文字可以手动选中复制 */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function randomPassword(): string {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

/**
 * 订单管理页「开客户账号」（2026-10-26 老板选 A：没有订单也能直接给客户开业务系统账号）：只给管理员。
 * 开好后把登录网址、账号、初始密码发给客户；以后推单时在「推到业务系统」里搜名字或手机号就能选到这个账号。
 */
export function OpenCustomerAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium transition-all hover:bg-[var(--muted)]">
        <UserPlus className="size-3.5" aria-hidden="true" />开客户账号
      </button>
      {open && <OpenCustomerAccountDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function OpenCustomerAccountDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: randomPassword() });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<(StorefrontAccount & { login_url?: string | null; password: string }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [handedOut, setHandedOut] = useState(false);
  useLeaveGuard(!!done && !handedOut);

  const create = async () => {
    setBusy(true); setMessage("");
    try {
      const account = await createStorefrontCustomer(form);
      setDone({ ...account, password: form.password });
    } catch (e) {
      const text = e instanceof Error ? e.message : "开账号失败";
      const what = text.includes("邮箱") ? "邮箱" : "手机号";
      setMessage(text.includes("已经有账号")
        ? `这个${what}已经开过账号了，不用再开。推单时在「推到业务系统」里搜这个${what}就能选到；搜不到的话，可能是账号被停用了，到业务系统后台「客户列表」看一下。`
        : text);
    } finally { setBusy(false); }
  };

  // 初始密码只在这里显示一次：开好了还没复制就关，先提醒一句
  const close = () => {
    if (busy) return;
    if (done && !handedOut && !window.confirm(`客户的初始密码是 ${done.password}，关掉以后这里就看不到了。\n记下来、或者已经手动复制了再关；忘了也可以在业务系统后台「客户列表」里重置密码。确定关掉？`)) return;
    onClose();
  };

  const loginName = done ? (done.phone || done.email) : "";
  const handout = done ? [done.login_url ? `登录网址：${done.login_url}` : "", `登录账号：${loginName}`, `初始密码：${done.password}`].filter(Boolean).join("\n") : "";
  const ready = form.name.trim() && (form.phone.trim() || form.email.trim()) && form.password.length >= 6;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-[var(--background)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-medium">{done ? "客户账号已开好" : "开客户账号"}</h2>
          <button onClick={close} disabled={busy} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
        </div>

        {done ? (
          <div className="space-y-3 p-5 text-sm">
            <p>{done.name} 的业务系统账号开好了。把下面的内容发给客户（初始密码只在这里显示一次）：</p>
            <textarea readOnly value={handout} rows={handout.split("\n").length} onFocus={e => e.target.select()}
              className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 font-mono text-xs outline-none" />
            <Button size="sm" variant="outline" className="gap-1" onClick={async () => {
              if (await copyText(handout)) { setCopied(true); setHandedOut(true); setTimeout(() => setCopied(false), 2000); }
              else window.alert("浏览器不让自动复制，请选中上面的内容手动复制");
            }}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制"}</Button>
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">以后给这个客户推单：打开订单，右边「业务系统」点「推到业务系统」，搜名字或手机号就能选到这个账号。</p>
            <div className="flex justify-end"><Button size="sm" onClick={close}>完成</Button></div>
          </div>
        ) : (
          <div className="space-y-3 p-5 text-sm">
            <p className="text-xs text-[var(--muted-foreground)]">给客户开业务系统的登录账号，不用先有订单。手机号和邮箱填一个就行，客户用它登录。</p>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="客户名字（必填，建议填公司名）" autoFocus />
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="手机号（客户用它登录）" />
            <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="邮箱（选填）" />
            <div className="space-y-1">
              <span className="text-xs text-[var(--muted-foreground)]">初始密码（已自动生成，可以改，至少 6 位）</span>
              <Input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            {message && <p className="text-xs text-[var(--destructive)]">{message}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={close} disabled={busy}>取消</Button>
              <Button size="sm" className="gap-1.5" onClick={create} disabled={busy || !ready}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}开账号
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
