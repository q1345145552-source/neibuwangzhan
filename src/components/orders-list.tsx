"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Plus, Search, ArrowUpDown, Trash2, Download } from "lucide-react";
import { fetchOrders, fetchBusinessTypes, deleteOrder } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { statusClass, statusLabels } from "@/lib/api";
import type { Order, BusinessType } from "@/lib/api";
import { cn, toThaiTime, formatCurrency } from "@/lib/utils";
import { exportToExcel, type ExportColumn } from "@/lib/export";
import { bangkokDateStr } from "@/lib/time";

/** 订单管理列表；unclassifiedOnly 时只列「待分类」业务线（侧栏「待分类（待领取）」，2026-10-15） */
export function OrdersList({ unclassifiedOnly = false }: { unclassifiedOnly?: boolean }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [orders, setOrders] = useState<Order[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  // 搜索词、状态、业务线、快捷筛选都记在网址里（2026-10-16）：点进一张单再返回，列表还是原来筛好的样子
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "all");
  const [businessFilter, setBusinessFilter] = useState(() => searchParams.get("biz") || "all");
  const [sortField, setSortField] = useState<"total_amount" | "created_at" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  // 快捷筛选（2026-10-16）：我负责的 / 还没人负责 / 卡住的 / 办完没收齐
  const [quick, setQuick] = useState<"all" | "mine" | "unowned" | "blocked" | "overdue" | "unpaid">(() => {
    const q = searchParams.get("quick");
    return q === "mine" || q === "unowned" || q === "blocked" || q === "overdue" || q === "unpaid" ? q : "all";
  });
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (businessFilter !== "all" && !unclassifiedOnly) params.set("biz", businessFilter);
    if (quick !== "all") params.set("quick", quick);
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
    // 只在筛选变了时写网址；searchParams 跟着网址变，不放进依赖免得来回写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, businessFilter, quick, unclassifiedOnly, pathname]);
  const [deleteTarget, setDeleteTarget] = useState<{id:string,name:string}|null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function run() {
      try {
        const types: BusinessType[] = await fetchBusinessTypes().catch(() => []);
        if (ignore) return;
        setBusinessTypes(types);
        const params: { business_type_id?: number; status?: string } = {};
        if (unclassifiedOnly) {
          const bt = types.find((b) => b.name === "待分类");
          if (!bt) { setOrders([]); return; }
          params.business_type_id = bt.id;
        } else if (businessFilter && businessFilter !== "all") params.business_type_id = Number(businessFilter);
        if (statusFilter && statusFilter !== "all") params.status = statusFilter;
        const data = await fetchOrders(params);
        if (!ignore) setOrders(data);
      } catch (err) {
        console.error("Orders load error:", err);
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    run();
    return () => { ignore = true; };
  }, [businessFilter, statusFilter, unclassifiedOnly]);

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      await deleteOrder(deleteTarget.id);
      setOrders(prev => prev.filter(o => o.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      console.error("删除订单失败:", err);
      setErrorMsg(err instanceof Error ? err.message : "删除失败，请重试");
    } finally {
      setDeleting(false);
    }
  };

  // 搜索也认客户站单号（客户来问一般报 ORD2026…）
  const matchesSearch = (o: Order) => {
    const q = search.trim().toLowerCase();
    return !q || o.id.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) ||
      (o.trademark_name || "").toLowerCase().includes(q) || (o.source_order_no || "").toLowerCase().includes(q);
  };
  const me = (user?.name || "").trim().toLowerCase();
  const owners = (o: Order) => (o.responsible_person || "").split(/[\/、,，]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const live = (o: Order) => o.status !== "客户取消" && o.status !== "已完成";
  // 办完没收齐：订单金额填了就按同币种已到账比；金额没填就看有没有核对过到账的收入。商城单的钱以商城账单为准，不算
  // 客户站来的单：客户站账单标了已付也算收到（钱可能是在客户站确认的）
  const unpaidDone = (o: Order) => o.status === "已完成" && o.source_system !== "commerce" && o.payment?.client_billing !== "paid" &&
    (Number(o.total_amount) > 0 ? (o.payment?.arrived || 0) < Number(o.total_amount) : !o.payment?.has_arrived);
  const quickTest = (key: typeof quick, o: Order) =>
    key === "mine" ? owners(o).includes(me) && o.status !== "客户取消"
    : key === "unowned" ? owners(o).length === 0 && live(o)
    : key === "blocked" ? (o.progress?.blocked.length || 0) > 0 && live(o)
    : key === "overdue" ? !!o.progress?.overdue && live(o)
    : key === "unpaid" ? unpaidDone(o)
    : true;
  const filtered = orders.filter((o) => matchesSearch(o) && quickTest(quick, o));

  const sorted = sortField
    ? [...filtered].sort((a, b) => {
        const va = sortField === "total_amount" ? a.total_amount : new Date(a.created_at).getTime();
        const vb = sortField === "total_amount" ? b.total_amount : new Date(b.created_at).getTime();
        return sortDir === "asc" ? va - vb : vb - va;
      })
    : filtered;

  const toggleSort = (field: "total_amount" | "created_at") => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("desc"); }
  };

  const handleExport = () => {
    const filtered_ = filtered;
    const cols: ExportColumn<Order>[] = [
      { header: "订单编号", key: "id", width: 16 },
      { header: "客户名称", key: "customer_name" },
      { header: "业务类型", render: (r) => businessTypes.find(b => b.id === r.business_type_id)?.name || "—" },
      { header: "商标名称", render: (r) => r.trademark_name || "—" },
      { header: "客户站单号", render: (r) => r.source_order_no || "—" },
      { header: "进度", render: (r) => r.progress ? `${r.progress.closed}/${r.progress.total} ${r.progress.current_step}` : "—" },
      { header: "金额", render: (r) => formatCurrency(r.total_amount, r.currency) },
      { header: "已到账", render: (r) => r.payment ? formatCurrency(r.payment.arrived, r.currency) : "—" },
      { header: "状态", render: (r) => statusLabels[r.status] || r.status },
      { header: "创建时间", render: (r) => toThaiTime(r.created_at) },
    ];
    exportToExcel(filtered_, cols, `订单列表_${bangkokDateStr()}`);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: Title + new order button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]" style={{ textWrap: "balance" }}>{unclassifiedOnly ? "待分类（待领取）" : "订单管理"}</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{loading ? "加载中..." : unclassifiedOnly
            ? `一共 ${orders.length} 条，其中 ${orders.filter((o) => !(o.responsible_person || "").trim() && o.status !== "客户取消" && o.status !== "已完成").length} 条还没人领。点进订单，在「编辑」里填上负责人就是认领，再改派到对应业务线。`
            : `一共 ${orders.length} 条，搜一下更快`}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium transition-all hover:bg-[var(--muted)]">
            <Download className="size-3.5" />导出
          </button>
          <Link href="/orders/new" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-all hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]">
            <Plus className="size-3.5" aria-hidden="true" />新建订单
          </Link>
        </div>
      </div>

      {/* Row 2: Search bar — full width */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            ref={searchInputRef}
            defaultValue={search}
            placeholder="输入订单号、客户站单号（ORD…）或客户名称搜索..."
            aria-label="搜索订单"
            onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInputRef.current?.value || ""); } }}
            className="h-10 w-full pl-9 pr-3 text-sm rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        <button
          onClick={() => setSearch(searchInputRef.current?.value || "")}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_15%)] transition-colors"
        >
          <Search className="size-3.5" />搜索
        </button>
      </div>

      {/* Row 3: Status + business filter + sort */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="按状态筛选" className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
          <option value="all">全部状态</option>
          <option value="待处理">待处理</option>
          <option value="进行中">进行中</option>
          <option value="已完成">已完成</option>
          <option value="客户取消">客户取消</option>
        </select>
        {user?.role !== "client" && (
          <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5" role="group" aria-label="快捷筛选">
            {([["all", "全部"], ["mine", "我负责的"], ["unowned", "还没人负责"], ["blocked", "卡住的"], ["overdue", "超时的"], ["unpaid", "办完没收齐"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setQuick(key)} aria-pressed={quick === key}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", quick === key ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]")}>
                {label}
                {key !== "all" && <span className="ml-1 tabular-nums">{orders.filter((o) => matchesSearch(o) && quickTest(key, o)).length}</span>}
              </button>
            ))}
          </div>
        )}
        {!unclassifiedOnly && (
        <select value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)} aria-label="按业务线筛选" className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20">
          <option value="all">全部业务线</option>
          {businessTypes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--background)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">订单号</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">商标名称</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">客户</th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-md:hidden">负责人</th>
              {user?.role !== "client" && <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-lg:hidden">进度</th>}
              <th className="py-3 px-4 text-right text-xs font-medium text-[var(--muted-foreground)] tracking-wide" aria-sort={sortField === "total_amount" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline" onClick={() => toggleSort("total_amount")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("total_amount"); } }}>
                  金额<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide max-sm:hidden" aria-sort={sortField === "created_at" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" className="inline-flex cursor-pointer items-center gap-1 select-none focus-visible:outline-none focus-visible:underline" onClick={() => toggleSort("created_at")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort("created_at"); } }}>
                  日期<ArrowUpDown className="size-3" />
                </button>
              </th>
              <th className="py-3 px-4 text-left text-xs font-medium text-[var(--muted-foreground)] tracking-wide">状态</th>
              {user?.role === "admin" && <th className="py-3 px-4 text-center text-xs font-medium text-[var(--muted-foreground)] tracking-wide w-16">操作</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((order) => (
              <tr key={order.id} className="border-b border-[var(--border)] transition-colors hover:bg-[var(--secondary)]">
                <td className="py-3 px-4">
                  <Link href={`/orders/${order.id}`} className="font-mono text-xs font-medium text-[var(--accent-foreground)] hover:underline tabular-nums">{order.id}</Link>
                  {order.source_order_no && <div className="mt-0.5 font-mono text-[0.65rem] text-[var(--muted-foreground)]" title="客户站单号">{order.source_order_no}</div>}
                </td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{order.trademark_name || "—"}</td>
                <td className="py-3 px-4 max-md:hidden">
                  <div className="font-medium text-[var(--foreground)]">{order.customer_name}</div>
                </td>
                <td className="py-3 px-4 max-md:hidden text-[var(--foreground)]">{(order.responsible_person || "").trim() || <span className="text-xs text-[var(--destructive)]">没人负责</span>}</td>
                {user?.role !== "client" && (
                  <td className="py-3 px-4 max-lg:hidden text-xs">
                    {order.progress && order.progress.total > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="tabular-nums text-[var(--muted-foreground)]">{order.progress.closed}/{order.progress.total}{order.progress.current_step && order.status !== "已完成" && order.status !== "客户取消" ? <> · <span className="text-[var(--foreground)]">{order.progress.current_step}</span>{order.progress.more_active > 0 ? ` 等 ${order.progress.more_active + 1} 步` : ""}</> : ""}</span>
                        {order.status !== "已完成" && order.status !== "客户取消" && order.progress.current_step && (
                          <span className="text-[var(--muted-foreground)]">{order.progress.current_assignee || ((order.responsible_person || "").trim() ? `负责人 ${order.responsible_person}` : "没写经办人")}</span>
                        )}
                        {order.progress.blocked.length > 0 && order.status !== "客户取消" && <span className="text-[var(--destructive)]">卡住：{order.progress.blocked.join("、")}</span>}
                        {order.progress.overdue && order.status !== "客户取消" && order.status !== "已完成" && (
                          <span className="text-[var(--destructive)]">超时：已 {order.progress.overdue.elapsed} 个工作日（设定 {order.progress.overdue.expected} 天）</span>
                        )}
                      </div>
                    ) : <span className="text-[var(--muted-foreground)]">—</span>}
                  </td>
                )}
                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-[var(--foreground)]">
                  {formatCurrency(order.total_amount, order.currency)}
                  {/* 已到账只算老板核对过的收入（同币种），2026-10-16 */}
                  {order.payment && order.source_system !== "commerce" && (order.payment.has_income || order.status === "已完成" || order.payment.client_billing) && (
                    <div className={cn("mt-0.5 font-sans", unpaidDone(order) ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
                      {(order.payment.has_income || !order.payment.client_billing) && <>已到账 {formatCurrency(order.payment.arrived, order.currency)}{order.payment.arrived_other > 0 ? " +外币" : ""}{order.payment.waiting > 0 ? `，${order.payment.waiting} 笔待核对` : ""}</>}
                      {order.payment.client_billing && <div>客户站账单：{order.payment.client_billing === "paid" ? "已付" : "未付"}</div>}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 font-mono text-xs tabular-nums text-[var(--muted-foreground)] max-sm:hidden">{toThaiTime(order.created_at)}</td>
                <td className="py-3 px-4">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", statusClass[order.status])}>{statusLabels[order.status]}</span>
                </td>
                {/* 10-16 老板定：只有管理员能删订单，员工只能在订单里「取消订单」 */}
                {user?.role === "admin" && (
                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => setDeleteTarget({ id: order.id, name: order.customer_name })}
                      className="inline-flex items-center justify-center rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] transition-colors"
                      title="删除订单"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && sorted.length === 0 && <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">没有匹配的订单</div>}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-[var(--foreground)]">确认删除</h3>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              确定要删除订单 <span className="font-mono font-medium text-[var(--foreground)]">{deleteTarget.id}</span>（{deleteTarget.name}）吗？此操作会同时删除所有关联的步骤、文档、费用和证书，且不可恢复。
            </p>
            {errorMsg && <p className="mt-3 text-sm text-[var(--destructive)]">{errorMsg}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50">取消</button>
              <button onClick={handleConfirmDelete} disabled={deleting} className="rounded-lg bg-[var(--destructive)] px-4 py-2 text-sm font-medium text-white hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_20%)] transition-colors disabled:opacity-50">
                {deleting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
