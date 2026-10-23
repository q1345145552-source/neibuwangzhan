"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";

interface Withdrawal {
  id: number; employee_name: string; amount: number; status: string;
  review_note: string; reviewed_by: string; created_at: string; reviewed_at: string;
}

export function MyWithdrawals() {
  const { user } = useAuth();
  const resultParam = useSearchParams().get("withdrawal_result");
  const allowed = user?.role === "admin" || user?.role === "employee";
  const [listOpen, setListOpen] = useState(false);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [listReload, setListReload] = useState(0);
  const [resultOpen, setResultOpen] = useState(false);
  const [result, setResult] = useState<Withdrawal | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState("");
  const resultRequest = useRef(0);
  const resultController = useRef<AbortController | null>(null);
  const [viewport, setViewport] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const visual = window.visualViewport;
    if ((!listOpen && !resultOpen) || !visual) { setViewport(null); return; }
    const update = () => setViewport({ left: visual.offsetLeft, top: visual.offsetTop, width: visual.width, height: visual.height });
    update(); visual.addEventListener("resize", update); visual.addEventListener("scroll", update);
    return () => { visual.removeEventListener("resize", update); visual.removeEventListener("scroll", update); };
  }, [listOpen, resultOpen]);

  const closeResult = useCallback(() => {
    ++resultRequest.current; resultController.current?.abort();
    setResultOpen(false); setResult(null); setResultLoading(false); setResultError("");
  }, []);

  const openResult = useCallback(async (id: string) => {
    const run = ++resultRequest.current;
    resultController.current?.abort();
    const controller = new AbortController(); resultController.current = controller;
    setListOpen(false); setResult(null); setResultError(""); setResultLoading(false);
    if (!allowed || !user) { setResultOpen(false); return; }
    setResultOpen(true);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) { setResultError("提现编号无效，请返回我的提现记录查看。"); return; }
    setResultLoading(true);
    try {
      const response = await fetchWithAuth(`/api/customers/withdrawals/${id}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 403 || response.status === 404 ? "提现记录不存在或你无权查看。" : "提现结果加载失败，请重试。");
      const row: Withdrawal = await response.json();
      if (row.id !== Number(id) || row.employee_name !== user.name) throw new Error("提现记录不存在或你无权查看。");
      if (run === resultRequest.current) setResult(row);
    } catch (error) {
      if (run === resultRequest.current && !controller.signal.aborted) setResultError(error instanceof Error ? error.message : "提现结果加载失败，请重试。");
    } finally { if (run === resultRequest.current) setResultLoading(false); }
  }, [allowed, user?.name]);

  useEffect(() => {
    closeResult();
    if (resultParam !== null) void openResult(resultParam);
    return () => { ++resultRequest.current; resultController.current?.abort(); };
  }, [resultParam, openResult, closeResult]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRows([]); setListError("");
    if (!listOpen || !allowed || !user) return;
    setListLoading(true);
    fetchWithAuth("/api/customers?action=my_withdrawals", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("我的提现记录加载失败，请重试。");
        const data = await response.json();
        if (!Array.isArray(data) || data.some(row => row.employee_name !== user.name)) throw new Error("提现记录无效，请重试。");
        if (active) setRows(data);
      })
      .catch(error => { if (active) setListError(error instanceof Error ? error.message : "我的提现记录加载失败，请重试。"); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [listOpen, allowed, user?.name, listReload]);

  if (!allowed) return null;
  const overlayStyle = viewport ? { left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height, right: "auto", bottom: "auto" } : undefined;
  const panelStyle = viewport ? { maxHeight: Math.max(0, viewport.height - 32) } : undefined;
  const statusColor = (status: string) => status === "已通过" ? "text-green-700 dark:text-green-300" : status === "已驳回" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300";
  return <>
    <button className="min-h-11 text-xs text-[var(--primary)] hover:underline" onClick={() => { closeResult(); setListOpen(true); }}>我的提现记录</button>
    {listOpen && <div style={overlayStyle} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setListOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="我的提现记录" style={panelStyle} className="max-h-[88dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl [overflow-wrap:anywhere]" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">我的提现记录</h3><button aria-label="关闭我的提现记录" className="flex size-11 shrink-0 items-center justify-center" onClick={() => setListOpen(false)}><X className="size-5" /></button></div>
        {listLoading ? <p role="status" className="mt-3 text-sm">提现记录加载中…</p> : listError ? <div className="mt-3"><p role="alert" className="text-sm text-red-600">{listError}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => setListReload(value => value + 1)}>重新加载</Button></div> : !rows.length ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">暂无本人提现记录</p> : <div className="mt-3 space-y-2">
          {rows.map(row => <button key={row.id} data-my-withdrawal-id={row.id} className="block w-full min-w-0 rounded-md border border-[var(--border)] p-3 text-left text-sm" onClick={() => void openResult(String(row.id))}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span>申请 #{row.id} · {row.amount} 积分</span><span className={statusColor(row.status)}>{row.status}</span></div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">申请时间：{row.created_at ? toThaiTime(row.created_at) : "未记录"}</p>
            <span className="mt-2 inline-block text-xs text-[var(--primary)]">查看结果</span>
          </button>)}
        </div>}
      </div>
    </div>}
    {resultOpen && <div style={overlayStyle} className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={closeResult}>
      <div role="dialog" aria-modal="true" aria-label="本人提现结果" style={panelStyle} className="max-h-[88dvh] w-full min-w-0 max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl [overflow-wrap:anywhere]" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">提现结果{result ? ` #${result.id}` : ""}</h3><button aria-label="关闭本人提现结果" className="flex size-11 shrink-0 items-center justify-center" onClick={closeResult}><X className="size-5" /></button></div>
        {resultLoading ? <p role="status" className="mt-3 text-sm">提现结果加载中…</p> : resultError ? <p role="alert" className="mt-3 text-sm text-red-600">{resultError}</p> : result && <div className="mt-3 space-y-3 text-sm" data-withdrawal-result-id={result.id}>
          <p>申请人：{result.employee_name} · {result.amount} 积分</p>
          <p className={cn("font-medium", statusColor(result.status))}>审批结果：{result.status}</p>
          <p className="whitespace-pre-wrap rounded-md bg-[var(--muted)]/30 p-3">审核意见：{String(result.review_note || "").trim() ? result.review_note : "未填写审核意见"}</p>
          {result.status === "已通过" && <p className="text-amber-700 dark:text-amber-300">本结果仅表示审批通过，付款和到账情况需另行确认。</p>}
          {result.status === "待审核" && <p className="text-[var(--muted-foreground)]">申请仍待审核，尚无审批结果。</p>}
          <div className="space-y-1 text-xs text-[var(--muted-foreground)]"><p>申请时间：{result.created_at ? toThaiTime(result.created_at) : "未记录"}</p><p>审核人：{result.reviewed_by || "未记录"}</p><p>审核时间：{result.reviewed_at ? toThaiTime(result.reviewed_at) : "未记录"}</p></div>
        </div>}
        <Button variant="outline" className="mt-4 min-h-11" onClick={() => { closeResult(); setListOpen(true); }}>返回我的提现记录</Button>
      </div>
    </div>}
  </>;
}
