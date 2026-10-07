"use client";

import { useState, useEffect } from "react";
import { apiCall } from "@/lib/api-call";
import { Button } from "@/components/ui/button";
import { fetchWithAuth } from "@/lib/api";
import { toThaiTime } from "@/lib/utils";
import { bangkokToday } from "@/lib/time";
import { Plus, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

interface SimBatch {
  id: number;
  lot_no: string;
  total_qty: number;
  remaining_qty: number;
  stock_date: string;
  remark: string;
  created_by: string;
  created_at: string;
}

interface SimTransaction {
  id: number;
  batch_id: number;
  lot_no: string;
  type: "入库" | "出库";
  qty: number;
  purpose: string;
  customer: string;
  operator: string;
  created_at: string;
}

type ActiveForm = null | "batch" | "in" | "out";

const TYPE_BADGE: Record<SimTransaction["type"], string> = {
  入库: "bg-emerald-500/15 text-emerald-600",
  出库: "bg-red-500/15 text-red-600",
};

export function SimTab() {
  const [batches, setBatches] = useState<SimBatch[]>([]);
  const [transactions, setTransactions] = useState<SimTransaction[]>([]);
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [txFilter, setTxFilter] = useState("all");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const [batchForm, setBatchForm] = useState({ lot_no: "", total_qty: "", stock_date: "", remark: "" });
  const [inForm, setInForm] = useState({ batch_id: "", qty: "" });
  const [outForm, setOutForm] = useState({ batch_id: "", qty: "", purpose: "", customer: "" });

  const loadBatches = async () => {
    try {
      const res = await fetchWithAuth("/api/sim-batches", { cache: "no-store" });
      if (!res.ok) return;
      setBatches(await res.json());
    } catch {}
  };

  const loadTransactions = async (filter = txFilter) => {
    try {
      const url = filter && filter !== "all" ? `/api/sim-transactions?batch_id=${filter}` : "/api/sim-transactions";
      const res = await fetchWithAuth(url, { cache: "no-store" });
      if (!res.ok) return;
      setTransactions(await res.json());
    } catch {}
  };

  useEffect(() => { loadBatches(); }, []);
  useEffect(() => { loadTransactions(txFilter); }, [txFilter]);

  const reload = () => { loadBatches(); loadTransactions(); };

  const openBatchForm = () => {
    setBatchForm({ lot_no: "", total_qty: "", stock_date: bangkokToday(), remark: "" });
    setErr(""); setNotice("");
    setActiveForm("batch");
  };

  const openInForm = () => {
    if (batches.length === 0) { setNotice("请先新增批次，再进行入库"); return; }
    setInForm({ batch_id: String(batches[0].id), qty: "" });
    setErr(""); setNotice("");
    setActiveForm("in");
  };

  const openOutForm = () => {
    if (batches.length === 0) { setNotice("请先新增批次，再进行出库"); return; }
    setOutForm({ batch_id: String(batches[0].id), qty: "", purpose: "", customer: "" });
    setErr(""); setNotice("");
    setActiveForm("out");
  };

  const quickOut = (b: SimBatch) => {
    setOutForm({ batch_id: String(b.id), qty: "", purpose: "", customer: "" });
    setErr(""); setNotice("");
    setActiveForm("out");
  };

  const submitBatch = async () => {
    if (!batchForm.lot_no.trim()) { setErr("请填写批次号（Lot号）"); return; }
    const n = Number(batchForm.total_qty);
    if (!Number.isInteger(n) || n <= 0) { setErr("入库数量必须是正整数"); return; }
    if (!batchForm.stock_date) { setErr("请选择入库日期"); return; }
    const ok = await apiCall("/api/sim-batches", {
      method: "POST",
      body: { lot_no: batchForm.lot_no.trim(), total_qty: n, stock_date: batchForm.stock_date, remark: batchForm.remark.trim() },
      onError: (m) => setErr(m),
    });
    if (ok) { setActiveForm(null); setErr(""); reload(); }
  };

  const submitIn = async () => {
    if (!inForm.batch_id) { setErr("请选择批次"); return; }
    const n = Number(inForm.qty);
    if (!Number.isInteger(n) || n <= 0) { setErr("数量必须是正整数"); return; }
    const ok = await apiCall("/api/sim-transactions", {
      method: "POST",
      body: { batch_id: Number(inForm.batch_id), type: "入库", qty: n },
      onError: (m) => setErr(m),
    });
    if (ok) { setActiveForm(null); setErr(""); reload(); }
  };

  const submitOut = async () => {
    if (!outForm.batch_id) { setErr("请选择批次"); return; }
    const n = Number(outForm.qty);
    if (!Number.isInteger(n) || n <= 0) { setErr("数量必须是正整数"); return; }
    if (!outForm.purpose.trim()) { setErr("出库必须填写用途"); return; }
    if (!outForm.customer.trim()) { setErr("出库必须填写客户"); return; }
    const ok = await apiCall("/api/sim-transactions", {
      method: "POST",
      body: { batch_id: Number(outForm.batch_id), type: "出库", qty: n, purpose: outForm.purpose.trim(), customer: outForm.customer.trim() },
      onError: (m) => setErr(m),
    });
    if (ok) { setActiveForm(null); setErr(""); reload(); }
  };

  const selectedOutBatch = batches.find((b) => String(b.id) === outForm.batch_id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={openBatchForm}><Plus className="size-3.5" />新增批次</Button>
        <Button size="sm" variant="outline" onClick={openInForm}><ArrowDownToLine className="size-3.5" />入库</Button>
        <Button size="sm" variant="outline" onClick={openOutForm}><ArrowUpFromLine className="size-3.5" />出库</Button>
      </div>

      {notice && <p className="text-xs text-amber-600">{notice}</p>}

      {activeForm === "batch" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">新增批次</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">批次号（Lot号）</label>
              <input value={batchForm.lot_no} onChange={(e) => setBatchForm((p) => ({ ...p, lot_no: e.target.value }))}
                placeholder="例如：LOT-2026-001"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">入库数量</label>
              <input value={batchForm.total_qty} onChange={(e) => setBatchForm((p) => ({ ...p, total_qty: e.target.value }))}
                type="number" min="1" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">入库日期</label>
              <input value={batchForm.stock_date} onChange={(e) => setBatchForm((p) => ({ ...p, stock_date: e.target.value }))}
                type="date"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">备注</label>
              <input value={batchForm.remark} onChange={(e) => setBatchForm((p) => ({ ...p, remark: e.target.value }))}
                placeholder="选填"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submitBatch}>保存</Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveForm(null)}>取消</Button>
          </div>
        </div>
      )}

      {activeForm === "in" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">入库（往批次加SIM卡）</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">批次</label>
              <select value={inForm.batch_id} onChange={(e) => setInForm((p) => ({ ...p, batch_id: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.lot_no}（剩余 {b.remaining_qty}）</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">数量</label>
              <input value={inForm.qty} onChange={(e) => setInForm((p) => ({ ...p, qty: e.target.value }))}
                type="number" min="1" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submitIn}>确认入库</Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveForm(null)}>取消</Button>
          </div>
        </div>
      )}

      {activeForm === "out" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-5">
          <h2 className="text-sm font-medium mb-4">出库（从批次出SIM卡）</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">批次</label>
              <select value={outForm.batch_id} onChange={(e) => setOutForm((p) => ({ ...p, batch_id: e.target.value }))}
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm">
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>{b.lot_no}（剩余 {b.remaining_qty}）</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">数量</label>
              <input value={outForm.qty} onChange={(e) => setOutForm((p) => ({ ...p, qty: e.target.value }))}
                type="number" min="1" inputMode="numeric"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              {selectedOutBatch && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">该批次剩余 {selectedOutBatch.remaining_qty} 张</p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium">用途</label>
              <input value={outForm.purpose} onChange={(e) => setOutForm((p) => ({ ...p, purpose: e.target.value }))}
                placeholder="必填，例如：开店绑定"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
            <div>
              <label className="text-xs font-medium">客户</label>
              <input value={outForm.customer} onChange={(e) => setOutForm((p) => ({ ...p, customer: e.target.value }))}
                placeholder="必填，卖给哪个客户"
                className="mt-1 w-full h-9 rounded border border-[var(--border)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
            </div>
          </div>
          {err && <p className="mt-2 text-xs text-[var(--destructive)]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submitOut}>确认出库</Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveForm(null)}>取消</Button>
          </div>
        </div>
      )}

      {/* 批次列表 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] text-sm font-medium">批次（剩余数量）</div>
        {batches.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">暂无批次，点击「新增批次」录入</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">批次号</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">入库数量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">剩余数量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">入库日期</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">备注</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 font-mono font-medium">{b.lot_no}</td>
                    <td className="py-2.5 px-4 tabular-nums">{b.total_qty}</td>
                    <td className="py-2.5 px-4 tabular-nums font-semibold">{b.remaining_qty}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{b.stock_date || "—"}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{b.remark || "—"}</td>
                    <td className="py-2.5 px-4">
                      <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => quickOut(b)}>出库</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {batches.map((b) => (
                <div key={b.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-medium text-[var(--foreground)]">{b.lot_no}</span>
                    <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => quickOut(b)}>出库</Button>
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <div>
                      <div className="text-xs text-[var(--muted-foreground)]">剩余数量</div>
                      <div className="text-xl font-semibold tabular-nums">{b.remaining_qty}</div>
                    </div>
                    <div>
                      <div className="text-xs text-[var(--muted-foreground)]">入库数量</div>
                      <div className="text-xl tabular-nums text-[var(--muted-foreground)]">{b.total_qty}</div>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">入库日期</span><span>{b.stock_date || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">备注</span><span className="text-right">{b.remark || "—"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 出入库流水 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
          <span className="text-sm font-medium">出入库流水</span>
          <select value={txFilter} onChange={(e) => setTxFilter(e.target.value)}
            className="h-8 rounded border border-[var(--border)] px-2 text-xs bg-[var(--background)]">
            <option value="all">全部批次</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.lot_no}</option>
            ))}
          </select>
        </div>
        {transactions.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">暂无流水记录</div>
        ) : (
          <>
            <table className="w-full text-sm hidden md:table">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                  <th className="py-2.5 px-5 text-left text-xs font-medium">时间</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">批次</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">类型</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">数量</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">用途</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">客户</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium">操作人</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/20">
                    <td className="py-2.5 px-5 text-[var(--muted-foreground)] whitespace-nowrap">{toThaiTime(t.created_at) || t.created_at}</td>
                    <td className="py-2.5 px-4 font-mono">{t.lot_no || "—"}</td>
                    <td className="py-2.5 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[t.type]}`}>{t.type}</span>
                    </td>
                    <td className="py-2.5 px-4 tabular-nums">{t.qty}</td>
                    <td className="py-2.5 px-4 text-[var(--muted-foreground)]">{t.purpose || "—"}</td>
                    <td className="py-2.5 px-4">{t.customer || "—"}</td>
                    <td className="py-2.5 px-4">{t.operator || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 手机端卡片 */}
            <div className="md:hidden flex flex-col gap-2 p-3">
              {transactions.map((t) => (
                <div key={t.id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_BADGE[t.type]}`}>{t.type}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{toThaiTime(t.created_at) || t.created_at}</span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span className="font-mono text-sm">{t.lot_no || "—"}</span>
                    <span className="text-lg font-semibold tabular-nums">{t.qty} 张</span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">用途</span><span className="text-right">{t.purpose || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">客户</span><span className="text-right">{t.customer || "—"}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">操作人</span><span>{t.operator || "—"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
