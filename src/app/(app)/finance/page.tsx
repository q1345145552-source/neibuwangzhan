"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Search, TrendingUp, TrendingDown, Download, ChevronDown, X } from "lucide-react";
import { fetchAllFinances, fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime, toThaiDate, bangkokDateStr, fileUrl } from "@/lib/utils";
import { ShopFeeEntryDialog, ShopFeeReviewDialog, ShopFeeDetails, type ShopFeeRecord } from "@/components/finance-shop-fees";
import { exportToExcel, type ExportColumn } from "@/lib/export";

const typeLabels: Record<string, string> = { income: "收入", expense: "支出", refund: "退款" };
// 支出新建默认是 pending、可以改成已取消：原来这两个没有中文，页面上直接露出英文（2026-10-16，跟订单详情的叫法一样）
const statusLabels: Record<string, string> = { paid: "已支付", unpaid: "未支付", refunded: "已退款", pending: "待付", cancelled: "已取消" };
// 10-13 核对功能上线前录的收入有的是 pending（页面显示「待付」）：一律当待核对，老板点一下核对就行（2026-10-15）
const isWaitingIncome = (r: { type: string; status: string }) => r.type === "income" && (r.status === "待核对" || r.status === "pending");
const rowStatusLabel = (r: { type: string; status: string }) => isWaitingIncome(r) ? "待核对" : statusLabels[r.status] || r.status;
const statusClass: Record<string, string> = {
  paid: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  unpaid: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  refunded: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};

// 币种分开的钱数展示：¥x + ฿y（为 0 的币种省略，全 0 显示 ¥0）
function fmtMoney(cny: number, thb: number): string {
  const parts: string[] = [];
  if (cny) parts.push(`¥${cny.toLocaleString()}`);
  if (thb) parts.push(`฿${thb.toLocaleString()}`);
  return parts.length ? parts.join(" + ") : "¥0";
}

// 利润按币种分别上色：正数绿色、负数红色、0 中性
function profitNode(cny: number, thb: number) {
  const color = (v: number) => (v > 0 ? "text-emerald-600" : v < 0 ? "text-red-500" : "text-[var(--muted-foreground)]");
  const items: { v: number; sym: string }[] = [];
  if (cny) items.push({ v: cny, sym: "¥" });
  if (thb) items.push({ v: thb, sym: "฿" });
  if (!items.length) return <span className="text-[var(--muted-foreground)] tabular-nums">¥0</span>;
  return (
    <span className="tabular-nums">
      {items.map((it, i) => (
        <span key={it.sym} className={color(it.v)}>
          {i > 0 && <span className="text-[var(--muted-foreground)]"> + </span>}
          {it.sym}{it.v.toLocaleString()}
        </span>
      ))}
    </span>
  );
}

// 最近 12 个月（曼谷时区，当月在前），value 为 YYYY-MM
function last12Months(): { value: string; label: string }[] {
  const bangkokNow = new Date(Date.now() + 7 * 3600 * 1000);
  let y = bangkokNow.getUTCFullYear();
  let m = bangkokNow.getUTCMonth();
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    out.push({ value: `${y}-${String(m + 1).padStart(2, "0")}`, label: `${y}年${m + 1}月` });
    m--;
    if (m < 0) { m = 11; y--; }
  }
  return out;
}

interface FinanceRecord {
  id: number;
  order_id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  payment_method: string;
  slip_number: string;
  slip_file: string;
  created_at: string;
  customer_name?: string;
  commerce_refund?: boolean;
  business_type_id?: number;
  business_name?: string;
  currency?: string;
  created_by?: string;
  verify_by?: string;
  verify_at?: string;
  verify_note?: string;
  order_total?: number;
  order_currency?: string;
}
// 已取消的支出不算进总支出、利润
const countsAsExpense = (r: { type: string; status: string }) => r.type === "expense" && r.status !== "cancelled";

