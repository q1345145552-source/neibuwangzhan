"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { createAgent, fetchAgentRebates, fetchAgents, formatRebate, REBATE_STATE_LABEL, removeOrderAgentRebate, saveOrderAgentRebate, setOrderAgentRebatePaid, updateAgent, type AgentAccount, type AgentRebateRow } from "@/lib/api";

const th = "py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide whitespace-nowrap";
const thNum = "py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide whitespace-nowrap";
const td = "py-3 px-4 align-top";
const tdNum = "py-3 px-4 text-right font-mono text-xs tabular-nums align-top whitespace-nowrap";

function randomPassword(): string {
  return String(10_000_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 90_000_000));
}

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** 开号、重置密码后给管理员的账号密码：只显示这一次，内部不存密码 */
function CredentialBox({ credential, onClose }: { credential: { name: string; login: string; password: string }; onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const text = `登录名：${credential.login}\n密码：${credential.password}`;
  const copy = async () => {
    // http 访问时 navigator.clipboard 不存在，写在 try 里才接得住
    try {
      await navigator.clipboard.writeText(text);
      setCopied("已复制");
    } catch {
      setCopied("浏览器不让复制，请手动选中");
    }
  };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
      <p className="mb-2 font-medium">{credential.name} 的账号（密码只显示这一次，发给代理后再关掉）</p>
      <pre className="mb-3 whitespace-pre-wrap break-all font-mono text-xs select-all">{text}</pre>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={copy}>复制账号密码</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>关掉</Button>
        {copied && <span className="text-xs text-[var(--muted-foreground)]">{copied}</span>}
      </div>
    </div>
  );
}

