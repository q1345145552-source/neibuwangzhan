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

export type CreatedAccount = StorefrontAccount & { login: string; group_name: string; group_warning?: string; login_url?: string | null; password: string };

/**
 * 订单管理页「开客户账号」：给客户开业务系统的登录账号，不用先有订单（2026-10-26）。员工都能开（2026-10-28）。
 * 新建订单时选客户也是开这个号，开好直接选上。
 */
export function OpenCustomerAccountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium transition-all hover:bg-[var(--muted)]">
        <UserPlus className="size-3.5" aria-hidden="true" />开客户账号
      </button>
      {open && <OpenCustomerAccountDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * 开客户账号：只填登录名、客户群名、初始密码（2026-10-28 老板定）。客户群名只有内部看得到。
 * onCreated：建单时开号，开好把账号交回去直接选上。
 */
export function OpenCustomerAccountDialog({ onClose, onCreated, initialGroupName = "" }: { onClose: () => void; onCreated?: (account: CreatedAccount) => void; initialGroupName?: string }) {
  const [form, setForm] = useState({ login: "", group_name: initialGroupName, password: randomPassword() });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState<CreatedAccount | null>(null);
  const [copied, setCopied] = useState(false);
  const [handedOut, setHandedOut] = useState(false);
  useLeaveGuard(!!done && !handedOut);

  const create = async () => {
    setBusy(true); setMessage("");
    try {
      const account = await createStorefrontCustomer({ login: form.login.trim(), group_name: form.group_name.trim(), password: form.password });
      setDone({ ...account, password: form.password });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "开账号失败");
    } finally { setBusy(false); }
  };

  // 初始密码只在这里显示一次：开好了还没复制就关，先提醒一句
  const close = () => {
    if (busy) return;
    if (done && !handedOut && !window.confirm(`客户的初始密码是 ${done.password}，关掉以后这里就看不到了。\n记下来、或者已经手动复制了再关；忘了也可以在业务系统后台「客户列表」里重置密码。确定关掉？`)) return;
    if (done && onCreated) onCreated(done); else onClose();
  };

  const handout = done ? [done.login_url ? `登录网址：${done.login_url}` : "", `登录账号：${done.login}`, `初始密码：${done.password}`].filter(Boolean).join("\n") : "";
  const ready = form.login.trim() && form.group_name.trim() && form.password.length >= 6;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div className="mx-4 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-[var(--background)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-sm font-medium">{done ? "客户账号已开好" : "开客户账号"}</h2>
          <button type="button" onClick={close} disabled={busy} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-4" /></button>
        </div>

        {done ? (
          <div className="space-y-3 p-5 text-sm">
            <p>{done.group_name ? `「${done.group_name}」的账号开好了。` : "账号开好了。"}把下面的内容发给客户（初始密码只在这里显示一次）：</p>
            {done.group_warning && <p className="text-xs text-[oklch(0.40_0.14_85)]">{done.group_warning}</p>}
            <textarea readOnly value={handout} rows={handout.split("\n").length} onFocus={e => e.target.select()}
              className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 font-mono text-xs outline-none" />
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={async () => {
              if (await copyText(handout)) { setCopied(true); setHandedOut(true); setTimeout(() => setCopied(false), 2000); }
              else window.alert("浏览器不让自动复制，请选中上面的内容手动复制");
            }}>{copied ? <Check className="size-3" /> : <Copy className="size-3" />}{copied ? "已复制" : "复制"}</Button>
            <p className="text-[0.7rem] text-[var(--muted-foreground)]">{onCreated ? "点「完成」回到订单，这个客户已经选好了。" : "以后给这个客户建单：新建订单时在「客户」里搜客户群名或登录名就能选到，提交后客户登录就能看到这张单。"}</p>
            <div className="flex justify-end"><Button type="button" size="sm" onClick={close}>完成</Button></div>
          </div>
        ) : (
          <div className="space-y-3 p-5 text-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium">登录名</span>
              <Input value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} placeholder="手机号、邮箱或名字都行" autoFocus />
              <p className="text-[0.7rem] text-[var(--muted-foreground)]">客户用它登录业务系统</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">客户群名</span>
              <Input value={form.group_name} onChange={e => setForm({ ...form, group_name: e.target.value })} placeholder="例如客户的 LINE / 微信群名" />
              <p className="text-[0.7rem] text-[var(--muted-foreground)]">只有内部看得到，客户看不到；建单时按这个名字找客户</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium">初始密码</span>
              <Input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <p className="text-[0.7rem] text-[var(--muted-foreground)]">已自动生成，可以改，至少 6 位</p>
            </div>
            {message && <p className="text-xs text-[var(--destructive)]">{message}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={close} disabled={busy}>取消</Button>
              <Button type="button" size="sm" className="gap-1.5" onClick={create} disabled={busy || !ready}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}开账号
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
