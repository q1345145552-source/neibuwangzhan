"use client";

import { useCallback, useEffect, useState } from "react";
import { HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { attachOrderAgent, fetchOrderAgentForStaff, fetchOrderAgentRebate, formatRebate, REBATE_STATE_LABEL, removeOrderAgentRebate, saveOrderAgentRebate, setOrderAgentRebatePaid, type OrderAgentRebate } from "@/lib/api";

const selectClass = "h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]";

/**
 * 代理返点（2026-11-03）：管理员用这张卡片，页面上按角色挂载，接口也只认管理员。员工用下面的 OrderAgentAttachCard。
 * 挂、换、解除、改返点、点已付、撤销已付；已付的单要先撤销已付才能改。
 * orderStatus 变了重新取：页面上办完最后一步后，这里要马上变成「可拿未付」。
 */
export function OrderAgentCard({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const [state, setState] = useState<{ rebate: OrderAgentRebate | null; agents: { account_id: string; name: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetchOrderAgentRebate(orderId).then(setState), [orderId]);
  useEffect(() => {
    let alive = true;
    fetchOrderAgentRebate(orderId)
      .then(d => { if (alive) setState(d); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "取代理返点失败"); });
    return () => { alive = false; };
  }, [orderId, orderStatus]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      // 别的页面可能已经改过（比如点了已付），按现在的状态显示按钮；金额填错时表单留着改
      load().catch(() => {});
      setBusy(false);
      return;
    }
    setEditing(false);
    setAgentId("");
    setAmount("");
    // 已经成功了，刷新失败不能说成没成功
    await load().catch(() => setError("已保存，页面没刷新成功，请刷新后再看"));
    setBusy(false);
  };

  if (!state) return error ? <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--muted-foreground)]">代理返点：{error}</div> : null;
  const { rebate, agents } = state;
  // 换代理的下拉：能选状态正常的；当前代理已停用时也留着它（同一个代理可以改金额）
  const options = rebate && !agents.some(a => a.account_id === rebate.agent_account_id)
    ? [{ account_id: rebate.agent_account_id, name: `${rebate.agent_name || rebate.agent_account_id}（已停用）` }, ...agents] : agents;
  const showForm = !rebate || (editing && !rebate.paid_at);
  // 选中的代理可能刚被停用，不在下拉里了
  const agentPicked = options.some(a => a.account_id === agentId);
  const unfilledCancelled = rebate?.rebate_cents === null && rebate.rebate_state === "void";

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <HandCoins className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        <h3 className="text-sm font-medium">代理返点</h3>
      </div>
      {rebate && (
        <div className="mb-2 flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          <p>代理：<span className="text-[var(--foreground)]">{rebate.agent_name || rebate.agent_account_id}</span></p>
          {rebate.rebate_cents === null
            ? unfilledCancelled ? <p>返点：不用填，这张单已取消</p> : <p className="font-medium text-[var(--destructive)]">返点：待填。员工挂的代理，填了代理才看得到这张单</p>
            : <p>返点：<span className="font-mono text-[var(--foreground)]">{formatRebate(rebate.rebate_cents)}</span>（{REBATE_STATE_LABEL[rebate.rebate_state]}）</p>}
          {rebate.paid_anomaly && <p className="font-medium text-[var(--destructive)]">点过已付，但这张单现在不是已完成。钱要不要追回线下处理；重新办完后恢复已付</p>}
        </div>
      )}
      {showForm ? (
        agents.length === 0 && !rebate ? <p className="text-xs text-[var(--muted-foreground)]">还没有能选的代理，先到「代理记账」开账号</p> : (
          <div className="flex flex-col gap-2">
            <select aria-label="选代理" value={agentPicked ? agentId : ""} onChange={e => setAgentId(e.target.value)} className={selectClass}>
              <option value="">选代理</option>
              {options.map(a => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
            </select>
            <Input aria-label="返点（人民币）" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="返点（人民币）" className="h-8 text-xs" />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !agentPicked || !amount.trim()} onClick={() => run(() => saveOrderAgentRebate(orderId, { agent_account_id: agentId, rebate: amount.trim() }))}>保存</Button>
              {editing && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(""); setAgentId(""); setAmount(""); }}>取消</Button>}
            </div>
          </div>
        )
      ) : rebate && (
        <div className="flex flex-wrap gap-2">
          {rebate.paid_at ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("撤销这张单的已付？")) run(() => setOrderAgentRebatePaid(orderId, false)); }}>撤销已付</Button>
          ) : (
            <>
              {rebate.rebate_state === "earned" && rebate.rebate_cents !== null && <Button size="sm" disabled={busy} onClick={() => { if (window.confirm("确认线下已经付了这笔返点？")) run(() => setOrderAgentRebatePaid(orderId, true)); }}>已付</Button>}
              {!unfilledCancelled && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setAgentId(rebate.agent_account_id); setAmount(rebate.rebate_cents === null ? "" : (rebate.rebate_cents / 100).toFixed(2)); setEditing(true); setError(""); }}>{rebate.rebate_cents === null ? "填返点" : "修改"}</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(rebate.rebate_cents === null ? "解除这张单的代理？" : "解除后这个代理马上看不到这张单，确定？")) run(() => removeOrderAgentRebate(orderId)); }}>解除</Button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

/** 员工挂代理（2026-11-03）：只选人。接口只给代理名字，这里拿不到返点；挂上后要换要解除找管理员 */
export function OrderAgentAttachCard({ orderId, orderStatus }: { orderId: string; orderStatus: string }) {
  const [state, setState] = useState<{ attached: { agent_name: string } | null; agents: { account_id: string; name: string }[] } | null>(null);
  const [error, setError] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOrderAgentForStaff(orderId)
      .then(d => { if (alive) setState(d); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "取代理失败"); });
    return () => { alive = false; };
  }, [orderId]);

  const attach = async () => {
    const name = state?.agents.find(a => a.account_id === agentId)?.name;
    if (!name || !window.confirm(`把这张单挂到「${name}」名下？挂上后要换，只能找管理员`)) return;
    setBusy(true);
    setError("");
    try {
      const { attached: done } = await attachOrderAgent(orderId, agentId);
      setState(s => s && { ...s, attached: done });
    } catch (e) {
      setError(e instanceof Error ? e.message : "挂代理失败");
      // 可能别人刚挂过，按现在的状态显示
      fetchOrderAgentForStaff(orderId).then(setState).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (!state) return error ? <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--muted-foreground)]">代理：{error}</div> : null;
  const { attached, agents } = state;
  // 选中的代理可能刚被停用，不在下拉里了
  const agentPicked = agents.some(a => a.account_id === agentId);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <HandCoins className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        <h3 className="text-sm font-medium">代理</h3>
      </div>
      {attached ? (
        <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          <p>代理：<span className="text-[var(--foreground)]">{attached.agent_name}</span></p>
          <p>要换代理，请找管理员</p>
        </div>
      ) : orderStatus === "客户取消" ? (
        <p className="text-xs text-[var(--muted-foreground)]">这张单已取消，不用挂代理</p>
      ) : agents.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">还没有能选的代理，请管理员开账号</p>
      ) : (
        <div className="flex flex-col gap-2">
          <select aria-label="选代理" value={agentPicked ? agentId : ""} onChange={e => setAgentId(e.target.value)} className={selectClass}>
            <option value="">选代理</option>
            {agents.map(a => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
          <p className="text-[0.7rem] text-[var(--muted-foreground)]">返点由管理员填</p>
          <div><Button size="sm" disabled={busy || !agentPicked} onClick={attach}>挂上</Button></div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}
