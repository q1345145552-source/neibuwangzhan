"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, Eye, EyeOff, Copy, Vault } from "lucide-react";

const ASSET_TYPES = ["账号密码", "套餐会员", "邮箱", "设备", "证件执照", "身份证", "域名", "客户委托账号", "SIM卡手机号"] as const;

interface Asset {
  id: number;
  asset_type: string;
  asset_subtype: string;
  name: string;
  account: string;
  password: string;
  phone: string;
  id_number: string;
  payment_account: string;
  url: string;
  ownership: string;
  customer_name: string;
  expiry_date: string;
  device_type: string;
  brand_model: string;
  serial_number: string;
  device_owner: string;
  device_status: string;
  remark: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

const SENSITIVE_FIELDS: { key: keyof Asset; label: string }[] = [
  { key: "account", label: "账号" },
  { key: "password", label: "密码" },
  { key: "phone", label: "手机号" },
  { key: "id_number", label: "证件号/身份证号" },
  { key: "payment_account", label: "收款账号" },
];

function nameLabel(type: string): string {
  if (type === "账号密码" || type === "客户委托账号") return "平台名";
  if (type === "套餐会员") return "服务名";
  if (type === "邮箱") return "邮箱名/用途";
  if (type === "设备") return "设备名称";
  if (type === "证件执照") return "证件名";
  if (type === "身份证") return "姓名";
  if (type === "域名") return "域名";
  if (type === "SIM卡手机号") return "名称/用途";
  return "名称";
}

function showFields(type: string) {
  return {
    account: ["账号密码", "套餐会员", "邮箱", "客户委托账号"].includes(type),
    password: ["账号密码", "套餐会员", "邮箱", "客户委托账号"].includes(type),
    phone: ["账号密码", "SIM卡手机号"].includes(type),
    idNumber: ["证件执照", "身份证"].includes(type),
    paymentAccount: type === "账号密码",
    url: ["账号密码", "套餐会员", "邮箱", "域名", "客户委托账号"].includes(type),
    expiry: ["账号密码", "套餐会员", "邮箱", "证件执照", "身份证", "域名", "客户委托账号", "SIM卡手机号"].includes(type),
    device: type === "设备",
    subtype: type === "账号密码",
  };
}

export default function AssetsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  // 录入表单
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [customers, setCustomers] = useState<string[]>([]);
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  // 详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState("");

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/assets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setAssets(Array.isArray(d) ? d : []))
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

  const setField = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const openCreate = () => {
    setForm({ asset_type: "账号密码", ownership: "公司自有" });
    setFormErr("");
    setFormOpen(true);
    fetchWithAuth("/api/customers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCustomers((Array.isArray(d) ? d : []).map((c: any) => String(c.company_name || "").trim()).filter(Boolean)))
      .catch(() => setCustomers([]));
  };

  const submit = async () => {
    if (!form.asset_type) { setFormErr("请选择资产类型"); return; }
    if (form.ownership === "客户委托" && !form.customer_name) { setFormErr("客户委托需要选择客户"); return; }
    setSaving(true);
    const ok = await apiCall("/api/assets", { method: "POST", body: form, onError: (m) => setFormErr(m) });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  const openDetail = (a: Asset) => {
    setDetailOpen(true);
    setDetailAsset(null);
    setDetailLoading(true);
    setRevealed({});
    fetchWithAuth(`/api/assets/${a.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDetailAsset(d))
      .catch(() => setDetailAsset(null))
      .finally(() => setDetailLoading(false));
  };

  const closeDetail = () => { setDetailOpen(false); setDetailAsset(null); };

  const toggleReveal = (key: string) => setRevealed((p) => ({ ...p, [key]: !p[key] }));

  const copyField = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
    } catch {}
  };

  const show = showFields(form.asset_type || "账号密码");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">资产台账</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "公司账号、密码、证件、设备等统一登记" : "登记并查看你上传的资产"}</p>
        </div>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />录入资产
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : assets.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">还没有资产，点右上角录入</p>
      ) : (
        <div className="flex flex-col gap-2">
          {assets.map((a) => (
            <button
              key={a.id}
              onClick={() => openDetail(a)}
              className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--primary)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Vault className="size-4 text-[var(--muted-foreground)]" />
                <span className="text-sm font-medium text-[var(--foreground)]">{a.name || a.asset_type}</span>
                <span className="rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]">{a.asset_type}{a.asset_subtype ? `·${a.asset_subtype}` : ""}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                <span>{a.ownership}{a.customer_name ? ` · ${a.customer_name}` : ""}</span>
                {a.expiry_date && <span>到期 {a.expiry_date}</span>}
                {isAdmin && <span>上传人：{a.uploaded_by}</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 详情弹窗 */}
      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeDetail}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <>
                <div className="flex items-start justify-between">
                  <h3 className="text-base font-semibold text-[var(--foreground)]">资产详情</h3>
                  <button onClick={closeDetail} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
                </div>
                <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
              </>
            ) : !detailAsset ? (
              <>
                <div className="flex items-start justify-between">
                  <h3 className="text-base font-semibold text-[var(--foreground)]">资产详情</h3>
                  <button onClick={closeDetail} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
                </div>
                <p className="py-12 text-center text-sm text-[var(--destructive)]">加载失败或无权查看该资产</p>
              </>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--foreground)]">{detailAsset.name || detailAsset.asset_type}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
                      <span>{detailAsset.asset_type}{detailAsset.asset_subtype ? `·${detailAsset.asset_subtype}` : ""}</span>
                      <span>{detailAsset.ownership}{detailAsset.customer_name ? ` · ${detailAsset.customer_name}` : ""}</span>
                    </div>
                  </div>
                  <button onClick={closeDetail} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
                </div>

                <div className="mt-4 space-y-2.5 text-sm">
                {SENSITIVE_FIELDS.map((f) => {
                  const val = String(detailAsset[f.key] || "");
                  if (!val) return null;
                  const isRevealed = !!revealed[f.key];
                  return (
                    <div key={f.key} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
                      <span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">{f.label}</span>
                      <span className="min-w-0 flex-1 break-all font-mono text-sm text-[var(--foreground)]">{isRevealed ? val : "••••••••"}</span>
                      <button type="button" onClick={() => toggleReveal(f.key)} className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title={isRevealed ? "隐藏" : "显示明文"}>
                        {isRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </button>
                      <button type="button" onClick={() => copyField(f.key, val)} className="flex size-8 shrink-0 items-center justify-center rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]" title="复制">
                        {copiedKey === f.key ? <span className="text-[10px] text-green-600">已复制</span> : <Copy className="size-3.5" />}
                      </button>
                    </div>
                  );
                })}

                {detailAsset.url && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">网址/云盘</span><span className="min-w-0 flex-1 break-all">{detailAsset.url}</span></div>
                )}
                {detailAsset.expiry_date && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">到期时间</span><span>{detailAsset.expiry_date}</span></div>
                )}
                {detailAsset.device_type && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">设备类型</span><span>{detailAsset.device_type}</span></div>
                )}
                {detailAsset.brand_model && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">品牌型号</span><span>{detailAsset.brand_model}</span></div>
                )}
                {detailAsset.serial_number && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">序列号</span><span>{detailAsset.serial_number}</span></div>
                )}
                {detailAsset.device_owner && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">归属人</span><span>{detailAsset.device_owner}</span></div>
                )}
                {detailAsset.device_status && (
                  <div className="flex items-center gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">状态</span><span>{detailAsset.device_status}</span></div>
                )}
                {detailAsset.remark && (
                  <div className="flex items-start gap-2 px-1"><span className="w-24 shrink-0 text-xs text-[var(--muted-foreground)]">备注</span><span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{detailAsset.remark}</span></div>
                )}
                <p className="px-1 text-xs text-[var(--muted-foreground)]">上传人：{detailAsset.uploaded_by} · {toThaiTime(detailAsset.created_at)}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 录入弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">录入资产</h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">资产类型 <span className="text-[var(--destructive)]">*</span></label>
                <select value={form.asset_type || "账号密码"} onChange={(e) => setField("asset_type", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {show.subtype && (
                <div>
                  <label className="text-xs font-medium">子分类</label>
                  <select value={form.asset_subtype || ""} onChange={(e) => setField("asset_subtype", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                    <option value="">（无）</option>
                    <option value="银行支付">银行支付</option>
                    <option value="其他">其他</option>
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs font-medium">{nameLabel(form.asset_type || "账号密码")}</label>
                <input value={form.name || ""} onChange={(e) => setField("name", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              {show.account && (
                <div>
                  <label className="text-xs font-medium">账号</label>
                  <input value={form.account || ""} onChange={(e) => setField("account", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              {show.password && (
                <div>
                  <label className="text-xs font-medium">密码</label>
                  <input value={form.password || ""} onChange={(e) => setField("password", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              {show.phone && (
                <div>
                  <label className="text-xs font-medium">手机号</label>
                  <input value={form.phone || ""} onChange={(e) => setField("phone", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              {show.idNumber && (
                <div>
                  <label className="text-xs font-medium">{form.asset_type === "身份证" ? "身份证号" : "证件号"}</label>
                  <input value={form.id_number || ""} onChange={(e) => setField("id_number", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              {show.paymentAccount && (
                <div>
                  <label className="text-xs font-medium">收款账号</label>
                  <input value={form.payment_account || ""} onChange={(e) => setField("payment_account", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}
              {show.url && (
                <div>
                  <label className="text-xs font-medium">网址 / 云盘链接</label>
                  <input value={form.url || ""} onChange={(e) => setField("url", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}

              <div>
                <label className="text-xs font-medium">归属</label>
                <select value={form.ownership || "公司自有"} onChange={(e) => setField("ownership", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                  <option value="公司自有">公司自有</option>
                  <option value="客户委托">客户委托</option>
                </select>
              </div>

              {form.ownership === "客户委托" && (
                <div>
                  <label className="text-xs font-medium">客户 <span className="text-[var(--destructive)]">*</span></label>
                  <select value={form.customer_name || ""} onChange={(e) => setField("customer_name", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm outline-none focus:border-[var(--ring)]">
                    <option value="">选择客户</option>
                    {customers.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              {show.expiry && (
                <div>
                  <label className="text-xs font-medium">到期时间</label>
                  <input type="date" value={form.expiry_date || ""} onChange={(e) => setField("expiry_date", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              )}

              {show.device && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium">设备类型</label>
                      <input value={form.device_type || ""} onChange={(e) => setField("device_type", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">品牌型号</label>
                      <input value={form.brand_model || ""} onChange={(e) => setField("brand_model", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium">序列号</label>
                    <input value={form.serial_number || ""} onChange={(e) => setField("serial_number", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium">归属人</label>
                      <input value={form.device_owner || ""} onChange={(e) => setField("device_owner", e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                    <div>
                      <label className="text-xs font-medium">状态</label>
                      <input value={form.device_status || ""} onChange={(e) => setField("device_status", e.target.value)} placeholder="在用/闲置/维修" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="text-xs font-medium">备注</label>
                <textarea value={form.remark || ""} onChange={(e) => setField("remark", e.target.value)} rows={2} placeholder="补充说明" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submit} disabled={saving}>{saving ? "保存中…" : "保存"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
