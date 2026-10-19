"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import type { CatalogEntry } from "@/lib/workflow-catalog";

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";
const input = "w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs outline-none focus:border-[var(--ring)] disabled:opacity-60";

type Version = { id: number; version: number; note: string; published_by: string; published_at: string };
// from：这一步原来是第几步（新加的为空）；key 只给页面区分行用
type EditRow = { key: string; from: number | null; name: string; publicName: string; assignee: string; notes: string; docsText: string; days: string };
const NEUTRAL = "办理事项";
let rowSeq = 0;

async function postJson(url: string, body: unknown) {
  const r = await fetchWithAuth(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error || "操作失败");
  return d;
}

export default function WorkflowsPage() {
  const { user } = useAuth();
  const [result, setResult] = useState<{ entries: CatalogEntry[]; imported: boolean; staff: string[]; gone: string[]; error?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<{ key: string; baseVersionId: number | null; rows: EditRow[]; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [versions, setVersions] = useState<{ templateId: number; list: Version[] } | null>(null);
  const isAdmin = user?.role === "admin";
  const entries = useMemo(() => result?.entries ?? [], [result]);
  const loading = isAdmin && !result;
  const error = result?.error || "";

  useEffect(() => {
    if (!isAdmin) return;
    let ignore = false;
    fetchWithAuth("/api/workflows", { cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "加载失败"); return r.json(); })
      .then((d: { entries: CatalogEntry[]; imported: boolean; staff: string[]; gone: string[] }) => { if (!ignore) setResult({ entries: d.entries || [], imported: !!d.imported, staff: d.staff || [], gone: d.gone || [] }); })
      .catch(e => { if (!ignore) setResult({ entries: [], imported: false, staff: [], gone: [], error: e instanceof Error ? e.message : "加载失败" }); });
    return () => { ignore = true; };
  }, [isAdmin, reloadKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const e of entries) { const l = map.get(e.business); if (l) l.push(e); else map.set(e.business, [e]); }
    return [...map.entries()];
  }, [entries]);
  const current = entries.find(e => e.key === selected) ?? entries[0];
  const templateId = current?.templateId ?? null;

  useEffect(() => {
    if (!isAdmin || !templateId) return;
    let ignore = false;
    fetchWithAuth(`/api/workflows/${templateId}/versions`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : []))
      .then((list: Version[]) => { if (!ignore) setVersions({ templateId, list: Array.isArray(list) ? list : [] }); })
      .catch(() => { if (!ignore) setVersions({ templateId, list: [] }); });
    return () => { ignore = true; };
  }, [isAdmin, templateId, reloadKey]);
  const versionList = versions && versions.templateId === templateId ? versions.list : [];

  const reload = () => setReloadKey(k => k + 1);
  const missing = entries.filter(e => !e.templateId).length;
  const goneSet = new Set(result?.gone || []);
  const isGone = (assignee: string) => assignee.split(/[\/、,，]/).map(x => x.trim()).some(n => goneSet.has(n));

  const handleImport = async () => {
    if (!window.confirm("把现在写在程序里的流程原样导入系统？\n导入后建单行为、客户看到的步骤名一点不变；之后才能在这里改。导入只做一次，不影响已经建好的单。")) return;
    setBusy(true); setMessage(null);
    try {
      const d = await postJson("/api/workflows/import", {}) as { imported: number; total: number };
      setMessage({ ok: true, text: `导入好了：${d.imported} 套流程（共 ${d.total} 套）。现在可以点「修改」了。` });
      reload();
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "导入失败" }); }
    finally { setBusy(false); }
  };

  const startEdit = () => {
    if (!current) return;
    setMessage(null);
    setEditing({
      key: current.key,
      baseVersionId: current.versionId,
      note: "",
      rows: current.steps.map((s, i) => ({ key: `r${++rowSeq}`, from: i + 1, name: s.name, publicName: s.publicName, assignee: s.assignee, notes: s.notes, docsText: s.docs.join("\n"), days: s.expectedDays == null ? "" : String(s.expectedDays) })),
    });
  };
  const setRow = (i: number, patch: Partial<EditRow>) => setEditing(prev => prev ? { ...prev, rows: prev.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : prev);
  // 加一步（加在第 i 步下面）、删一步、上下挪：第一步「方案确认」固定在最前面
  const addRow = (i: number) => setEditing(prev => prev ? { ...prev, rows: [...prev.rows.slice(0, i + 1), { key: `r${++rowSeq}`, from: null, name: "", publicName: "", assignee: "", notes: "", docsText: "", days: "" }, ...prev.rows.slice(i + 1)] } : prev);
  const removeRow = (i: number) => setEditing(prev => prev ? { ...prev, rows: prev.rows.filter((_, j) => j !== i) } : prev);
  const moveRow = (i: number, to: number) => setEditing(prev => {
    if (!prev || to < 1 || to >= prev.rows.length || i < 1) return prev;
    const rows = [...prev.rows]; const [row] = rows.splice(i, 1); rows.splice(to, 0, row);
    return { ...prev, rows };
  });
  // 客户看到的名字里写着员工名：只提醒，不拦（有的名字太短会误报）
  const staffInName = (text: string) => (result?.staff || []).filter(n => n.trim().length >= 2 && text.toLowerCase().includes(n.trim().toLowerCase()));

  const handlePublish = async () => {
    if (!editing || !templateId || !current) return;
    const emptyName = editing.rows.findIndex(r => !r.name.trim());
    if (emptyName >= 0) { setMessage({ ok: false, text: `第 ${emptyName + 1} 步还没写步骤名` }); return; }
    const emptyPublic = editing.rows.findIndex(r => !r.publicName.trim());
    if (emptyPublic >= 0) { setMessage({ ok: false, text: `第 ${emptyPublic + 1} 步「${editing.rows[emptyPublic].name.trim()}」还没填客户看到的名字` }); return; }
    // 改了步骤名、客户看到的名字、步数或顺序：发布前说清楚影响
    const structural = editing.rows.length !== current.steps.length || editing.rows.some((r, i) =>
      r.from !== i + 1 || r.name.trim() !== current.steps[i].name || r.publicName.trim() !== current.steps[i].publicName);
    if (structural && !window.confirm("这次改了步骤名、客户看到的名字、步数或顺序。\n发布后：之后新建的单（包括商城、客户站来的）按新流程走，客户看到你填的名字。\n已经建好的单一点不变，客户那边看到的也不变。\n\n确定发布？")) return;
    setBusy(true); setMessage(null);
    try {
      const steps = editing.rows.map(r => ({
        from: r.from, name: r.name.trim(), public_name: r.publicName.trim(), assignee: r.assignee, notes: r.notes,
        docs: r.docsText.split("\n").map(x => x.trim()).filter(Boolean),
        expected_days: r.days.trim() === "" ? null : Number(r.days),
      }));
      const d = await postJson(`/api/workflows/${templateId}/publish`, { steps, note: editing.note, base_version_id: editing.baseVersionId }) as { version: number };
      setMessage({ ok: true, text: `发布好了（第 ${d.version} 版）。之后新建的单按这一版；已经建好的单不跟着变，也不按新天数算超时。` });
      setEditing(null);
      reload();
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "发布失败" }); }
    finally { setBusy(false); }
  };

  const handleRollback = async (v: Version) => {
    if (!templateId || !window.confirm(`退回到第 ${v.version} 版？会把第 ${v.version} 版原样再发布一次，之后新建的单按它。`)) return;
    setBusy(true); setMessage(null);
    try {
      const d = await postJson(`/api/workflows/${templateId}/rollback`, { version_id: v.id, base_version_id: current?.versionId ?? null }) as { version: number };
      setMessage({ ok: true, text: `退回好了（现在是第 ${d.version} 版，内容同第 ${v.version} 版）。` });
      reload();
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "退回失败" }); }
    finally { setBusy(false); }
  };

  if (user && user.role !== "admin") {
    return <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">流程设置只有管理员能看</p>;
  }

  const isEditing = !!editing && editing.key === current?.key;
  const staffOptions = (value: string) => {
    const names = result?.staff || [];
    return [...(value && !names.includes(value) ? [value] : []), ...names];
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>流程设置</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">每类业务有哪几步、每步叫什么、客户看到的叫什么、默认谁来做、大概几个工作日、要客户交什么资料。改了只影响之后新建的单，已经建好的单不跟着变（客户那边看到的也不变）；设了天数，之后新建的单停在这一步超过天数就提醒经办人和负责人。</p>
      </div>

      {error && <div role="alert" className="rounded-md bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] px-4 py-3 text-sm text-[var(--destructive)]">{error}</div>}
      {message && <div role={message.ok ? "status" : "alert"} className={cn("rounded-md px-4 py-3 text-sm", message.ok ? "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]")}>{message.text}</div>}
      {loading && <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>}

      {!loading && result && (!result.imported || missing > 0) && !error && (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--foreground)]">{!result.imported
            ? "现在这些流程还写在程序里，只能看。导入后才能在这里改。导入只是把现在的流程原样搬进系统，建单行为、客户看到的名字一点不变。"
            : `有 ${missing} 套流程还不在系统里（新加的，或程序里改过、系统里的设置已经不生效），点导入补进来。在这里没改过步骤名的，以前设的天数会带过去；改过步骤名、加减过步骤的，导入后要重新改。`}</p>
          <button type="button" onClick={handleImport} disabled={busy} className="shrink-0 rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">{busy ? "导入中…" : "导入现有流程"}</button>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label="业务和服务" className="flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 xl:max-h-[calc(100vh-12rem)] xl:flex-col xl:flex-nowrap xl:overflow-y-auto">
            {grouped.map(([business, list]) => (
              <div key={business} className="flex w-full flex-col gap-0.5">
                <p className="px-2 pb-1 pt-2 text-xs text-[var(--muted-foreground)]">{business}</p>
                {list.map(e => (
                  <button key={e.key} type="button" onClick={() => { if (editing && !window.confirm("正在改的内容还没发布，确定离开？")) return; setEditing(null); setSelected(e.key); }}
                    className={cn("flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--secondary)]",
                      e.key === current?.key && "bg-[var(--secondary)] font-medium text-[var(--secondary-foreground)]")}>
                    <span className="min-w-0">{e.services.join(" / ")}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {(e.unconfigured || e.neutralSteps === e.steps.length - 1) && <span className="size-1.5 rounded-full bg-[var(--destructive)]" title={e.unconfigured ? "还没配流程" : "客户看到的步骤名都是「办理事项」"} />}
                      <span className="font-mono text-xs text-[var(--muted-foreground)]">{e.steps.length} 步</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {current && (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
              <div className="flex flex-col gap-2 border-b border-[var(--border)] px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium text-[var(--foreground)]">{current.business} · {current.services.join(" / ")}{current.version ? <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">第 {current.version} 版</span> : null}</h2>
                  {result?.imported && current.templateId && !isEditing && (
                    <button type="button" onClick={startEdit} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--muted)]">修改</button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn(chip, "border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]")}>共 {current.steps.length} 步</span>
                  <span className={cn(chip, "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]")}>现在还在办 {current.inProgress} 单</span>
                  {current.copiedSteps > 0 && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]")}>{current.copiedSteps} 步客户看到统一写好的名字和说明</span>}
                  {current.customPublicNames
                    ? <span className={cn(chip, "bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]")}>有的步骤客户看到的名字是在这里填的</span>
                    : current.reviewed && current.copiedSteps === 0 && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--info),var(--background)_88%)] text-[var(--info)]")}>客户看到的名字是 9 月商城开放时写的</span>}
                  {current.neutralSteps > 0 && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--destructive),var(--background)_90%)] text-[var(--destructive)]")}>客户看到「办理事项」的有 {current.neutralSteps} 步</span>}
                  {current.structureLocked && <span className={cn(chip, "border border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]")}>步骤名和顺序不能改（改派要按名字找步骤）</span>}
                  {current.unconfigured && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]")}>还没配流程</span>}
                </div>
                {current.personNames.length > 0 && (
                  <p className="text-xs text-[var(--muted-foreground)]">步骤名里写着人名：{current.personNames.join("、")}。换默认经办人，步骤名不会自动跟着变。</p>
                )}
                {result?.imported && !current.templateId && (
                  <p className="text-xs text-[var(--destructive)]">这套流程不在系统里（新加的，或导入以后程序里又改过，这里设的不生效），点上面的「导入现有流程」补进来。</p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--muted)]/30">
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">#</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">步骤（员工看到）</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">客户看到的名字</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap">默认经办人</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap">预计天数</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)]">要客户交的资料</th>
                      {isEditing && <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] whitespace-nowrap">调整</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {isEditing ? editing!.rows.map((row, i) => {
                      const fixedFirst = i === 0;
                      const lockName = fixedFirst || current.structureLocked;
                      const warnStaff = staffInName(row.publicName);
                      return (
                        <tr key={row.key} className="border-b border-[var(--border)] last:border-0 align-top">
                          <td className="py-3 px-4 font-mono text-xs text-[var(--muted-foreground)]">{i + 1}{row.from === null && <span className="mt-0.5 block font-sans text-[0.7rem] text-[var(--info)]">新加</span>}</td>
                          <td className="py-3 px-4 min-w-[220px]">
                            {lockName
                              ? <span className="text-[var(--foreground)]">{row.name}</span>
                              : <textarea value={row.name} onChange={e => setRow(i, { name: e.target.value })} rows={2} maxLength={200} placeholder="步骤名（员工看到，可以写清楚怎么办）" aria-label={`第 ${i + 1} 步步骤名`} className={input} />}
                            {fixedFirst && <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">固定第一步</span>}
                            <textarea value={row.notes} onChange={e => setRow(i, { notes: e.target.value })} rows={2} maxLength={500} placeholder="步骤说明（员工看到）" className={cn(input, "mt-1")} />
                          </td>
                          <td className="py-3 px-4 min-w-[160px]">
                            {lockName
                              ? <span className="text-[var(--muted-foreground)]">{row.publicName}</span>
                              : <input value={row.publicName} onChange={e => setRow(i, { publicName: e.target.value })} maxLength={40} placeholder="必填，客户看到的" aria-label={`第 ${i + 1} 步客户看到的名字`} className={cn(input, !row.publicName.trim() && "border-[var(--destructive)]")} />}
                            {!lockName && row.publicName.trim() === NEUTRAL && <span className="mt-1 block text-xs text-[var(--destructive)]">写成「办理事项」，客户看不出办到哪了</span>}
                            {(() => {
                              // 这一步原来客户能看到统一说明：步骤名或客户名字一改就对不上了，客户不再看到说明
                              const orig = row.from !== null ? current.steps[row.from - 1] : undefined;
                              if (!orig?.publicDesc) return null;
                              const kept = row.name.trim() === orig.name && row.publicName.trim() === orig.publicName;
                              return <span className={cn("mt-1 block text-xs", kept ? "text-[var(--muted-foreground)]" : "text-[oklch(0.40_0.14_85)]")}>{kept ? "客户还会看到这一步的说明" : "改了名字，客户就看不到这一步的说明了"}</span>;
                            })()}
                            {!lockName && warnStaff.length > 0 && <span className="mt-1 block text-xs text-[oklch(0.40_0.14_85)]">里面有员工名字 {warnStaff.join("、")}，客户会看到</span>}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <select value={row.assignee} onChange={e => setRow(i, { assignee: e.target.value })} disabled={fixedFirst} className={input} title={fixedFirst ? "第一步谁都能操作，不设经办人" : "没写经办人的步骤算订单负责人的"}>
                              <option value="">不预设（算负责人的）</option>
                              {staffOptions(row.assignee).map(n => <option key={n} value={n}>{n}{(result?.staff || []).includes(n) ? "" : isGone(n) ? "（已不在岗，要换人）" : "（原来写的）"}</option>)}
                            </select>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <input type="number" min={0.5} max={365} step={0.5} value={row.days} onChange={e => setRow(i, { days: e.target.value })} placeholder="不设" className={cn(input, "w-20")} aria-label="预计天数（工作日）" />
                          </td>
                          <td className="py-3 px-4 min-w-[160px]">
                            <textarea value={row.docsText} onChange={e => setRow(i, { docsText: e.target.value })} rows={Math.max(2, row.docsText.split("\n").length)} disabled={fixedFirst} placeholder="一行一份" className={input} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {!current.structureLocked && (
                              <div className="flex items-center gap-0.5">
                                <button type="button" onClick={() => moveRow(i, i - 1)} disabled={i <= 1} title="往前挪" aria-label={`第 ${i + 1} 步往前挪`} className="rounded p-1 hover:bg-[var(--muted)] disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                                <button type="button" onClick={() => moveRow(i, i + 1)} disabled={i === 0 || i >= editing!.rows.length - 1} title="往后挪" aria-label={`第 ${i + 1} 步往后挪`} className="rounded p-1 hover:bg-[var(--muted)] disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                                <button type="button" onClick={() => addRow(i)} title="在下面加一步" aria-label={`在第 ${i + 1} 步下面加一步`} className="rounded p-1 hover:bg-[var(--muted)]"><Plus className="size-3.5" /></button>
                                <button type="button" onClick={() => { if (row.from === null || window.confirm(`删掉「${row.name.trim() || `第 ${i + 1} 步`}」？只影响之后新建的单。`)) removeRow(i); }} disabled={fixedFirst || editing!.rows.length <= 2} title="删掉这一步" aria-label={`删掉第 ${i + 1} 步`} className="rounded p-1 text-[var(--destructive)] hover:bg-[var(--muted)] disabled:opacity-30"><Trash2 className="size-3.5" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }) : current.steps.map((s, i) => (
                      <tr key={i} className="border-b border-[var(--border)] last:border-0 align-top">
                        <td className="py-3 px-4 font-mono text-xs text-[var(--muted-foreground)]">{i + 1}</td>
                        <td className="py-3 px-4 min-w-[180px]">
                          <span className="text-[var(--foreground)]">{s.name}</span>
                          {s.external && <span className="ml-1.5 inline-flex rounded-full border border-[var(--border)] bg-[var(--muted)] px-2 py-0.5 text-[0.7rem] text-[var(--muted-foreground)]">外部等待</span>}
                          {i === 0 && <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">固定第一步</span>}
                          {s.notes && <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">{s.notes}</span>}
                        </td>
                        <td className={cn("py-3 px-4 min-w-[160px]", s.publicName === NEUTRAL ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
                          {s.publicName}
                          {s.publicDesc && <span className="mt-0.5 block max-w-[320px] text-xs leading-5 text-[var(--muted-foreground)]">{s.publicDesc}</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {s.assignee ? <span className={isGone(s.assignee) ? "text-[var(--destructive)]" : undefined}>{s.assignee}{isGone(s.assignee) ? "（已不在岗，要换人）" : ""}</span> : <span className="text-[var(--muted-foreground)]">不预设</span>}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">{s.expectedDays != null ? `${s.expectedDays} 天` : <span className="text-[var(--muted-foreground)]">不设</span>}</td>
                        <td className="py-3 px-4 min-w-[160px]">
                          {s.docs.length
                            ? <div className="flex flex-wrap gap-1">{s.docs.map(d => <span key={d} className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-xs">{d}</span>)}</div>
                            : <span className="text-[var(--muted-foreground)]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {isEditing && (
                <div className="flex flex-col gap-2 border-t border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center">
                  <input value={editing!.note} onChange={e => setEditing(prev => prev ? { ...prev, note: e.target.value } : prev)} maxLength={200} placeholder="这次改了什么（可选，记进版本历史）" className={cn(input, "flex-1 py-1.5 text-sm")} />
                  <div className="flex gap-2">
                    <button type="button" onClick={handlePublish} disabled={busy} className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50">{busy ? "发布中…" : "发布"}</button>
                    <button type="button" onClick={() => setEditing(null)} disabled={busy} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--muted)]">取消</button>
                  </div>
                </div>
              )}
              {templateId && versionList.length > 0 && (
                <div className="border-t border-[var(--border)] px-5 py-4">
                  <h3 className="mb-2 text-xs font-medium text-[var(--foreground)]">版本历史</h3>
                  <ul className="flex flex-col gap-1.5">
                    {versionList.map(v => (
                      <li key={v.id} className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                        <span className="font-mono text-[var(--foreground)]">第 {v.version} 版</span>
                        {v.version === current.version && <span className={cn(chip, "bg-[color-mix(in_oklch,var(--success),var(--background)_88%)] text-[var(--success)]")}>正在用</span>}
                        <span>{v.published_by || "—"} · {toThaiTime(v.published_at)}</span>
                        {v.note && <span className="text-[var(--foreground)]">{v.note}</span>}
                        {v.version !== current.version && !isEditing && (
                          <button type="button" onClick={() => handleRollback(v)} disabled={busy} className="ml-auto rounded px-1.5 py-0.5 text-[var(--primary)] hover:bg-[var(--muted)] disabled:opacity-50">退回到这一版</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