function RebateRows({ agent, onChanged }: { agent: AgentAccount; onChanged: () => void }) {
  const [result, setResult] = useState<{ agentId: string; rows?: AgentRebateRow[]; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [edit, setEdit] = useState<{ orderId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const agentId = agent.account_id;

  useEffect(() => {
    let ignore = false;
    fetchAgentRebates(agentId)
      .then(d => { if (!ignore) setResult({ agentId, rows: d.rows }); })
      .catch(e => { if (!ignore) setResult({ agentId, error: message(e, "加载失败") }); });
    return () => { ignore = true; };
  }, [agentId, version]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setEdit(null);
      onChanged();
    } catch (e) {
      setError(message(e, "操作失败"));
    } finally {
      setBusy(false);
      setVersion(v => v + 1);
    }
  };

  const current = result?.agentId === agentId ? result : null;
  const rows = current?.rows;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-[var(--foreground)]">{agent.name} 名下的单</h2>
      {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
      {current?.error && <p role="alert" className="text-sm text-[var(--destructive)]">{current.error}</p>}
      {!current && <p className="text-sm text-[var(--muted-foreground)]">加载中…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">这个代理名下还没有单</p>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)]">
              <th className={th}>单号</th><th className={th}>业务</th><th className={th}>客户</th><th className={th}>订单状态</th>
              <th className={thNum}>返点</th><th className={th}>返点状态</th><th className={th}>操作</th>
            </tr></thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.order_id} className="border-b border-[var(--border)] last:border-0">
                  <td className={cn(td, "whitespace-nowrap font-mono text-xs")}><Link href={`/orders/${encodeURIComponent(row.order_id)}`} className="hover:underline">{row.order_no}</Link></td>
                  <td className={td}>{row.business_name}{row.parts ? <span className="ml-1 text-xs text-[var(--muted-foreground)]">第 {row.part} 份，共 {row.parts} 份</span> : null}</td>
                  <td className={td}>{row.customer_name}</td>
                  <td className={cn(td, "whitespace-nowrap")}>{row.status_label}</td>
                  <td className={tdNum}>{edit?.orderId === row.order_id
                    ? <Input aria-label="返点（人民币）" inputMode="decimal" value={edit.value} onChange={e => setEdit({ orderId: row.order_id, value: e.target.value })} className="ml-auto h-8 w-28 text-right text-xs" />
                    : row.rebate_cents === null ? (row.rebate_state === "void" ? "—" : <span className="font-medium text-[var(--destructive)]">待填</span>) : formatRebate(row.rebate_cents)}</td>
                  <td className={cn(td, "whitespace-nowrap")}>
                    {row.rebate_cents === null ? (row.rebate_state === "void" ? "单已取消，不用填" : "代理还看不到") : REBATE_STATE_LABEL[row.rebate_state]}
                    {row.paid_anomaly && <span className="ml-2 rounded-full bg-[var(--destructive)]/10 px-2 py-0.5 text-[0.7rem] font-medium text-[var(--destructive)]">点过已付，订单没完成</span>}
                  </td>
                  <td className={td}>
                    <div className="flex flex-nowrap gap-1.5">
                      {edit?.orderId === row.order_id ? (
                        <>
                          <Button size="sm" disabled={busy || !edit.value.trim()} onClick={() => run(() => saveOrderAgentRebate(row.order_id, { agent_account_id: agentId, rebate: edit.value.trim() }))}>保存</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEdit(null); setError(""); }}>取消</Button>
                        </>
                      ) : row.paid_at ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("撤销这张单的已付？")) void run(() => setOrderAgentRebatePaid(row.order_id, false)); }}>撤销已付</Button>
                      ) : (
                        <>
                          {row.rebate_state === "earned" && row.rebate_cents !== null && <Button size="sm" disabled={busy} onClick={() => { if (window.confirm("确认线下已经付了这笔返点？")) void run(() => setOrderAgentRebatePaid(row.order_id, true)); }}>已付</Button>}
                          {row.rebate_cents === null
                            ? row.rebate_state !== "void" && <Button size="sm" disabled={busy} onClick={() => setEdit({ orderId: row.order_id, value: "" })}>填返点</Button>
                            : <Button size="sm" variant="outline" disabled={busy} onClick={() => setEdit({ orderId: row.order_id, value: (row.rebate_cents as number / 100).toFixed(2) })}>改返点</Button>}
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(row.rebate_cents === null ? "解除这张单的代理？" : "解除后这个代理马上看不到这张单，确定？")) void run(() => removeOrderAgentRebate(row.order_id)); }}>解除</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AgentRebatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [agents, setAgents] = useState<AgentAccount[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(() => ({ name: "", login: "", password: randomPassword() }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<{ name: string; login: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<{ agent: AgentAccount; password: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let ignore = false;
    fetchAgents()
      .then(d => { if (!ignore) { setAgents(d.agents); setLoadError(""); } })
      .catch(e => { if (!ignore) setLoadError(message(e, "加载失败")); });
    return () => { ignore = true; };
  }, [isAdmin, version]);

  // 登录状态还没取到时什么都不显示，员工连开号表单也看不到一闪
  if (!isAdmin) {
    return user ? <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">代理记账只有管理员能看</p> : null;
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setVersion(v => v + 1);
    } catch (e) {
      setError(message(e, "没成功，再点一次"));
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { agent } = await createAgent({ name: form.name.trim(), login: form.login.trim(), password: form.password });
      setCredential({ name: agent.name, login: agent.login, password: form.password });
      setForm({ name: "", login: "", password: randomPassword() });
      setSelectedId(agent.account_id);
    });
  };

  const toggle = (agent: AgentAccount) => {
    const next = agent.status === "active" ? "disabled" : "active";
    if (next === "disabled" && !window.confirm(`停用 ${agent.name}？停用后代理登录不了，名下的单和返点都留着。`)) return;
    void run(async () => { await updateAgent(agent.account_id, { status: next }); });
  };

  const submitReset = () => {
    if (!resetFor) return;
    const { agent, password } = resetFor;
    void run(async () => {
      await updateAgent(agent.account_id, { password });
      setCredential({ name: agent.name, login: agent.login, password });
      setResetFor(null);
    });
  };

  const selected = agents?.find(a => a.account_id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>代理记账</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">每个代理名下的单和返点；只有管理员看得到。员工挂的单要在这里填了返点，代理才看得到。钱线下付，付了在这里点「已付」。</p>
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}
      {credential && <CredentialBox credential={credential} onClose={() => setCredential(null)} />}

      <form onSubmit={submitCreate} className="flex flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-medium text-[var(--foreground)]">开代理账号</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent_name" className="text-sm font-medium">名字</Label>
            <Input id="agent_name" value={form.name} maxLength={50} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required className="h-10" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent_login" className="text-sm font-medium">登录名</Label>
            <Input id="agent_login" value={form.login} maxLength={254} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} required autoComplete="off" className="h-10" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent_password" className="text-sm font-medium">初始密码</Label>
            <Input id="agent_password" value={form.password} minLength={6} maxLength={72} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required autoComplete="off" className="h-10 font-mono" />
          </div>
        </div>
        <p className="text-xs text-[var(--muted-foreground)]">老客户当代理要另起一个登录名。开好后可以复制账号密码发给代理，内部不存密码。</p>
        <div><Button type="submit" size="sm" disabled={busy}>{busy ? "处理中…" : "开账号"}</Button></div>
      </form>

      {loadError && <p role="alert" className="text-sm text-[var(--destructive)]">{loadError}</p>}
      {agents && agents.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">还没有代理账号</p>}
      {agents && agents.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-[var(--border)]">
              <th className={th}>代理</th><th className={th}>登录名</th><th className={th}>状态</th><th className={thNum}>单数</th><th className={thNum}>待填返点</th>
              <th className={thNum}>等办完</th><th className={thNum}>可拿未付</th><th className={thNum}>已付</th><th className={thNum}>已付待核对</th><th className={th}>操作</th>
            </tr></thead>
            <tbody>
              {agents.map(agent => (
                <tr key={agent.account_id} className={cn("border-b border-[var(--border)] last:border-0", agent.account_id === selectedId && "bg-[var(--muted)]")}>
                  <td className={td}><button type="button" onClick={() => setSelectedId(agent.account_id)} className="font-medium text-[var(--foreground)] hover:underline">{agent.name}</button></td>
                  <td className={cn(td, "break-all font-mono text-xs")}>{agent.login}</td>
                  <td className={cn(td, "whitespace-nowrap")}>{agent.status === "active" ? "正常" : "已停用"}</td>
                  <td className={tdNum}>{agent.order_count}</td>
                  <td className={cn(tdNum, agent.unfilled_count > 0 && "font-medium text-[var(--destructive)]")}>{agent.unfilled_count}</td>
                  <td className={tdNum}>{formatRebate(agent.waiting_cents)}</td>
                  <td className={tdNum}>{formatRebate(agent.earned_cents)}</td>
                  <td className={tdNum}>{formatRebate(agent.paid_cents)}</td>
                  <td className={cn(tdNum, agent.anomaly_cents > 0 && "font-medium text-[var(--destructive)]")}>{formatRebate(agent.anomaly_cents)}</td>
                  <td className={td}>
                    <div className="flex flex-nowrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(agent)}>{agent.status === "active" ? "停用" : "启用"}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setResetFor({ agent, password: randomPassword() })}>重置密码</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resetFor && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <Label htmlFor="agent_reset_password" className="text-sm font-medium">给 {resetFor.agent.name} 设新密码</Label>
          <Input id="agent_reset_password" value={resetFor.password} minLength={6} maxLength={72} onChange={e => setResetFor({ ...resetFor, password: e.target.value })} autoComplete="off" className="h-10 max-w-xs font-mono" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || resetFor.password.length < 6} onClick={submitReset}>确定重置</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setResetFor(null)}>取消</Button>
          </div>
        </div>
      )}

      {selected ? <RebateRows key={selected.account_id} agent={selected} onChanged={() => setVersion(v => v + 1)} /> : agents && agents.length > 0 && <p className="text-sm text-[var(--muted-foreground)]">点代理名字，下面列出名下的单</p>}
    </div>
  );
}