export default function FinancePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [allFinances, setAllFinances] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<string | null>(null);

  // 收入到账核对弹窗
  const [verifyTarget, setVerifyTarget] = useState<FinanceRecord | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyErr, setVerifyErr] = useState("");
  const [verifying, setVerifying] = useState(false);

  // 店铺管理费用（收付款 Tab 的数据）
  const [shopFees, setShopFees] = useState<ShopFeeRecord[]>([]);
  const [shopEntryOpen, setShopEntryOpen] = useState(false);
  const [shopReviewTarget, setShopReviewTarget] = useState<ShopFeeRecord | null>(null);
  const canRecordShopFee = user?.role === "admin" || user?.role === "employee";
  const [showShopDetail, setShowShopDetail] = useState(false);

  useEffect(() => {
    fetchWithAuth("/api/shop-fees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setShopFees(previous => [...new Map([...(Array.isArray(d) ? d as ShopFeeRecord[] : []), ...previous].map(fee => [fee.id, fee])).values()]))
      .catch(() => { /* 保留本页刚录入或核对成功的记录。 */ });
  }, []);

  const reload = async () => {
    try {
      setAllFinances(await fetchAllFinances());
    } catch {
      console.error("Failed to load finances");
    }
  };

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  // 先按月份（费用创建时间的泰国时间）过滤
  const monthFiltered = useMemo(() => {
    if (monthFilter === "all") return allFinances;
    return allFinances.filter((r) => (toThaiDate(r.created_at) || "").slice(0, 7) === monthFilter);
  }, [allFinances, monthFilter]);

  const filtered = useMemo(() => {
    let result = [...monthFiltered];
    if (pendingOnly) {
      result = result.filter((r: FinanceRecord) => isWaitingIncome(r));
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (r: FinanceRecord) =>
          (r.description || "").toLowerCase().includes(s) ||
          (r.order_id || "").toLowerCase().includes(s) ||
          (r.customer_name || "").toLowerCase().includes(s) ||
          (r.business_name || "").toLowerCase().includes(s)
      );
    }
    if (typeFilter !== "all") {
      result = result.filter((r: FinanceRecord) => (r.commerce_refund ? "refund" : r.type) === typeFilter);
    }
    return result;
  }, [monthFiltered, search, typeFilter, pendingOnly]);

  // 待核对收入数量（给「待核对」标签带数字）
  const pendingVerifyCount = useMemo(
    () => allFinances.filter((r: FinanceRecord) => isWaitingIncome(r)).length,
    [allFinances]
  );

  // 按币种分别汇总（人民币和泰铢不能直接相加），返回 "¥x + ฿y" 形式的展示文案
  const sumByCurrency = (rows: FinanceRecord[]): string => {
    const cny = rows.filter((r) => ((r as { currency?: string }).currency || "CNY") === "CNY").reduce((s, r) => s + Number(r.amount), 0);
    const thb = rows.filter((r) => (r as { currency?: string }).currency === "THB").reduce((s, r) => s + Number(r.amount), 0);
    if (thb === 0) return `¥${cny.toLocaleString()}`;
    if (cny === 0) return `฿${thb.toLocaleString()}`;
    return `¥${cny.toLocaleString()} + ฿${thb.toLocaleString()}`;
  };
  const totalIncome = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => r.type === "income" && r.status === "paid")),
    [filtered]
  );
  const totalExpense = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => countsAsExpense(r))),
    [filtered]
  );
  const totalRefund = useMemo(
    () => sumByCurrency(filtered.filter(r => r.commerce_refund)),
    [filtered]
  );
  const totalPending = useMemo(
    // 只算支出：核对上线前的 pending 收入已经算进「待核对」，不再重复算进待付（2026-10-16）
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => (r.status === "unpaid" || r.status === "pending") && !isWaitingIncome(r))),
    [filtered]
  );
  const totalPendingVerify = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => isWaitingIncome(r))),
    [filtered]
  );
  const totalNotReceived = useMemo(
    () => sumByCurrency(filtered.filter((r: FinanceRecord) => r.type === "income" && r.status === "未到账")),
    [filtered]
  );

  // 按业务线分组汇总：收入=已支付收入、支出=全部支出、利润=收入-支出，币种分开
  const businessGroups = useMemo(() => {
    const map = new Map<string, { name: string; incomeCNY: number; incomeTHB: number; expenseCNY: number; expenseTHB: number }>();
    for (const r of monthFiltered) {
      const name = r.business_name || "未分类";
      let g = map.get(name);
      if (!g) {
        g = { name, incomeCNY: 0, incomeTHB: 0, expenseCNY: 0, expenseTHB: 0 };
        map.set(name, g);
      }
      const isTHB = r.currency === "THB";
      const amount = Number(r.amount) || 0;
      if (r.type === "income" && r.status === "paid") {
        if (isTHB) g.incomeTHB += amount; else g.incomeCNY += amount;
      } else if (countsAsExpense(r)) {
        if (isTHB) g.expenseTHB += amount; else g.expenseCNY += amount;
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "zh"));
  }, [monthFiltered]);

  // 当前点开的业务线（汇总沿用 businessGroups，保证和分组卡片数字一致）
  const selectedGroup = useMemo(
    () => businessGroups.find((g) => g.name === selectedBusiness) || null,
    [businessGroups, selectedBusiness]
  );

  // 该业务线下所有订单的费用明细（按时间倒序）
  const selectedDetails = useMemo(() => {
    if (!selectedBusiness) return [];
    return monthFiltered
      .filter((r) => (r.business_name || "未分类") === selectedBusiness)
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [monthFiltered, selectedBusiness]);

  // 店铺管理分组汇总：总收入=已到账收入、待核对、未到账、总支出、利润=已到账-支出，币种分开
  const shopSummary = useMemo(() => {
    const s = { incomeCNY: 0, incomeTHB: 0, pendingCNY: 0, pendingTHB: 0, notReceivedCNY: 0, notReceivedTHB: 0, expenseCNY: 0, expenseTHB: 0 };
    for (const r of shopFees) {
      const isTHB = r.currency === "THB";
      const amount = Number(r.amount) || 0;
      if (r.fee_type === "收入") {
        if (r.status === "已到账") { if (isTHB) s.incomeTHB += amount; else s.incomeCNY += amount; }
        else if (r.status === "待核对") { if (isTHB) s.pendingTHB += amount; else s.pendingCNY += amount; }
        else if (r.status === "未到账") { if (isTHB) s.notReceivedTHB += amount; else s.notReceivedCNY += amount; }
      } else if (r.fee_type === "支出") {
        if (isTHB) s.expenseTHB += amount; else s.expenseCNY += amount;
      }
    }
    return s;
  }, [shopFees]);

  // 店铺管理明细（按时间倒序）
  const shopDetails = useMemo(
    () => [...shopFees].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [shopFees]
  );

  // 导出当前筛选后的费用明细为 Excel
  const handleExport = () => {
    const statusText: Record<string, string> = { paid: "已支付", unpaid: "未支付", refunded: "已退款", pending: "待付", cancelled: "已取消" };
    const cols: ExportColumn<FinanceRecord>[] = [
      { header: "订单号", render: (r) => r.order_id || "-" },
      { header: "客户名", render: (r) => r.customer_name || "-" },
      { header: "业务线", render: (r) => r.business_name || "未分类" },
      { header: "类型", render: (r) => (r.commerce_refund ? "退款" : typeLabels[r.type] || r.type) },
      { header: "金额", render: (r) => `${r.currency === "THB" ? "฿" : "¥"}${Number(r.amount).toLocaleString()}` },
      { header: "币种", render: (r) => (r.currency === "THB" ? "泰铢" : "人民币") },
      { header: "状态", render: (r) => isWaitingIncome(r) ? "待核对" : statusText[r.status] || r.status },
      { header: "描述", render: (r) => r.description || "-" },
      { header: "日期", render: (r) => toThaiDate(r.created_at) || "-" },
    ];
    exportToExcel(filtered, cols, `费用明细${bangkokDateStr()}`);
  };

  // 可核对：待核对 或 未到账 的收入（点击打开核对详情）
  const isVerifyable = (r: FinanceRecord) => isWaitingIncome(r) || (r.type === "income" && r.status === "未到账");

  // 打开收入核对详情
  const openVerify = (r: FinanceRecord) => {
    setVerifyTarget(r);
    setVerifyNote("");
    setVerifyErr("");
  };

  // 老板核对：已到账 / 未到账
  const doVerify = async (action: "arrived" | "not_arrived") => {
    if (!verifyTarget) return;
    if (action === "not_arrived" && !verifyNote.trim()) { setVerifyErr("请填写未到账原因"); return; }
    setVerifying(true);
    setVerifyErr("");
    try {
      const res = await fetchWithAuth(`/api/orders/${verifyTarget.order_id}/finances/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finance_id: verifyTarget.id, action, note: verifyNote.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setVerifyTarget(null);
        setVerifyNote("");
        setVerifyErr("");
        reload();
      } else {
        setVerifyErr(d.error || "核对失败");
      }
    } catch {
      setVerifyErr("核对失败，请重试");
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">费用管理</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">所有订单的收入与支出明细</p>
      </div>

      {/* 按业务线分组 */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-[var(--foreground)]">按业务线分组</h2>
        {businessGroups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">暂无费用数据</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {businessGroups.map((g) => {
              const open = selectedBusiness === g.name;
              return (
                <div
                  key={g.name}
                  onClick={() => setSelectedBusiness(open ? null : g.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedBusiness(open ? null : g.name); } }}
                  className={cn(
                    "cursor-pointer rounded-xl border bg-[var(--card)] p-4 transition-colors",
                    open ? "border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">{g.name}</p>
                    <ChevronDown className={cn("size-4 shrink-0 text-[var(--muted-foreground)] transition-transform", open && "rotate-180")} />
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted-foreground)]">总收入</span>
                      <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(g.incomeCNY, g.incomeTHB)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-[var(--muted-foreground)]">总支出</span>
                      <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(g.expenseCNY, g.expenseTHB)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2">
                      <span className="text-xs text-[var(--muted-foreground)]">利润</span>
                      {profitNode(g.incomeCNY - g.expenseCNY, g.incomeTHB - g.expenseTHB)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 店铺管理分组 */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium text-[var(--foreground)]">店铺管理分组</h2>{canRecordShopFee && <Button type="button" size="sm" className="min-h-11" onClick={() => setShopEntryOpen(true)}>录入</Button>}</div>
        <div
          onClick={() => setShowShopDetail((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowShopDetail((v) => !v); } }}
          className={cn(
            "cursor-pointer rounded-xl border bg-[var(--card)] p-4 transition-colors",
            showShopDetail ? "border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">店铺管理</p>
            <ChevronDown className={cn("size-4 shrink-0 text-[var(--muted-foreground)] transition-transform", showShopDetail && "rotate-180")} />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-xs text-[var(--muted-foreground)]">总收入</span>
              <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(shopSummary.incomeCNY, shopSummary.incomeTHB)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-xs text-[var(--muted-foreground)]">待核对金额</span>
              <span className="tabular-nums text-[var(--warning)]">{fmtMoney(shopSummary.pendingCNY, shopSummary.pendingTHB)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-xs text-[var(--muted-foreground)]">未到账金额</span>
              <span className="tabular-nums text-[var(--destructive)]">{fmtMoney(shopSummary.notReceivedCNY, shopSummary.notReceivedTHB)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-xs text-[var(--muted-foreground)]">总支出</span>
              <span className="tabular-nums text-[var(--foreground)]">{fmtMoney(shopSummary.expenseCNY, shopSummary.expenseTHB)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-xs text-[var(--muted-foreground)]">利润</span>
              {profitNode(shopSummary.incomeCNY - shopSummary.expenseCNY, shopSummary.incomeTHB - shopSummary.expenseTHB)}
            </div>
          </div>
        </div>
      </div>

      {/* 店铺管理明细 */}
      {showShopDetail && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <button onClick={() => setShowShopDetail(false)} className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]" aria-label="关闭明细">
                <X className="size-4" />
              </button>
              <h3 className="text-sm font-medium text-[var(--foreground)]">店铺管理明细</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{shopDetails.length} 笔</span>
            </div>
          </div>

          <ShopFeeDetails fees={shopDetails} isAdmin={isAdmin} onReview={setShopReviewTarget} />
        </div>
      )}

      {shopEntryOpen && canRecordShopFee && <ShopFeeEntryDialog onClose={() => setShopEntryOpen(false)} onSaved={fee => { setShopFees(previous => [fee, ...previous.filter(row => row.id !== fee.id)]); setShowShopDetail(true); }} />}
      {shopReviewTarget && isAdmin && <ShopFeeReviewDialog key={shopReviewTarget.id} fee={shopReviewTarget} onClose={() => setShopReviewTarget(null)} onSaved={fee => setShopFees(previous => previous.map(row => row.id === fee.id ? fee : row))} />}

      {/* 业务线明细 */}
      {selectedGroup && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedBusiness(null)}
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                aria-label="关闭明细"
              >
                <X className="size-4" />
              </button>
              <h3 className="text-sm font-medium text-[var(--foreground)]">{selectedGroup.name}</h3>
              <span className="text-xs text-[var(--muted-foreground)]">{selectedDetails.length} 笔费用</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
              <span className="text-[var(--muted-foreground)]">总收入 <span className="ml-1 text-[var(--foreground)] tabular-nums">{fmtMoney(selectedGroup.incomeCNY, selectedGroup.incomeTHB)}</span></span>
              <span className="text-[var(--muted-foreground)]">总支出 <span className="ml-1 text-[var(--foreground)] tabular-nums">{fmtMoney(selectedGroup.expenseCNY, selectedGroup.expenseTHB)}</span></span>
              <span className="text-[var(--muted-foreground)]">利润 {profitNode(selectedGroup.incomeCNY - selectedGroup.expenseCNY, selectedGroup.incomeTHB - selectedGroup.expenseTHB)}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left">
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">订单号</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">客户名</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">类型</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">金额</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">币种</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">状态</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">描述</th>
                  <th className="px-4 py-2.5 font-medium text-[var(--muted-foreground)]">时间</th>
                </tr>
              </thead>
              <tbody>
                {selectedDetails.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无费用明细</td>
                  </tr>
                ) : (
                  selectedDetails.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{r.order_id || "-"}</td>
                      <td className="px-4 py-2.5">{r.customer_name || "-"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                        )}>
                          {typeLabels[r.type] || r.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono tabular-nums">{r.currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">{r.currency === "THB" ? "泰铢" : "人民币"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>{rowStatusLabel(r)}</span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[200px] truncate">{r.description || "-"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--muted-foreground)]">{toThaiTime(r.created_at) || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingUp className="size-4 text-[var(--success)]" />总收入
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{totalIncome}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">已到账的收入才算进去</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            待核对金额
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">{totalPendingVerify}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">收入里待核对状态的金额</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            未到账金额
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--destructive)]">{totalNotReceived}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">收入里未到账状态的金额</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <TrendingDown className="size-4 text-[var(--destructive)]" />总支出
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{totalExpense}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">全部支出，包括还没支付的</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">其中商城实际退款 {totalRefund}（不是办理成本）</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            待付余额
          </div>
          <p className="mt-1 text-2xl font-semibold text-[var(--warning)]">{totalPending}</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">未支付 + 待处理 的金额</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
        >
          <option value="all">全部</option>
          {last12Months().map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            placeholder="搜索描述/订单号/客户名/业务线..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {["all", "income", "expense", "refund"].map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "ghost"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => { setTypeFilter(t); setPendingOnly(false); }}
            >
              {t === "all" ? "全部" : typeLabels[t]}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant={pendingOnly ? "default" : "outline"}
          className={cn("h-8 text-xs gap-1", pendingOnly && "bg-[var(--warning)] text-[oklch(0.40_0.14_85)] border-[var(--warning)]")}
          onClick={() => { setPendingOnly(!pendingOnly); setTypeFilter("all"); }}
        >
          待核对{pendingVerifyCount > 0 ? ` ${pendingVerifyCount}` : ""}
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
          <Download className="size-4" />导出 Excel
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-[var(--border)] text-left">
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">类型</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">金额</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">状态</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">描述</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">客户</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">订单号</th>
                <th className="px-4 py-3 font-medium text-[var(--muted-foreground)]">日期</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[var(--muted-foreground)]">暂无费用记录</td>
                </tr>
              ) : (
                filtered.map((r: FinanceRecord) => (
                  <tr key={r.id} onClick={() => isVerifyable(r) && openVerify(r)} className={cn("border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50", isVerifyable(r) && "cursor-pointer")}>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                        r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                      )}>
                        {r.commerce_refund ? "退款" : typeLabels[r.type] || r.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">{(r as { currency?: string }).currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>
                        {rowStatusLabel(r)}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{r.description || "-"}</td>
                    <td className="px-4 py-3 max-w-[160px] truncate text-xs">{r.customer_name || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.order_id ? <Link href={`/orders/${r.order_id}`} onClick={(e) => e.stopPropagation()} className="text-[var(--primary)] hover:underline">{r.order_id}</Link> : "-"}</td>
                    <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">{toThaiDate(r.created_at) || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* 手机端卡片 */}
          <div className="md:hidden flex flex-col gap-2 p-3">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">暂无费用记录</p>
            ) : filtered.map((r: FinanceRecord) => (
              <div key={r.id} onClick={() => isVerifyable(r) && openVerify(r)} className={cn("rounded-lg border border-[var(--border)] bg-[var(--card)] p-4", isVerifyable(r) && "cursor-pointer")}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
                    r.type === "income" ? "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]" : "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]"
                  )}>{typeLabels[r.type] || r.type}</span>
                  <span className="font-mono tabular-nums text-sm">{(r as { currency?: string }).currency === "THB" ? "฿" : "¥"}{Number(r.amount).toLocaleString()}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs", statusClass[r.status] || "bg-[var(--muted)]")}>{rowStatusLabel(r)}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">{toThaiDate(r.created_at) || "-"}</span>
                </div>
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">描述</span><span className="text-right">{r.description || "—"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">客户</span><span className="text-right">{r.customer_name || "—"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-[var(--muted-foreground)]">订单号</span>{r.order_id ? <Link href={`/orders/${r.order_id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-[var(--primary)] hover:underline">{r.order_id}</Link> : <span className="font-mono text-xs">—</span>}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 收入到账核对详情弹窗 */}
      {verifyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setVerifyTarget(null)}>
          <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">收入到账核对</h3>
              <button onClick={() => setVerifyTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">金额</span><span className="font-mono font-medium text-[var(--foreground)]">{verifyTarget.currency === "THB" ? "฿" : "¥"}{Number(verifyTarget.amount).toLocaleString()}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">客户</span><span className="text-right">{verifyTarget.customer_name || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">订单号</span>{verifyTarget.order_id ? <Link href={`/orders/${verifyTarget.order_id}`} className="font-mono text-xs text-[var(--primary)] hover:underline">{verifyTarget.order_id}（打开订单）</Link> : <span className="font-mono text-xs">—</span>}</div>
              {(() => {
                // 对着这张单该收多少：订单金额、之前已经核对到账的（同币种，不含这一笔）
                const total = Number(verifyTarget.order_total) || 0;
                if (!verifyTarget.order_id || total <= 0) return null;
                const cur = verifyTarget.order_currency || "CNY";
                const before = allFinances.filter(f => f.order_id === verifyTarget.order_id && f.id !== verifyTarget.id && f.type === "income" && f.status === "paid" && !f.commerce_refund && (f.currency || "CNY") === cur)
                  .reduce((n, f) => n + (Number(f.amount) || 0), 0);
                const sign = cur === "THB" ? "฿" : "¥";
                return <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">这张单</span><span className="text-right">订单金额 {sign}{total.toLocaleString()}，之前已到账 {sign}{before.toLocaleString()}</span></div>;
              })()}
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">描述</span><span className="text-right break-words">{verifyTarget.description || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">录入人</span><span>{verifyTarget.created_by || "—"}</span></div>
              <div className="flex justify-between gap-3"><span className="shrink-0 text-[var(--muted-foreground)]">录入时间</span><span>{toThaiTime(verifyTarget.created_at) || "—"}</span></div>
            </div>

            {verifyTarget.slip_file && (
              <div className="mt-3">
                <p className="text-xs text-[var(--muted-foreground)]">截图</p>
                {/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(verifyTarget.slip_file) ? (
                  <img src={fileUrl(verifyTarget.slip_file)} alt="截图" className="mt-1 max-h-56 cursor-pointer rounded-md border border-[var(--border)] object-contain" onClick={() => window.open(fileUrl(verifyTarget.slip_file), "_blank")} />
                ) : (
                  <a href={fileUrl(verifyTarget.slip_file)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-[var(--primary)] hover:underline">查看截图文件</a>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <label className="text-xs font-medium">未到账原因（标未到账时必填）</label>
                <textarea value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} rows={2} placeholder="钱为什么没到账" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
                {verifyErr && <p className="mt-2 text-xs text-[var(--destructive)]">{verifyErr}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => doVerify("arrived")} disabled={verifying || verifyTarget.status === "paid"}>已到账</Button>
                  <Button size="sm" variant="destructive" onClick={() => doVerify("not_arrived")} disabled={verifying}>未到账</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
