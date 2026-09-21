"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AuthProvider, useAuth, type AuthUser } from "./auth-provider";
import { getStoredAuthToken, storeAuthSession } from "@/lib/auth-storage";
import type { CommerceProduct, CommerceQuote, CommerceSale, CommerceSelection } from "@/lib/commerce-types";
import { COMMERCE_SKUS } from "@/lib/commerce-catalog";
import { CommerceAftercare } from "./commerce-aftercare";
import { CommerceImportedCatalog } from "./commerce-imported-catalog";
import type { CommerceSalePage } from "@/lib/commerce-types";
import { CommerceTermsSummary } from "./commerce-terms";
import type { CommerceCart } from "@/lib/commerce-types";
import { Button } from "@/components/ui/button";
import { readPendingCommerceRequest, reservePendingCommerceRequest, settlePendingCommerceRequest, type PendingCommerceLease, type PendingCommerceRequest } from "@/lib/commerce-pending-request";

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
async function request<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const token = getStoredAuthToken();
  const headers: Record<string,string> = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url,{ method: method || (body === undefined ? "GET" : "POST"), headers,
    body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || "请求失败",response.status,data.code || "");
  return data as T;
}
function money(cents: number): string { return "¥" + (cents / 100).toFixed(2); }
const field = "w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2";
const panel = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";
type PurchaseRequest = { request_id: string; lines: CommerceSelection[]; cart_revision?: number };
function pendingPurchase(value: PendingCommerceRequest): PurchaseRequest {
  if (!Array.isArray(value.lines)) throw new Error("原下单记录格式有误，请先核对订单；记录已保留");
  return value as PurchaseRequest;
}

export function CommercePortal({ staff = false, importedCatalog = false }: { staff?: boolean; importedCatalog?:boolean }) {
  return <AuthProvider><Portal staff={staff} importedCatalog={importedCatalog}/></AuthProvider>;
}
function Portal({ staff,importedCatalog }: { staff: boolean;importedCatalog:boolean }) {
  const { user, setUser, logout } = useAuth();
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [products,setProducts] = useState<CommerceProduct[]>([]);
  const [sales,setSales] = useState<CommerceSale[]>([]);
  const [nextCursor,setNextCursor] = useState<string|null>(null);
  const [search,setSearch] = useState("");
  const searchRef=useRef("");
  const listingGeneration=useRef(0);
  const olderPages=useRef(false);
  const initialOrderLink=useRef(false);
  const [showingOlder,setShowingOlder]=useState(false);
  const [cart,setCart] = useState<CommerceSelection[]>([]);
  const [cartLoaded,setCartLoaded] = useState(false);
  const [cartVersion,setCartVersion] = useState(-1);
  const cartVersionRef = useRef(-1);
  const quoteVersionRef = useRef(-1);
  const pendingRef = useRef<PurchaseRequest | null>(null);
  const [quoted,setQuoted] = useState<CommerceQuote | null>(null);
  const [pending,setPending] = useState<PurchaseRequest | null>(null);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const busyRef = useRef(false);
  const actionLock = useRef<object|null>(null);
  const generation = useRef(0);
  const accountId = user?.id;
  const storageKey = user ? "commerce-pending-" + user.id : "";
  const customer = user?.role === "client";
  const acceptCart = useCallback((next: CommerceCart) => {
    if (next.revision < cartVersionRef.current) return;
    if (next.revision !== cartVersionRef.current) setQuoted(null);
    cartVersionRef.current = next.revision;
    setCartVersion(next.revision); setCart(next.lines); setCartLoaded(true);
  },[]);
  const reloadCart = useCallback(async () => {
    const version = generation.current;
    const next = await request<CommerceCart>("/api/commerce/cart");
    if (version !== generation.current || pendingRef.current) return;
    acceptCart(next);
  },[acceptCart]);

  const reload = useCallback(async () => {
    const version = generation.current;
    const listing=++listingGeneration.current;
    const [nextProducts,page] = await Promise.all([
      request<CommerceProduct[]>("/api/commerce/products"),request<CommerceSalePage>("/api/commerce/orders/page?limit=20&search="+encodeURIComponent(searchRef.current)),
    ]);
    if (version !== generation.current || listing!==listingGeneration.current) return;
    setProducts(nextProducts);
    setSales(current => page.items.map(next => {
      const known = current.find(row => row.id === next.id);
      return known && known.billing.revision > next.billing.revision ? known : next;
    }));
    setNextCursor(page.next_cursor);olderPages.current=false;setShowingOlder(false);
  },[]);
  useEffect(() => {
    if (!accountId) return;
    const lifecycle = generation;
    let active = true;
    async function start() {
      actionLock.current=null;busyRef.current=false;setBusy(false);
      if (!initialOrderLink.current) {
        initialOrderLink.current = true;
        const linked = window.location.hash.slice(1);
        // Original workflow links must find the purchase even beyond the first page.
        if (/^SALE-[A-Za-z0-9-]{1,75}$/.test(linked)) {
          searchRef.current = linked; setSearch(linked);
        }
      }
      await reload();
    }
    start().catch(e => { if (active) setError(e instanceof Error ? e.message : "加载失败"); });
    const timer = window.setInterval(() => {
      if(olderPages.current) return; // Do not replace a deliberately loaded historical page mid-action.
      reload().catch(e => { if (active) setError(e instanceof Error ? e.message : "更新失败"); });
    },15000);
    return () => { active = false; lifecycle.current++; actionLock.current=null;busyRef.current=false; clearInterval(timer); };
  },[accountId,reload]); // Poll same-database public progress; no old-site callbacks.
  useEffect(() => {
    if (!storageKey || !customer) return;
    let active = true;
    async function restore() {
      cartVersionRef.current = -1; quoteVersionRef.current = -1;
      setCartVersion(-1); setCartLoaded(false); setCart([]); setQuoted(null);
      pendingRef.current = null; setPending(null);
      try {
        const saved = readPendingCommerceRequest(sessionStorage,storageKey);
        if (saved) {
          const parsed = pendingPurchase(saved.request);
          pendingRef.current = parsed; setPending(parsed); setCart(parsed.lines); return;
        }
      } catch (e) {
        if(active)setError(e instanceof Error?e.message:"原下单记录读取失败，请先核对订单");
        return; // Preserve corrupt/unreadable recovery data; do not start a new sale.
      }
      try { await reloadCart(); }
      catch (e) { if (active) setError(e instanceof Error ? e.message : "购物车加载失败"); }
    }
    void restore();
    const timer = window.setInterval(() => {
      if (!busyRef.current && !pendingRef.current) reloadCart().catch(e => {
        if (active) setError(e instanceof Error ? e.message : "购物车更新失败");
      });
    },15000);
    return () => { active = false; clearInterval(timer); };
  },[storageKey,customer,reloadCart]);
  async function act(action: () => Promise<void>) {
    if (actionLock.current) return;
    const lock={},version=generation.current;actionLock.current=lock;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (e) { if(generation.current===version&&actionLock.current===lock)setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally {
      if(actionLock.current===lock){actionLock.current=null;busyRef.current=false;if(generation.current===version)setBusy(false);}
    }
  }
  function signOut() {
    generation.current++; listingGeneration.current++;searchRef.current="";setSearch("");setNextCursor(null);olderPages.current=false;setShowingOlder(false);setProducts([]); setSales([]); setCart([]); setQuoted(null); setPending(null);
    pendingRef.current=null; cartVersionRef.current=-1; quoteVersionRef.current=-1;
    setCartLoaded(false); setCartVersion(-1); setMessage(""); setError(""); logout();
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      const data = await request<{ token: string; user: AuthUser; must_change_password: boolean }>("/api/auth/login",{ email,password });
      setPassword("");
      if (data.must_change_password) throw new Error("请先到原登录页完成修改密码，再返回商城");
      storeAuthSession(data.token,data.user,false); setUser(data.user);
    });
  }
  async function replaceCart(lines: CommerceSelection[]): Promise<CommerceCart> {
    setQuoted(null); setCartLoaded(false);
    try {
      const next = await request<CommerceCart>("/api/commerce/cart",{revision:cartVersionRef.current,lines},"PUT");
      acceptCart(next); return next;
    } catch (e) {
      // A lost PUT response does not justify overwriting a newer cart. Read its current version.
      try { await reloadCart(); } catch { /* Keep editing disabled until explicit reload succeeds. */ }
      throw e;
    }
  }
  function select(product: CommerceProduct, quantity: number) {
    if (pending || busy || !cartLoaded) return;
    const lines = [...cart.filter(x => x.product_id !== product.id),
      ...(quantity > 0 ? [{ product_id: product.id, quantity, revision: product.revision, terms_version: product.terms.version }] : [])];
    void act(async () => { await replaceCart(lines); });
  }
  async function purchase() {
    await act(async () => {
      const version=generation.current,lock=actionLock.current;
      const isCurrent=()=>generation.current===version&&actionLock.current===lock;
      if (!pendingRef.current && (!quoted || !cartLoaded || quoteVersionRef.current !== cartVersionRef.current)) throw new Error("请先重新核对购物车报价");
      const candidate = pendingRef.current || { request_id: crypto.randomUUID(), lines: cart, cart_revision: cartVersionRef.current };
      const sent=reservePendingCommerceRequest(sessionStorage,storageKey,candidate);
      const input=pendingPurchase(sent.request);pendingRef.current=input;setPending(input);
      function settle(lease:PendingCommerceLease):boolean {
        const cleared=settlePendingCommerceRequest(sessionStorage,storageKey,lease);
        if(!isCurrent()||pendingRef.current?.request_id!==lease.request.request_id)return false;
        if(cleared){pendingRef.current=null;setPending(null);return true;}
        const latest=readPendingCommerceRequest(sessionStorage,storageKey);
        pendingRef.current=latest?pendingPurchase(latest.request):null;setPending(pendingRef.current);return false;
      }
      try {
        const result = await request<{ sale: CommerceSale; duplicate: boolean }>("/api/commerce/orders",input);
        if(!settle(sent))return;
        setCart([]); setQuoted(null);
        setMessage("订单已确认：" + result.sale.id + "。账单已生成，尚未自动确认收款。");
        await Promise.all([reload(),reloadCart()]);
      } catch (e) {
        // Only definite transaction conflicts may end this exact saved request.
        // Unknown replies/auth failures retain its full input and transaction key.
        if (e instanceof ApiError && e.status===409 && ["QUOTE_CHANGED","TEMPLATE_REVIEW_REQUIRED","TERMS_REVIEW_REQUIRED","CART_CHANGED"].includes(e.code)) {
          if(settle(sent)){
            setQuoted(null);
            try { await Promise.all([reload(),reloadCart()]); } catch { if(isCurrent())setCartLoaded(false); }
          }
        }
        throw e;
      }
    });
  }
  async function upload(orderId: string, file: File) {
    await act(async () => {
      const data = new FormData(); data.set("file",file);
      const response = await fetch("/api/upload",{ method:"POST",headers:{Authorization:"Bearer " + getStoredAuthToken()},body:data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "上传失败");
      await request("/api/orders/" + orderId + "/documents",{ name:file.name,file_type:file.type,file_url:result.url });
      setMessage("资料已提交，等待员工审核。"); await reload();
    });
  }
  async function download(url: string, name: string) {
    await act(async () => {
      if (!/^\/api\/files\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url)) throw new Error("文件地址待核对");
      const response = await fetch(url,{headers:{Authorization:"Bearer " + getStoredAuthToken()},cache:"no-store"});
      if (!response.ok) throw new Error("资料已撤回或当前账号无访问权限");
      const local = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href=local; link.download=name; link.click();
      setTimeout(() => URL.revokeObjectURL(local),1000);
    });
  }

  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 text-[var(--foreground)]">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm text-[var(--muted-foreground)]">本地合并试点 · 默认关闭</p>
        <h1 className="text-2xl font-semibold">{staff ? "商城订单与账单" : "服务商城"}</h1>
        <p className="mt-2 text-sm">一个购买订单，一张账单；每份服务单独办理。</p></div>
      {user && <div className="flex items-center gap-3">{!staff&&customer&&<a className="rounded-md border border-[var(--border)] px-3 py-2 text-sm underline" href="#commerce-cart">购物车（{cart.reduce((sum,line)=>sum+line.quantity,0)} 份）</a>}<span>{user.name}</span><Button disabled={busy} variant="outline" onClick={signOut}>退出登录</Button></div>}
    </header>
    {error && <p role="alert" className={panel}>{error}</p>}
    {message && <p role="status" className={panel}>{message}</p>}
    {!user ? <form className={panel + " mx-auto max-w-md space-y-4"} onSubmit={login}>
      <h2 className="text-lg font-medium">{staff ? "员工登录" : "客户登录"}</h2>
      <label className="block">邮箱<input required type="email" autoComplete="username" className={field} value={email} onChange={e=>setEmail(e.target.value)} /></label>
      <label className="block">密码<input required type="password" autoComplete="current-password" className={field} value={password} onChange={e=>setPassword(e.target.value)} /></label>
      <Button disabled={busy} type="submit">登录</Button>
      <p className="text-sm text-[var(--muted-foreground)]">本批复用内部已有客户账号；旧站账号尚未迁入。需改密码时使用<Link className="underline" href="/login">原登录页</Link>。</p>
    </form> : (staff ? user.role === "client" : user.role !== "client") ?
      <p className={panel}>请使用{staff ? "员工" : "客户"}账号。<Link className="underline" href={staff ? "/shop" : "/commerce"}>前往对应入口</Link></p> :
      <>
        {staff && user.role === "admin" && <ProductEditor products={products} busy={busy} run={act} reload={reload} />}
        {staff&&importedCatalog&&<section className={panel}><h2 className="mb-3 text-lg font-semibold">线上完整商品目录</h2><CommerceImportedCatalog key={user.id} accountId={user.id} products={products} cart={[]} disabled={true}/></section>}
        {!staff && <section className={panel + " space-y-4"}>
          <h2 className="text-lg font-semibold">选择服务</h2>
          <p className="text-sm text-[var(--muted-foreground)]">现已接入公司注册与泰国商标 1～5 小项规格。6 小项以上、附加费、现货、税务和订阅等仍待迁移。</p>
          {products.length === 0 && <p>暂无上架商品，请由管理员配置测试商品。</p>}
          {importedCatalog?<CommerceImportedCatalog key={user.id} accountId={user.id} products={products} cart={cart} disabled={busy||!!pending||!cartLoaded} onSelect={select}/>:
          <div className="grid gap-4 sm:grid-cols-2">{products.map(p => <div key={p.id} className={panel}>
            <h3>{p.name}</h3><p className="text-sm text-[var(--muted-foreground)]">{p.sku}</p>
            <p className="my-2 font-semibold">{money(p.price_cents)} / 份</p>
            <CommerceTermsSummary terms={p.terms}/>
            <label>份数<select className={field} aria-label={p.sku + " 份数"} disabled={busy || !!pending || !cartLoaded}
              value={cart.find(x=>x.product_id===p.id)?.quantity || 0} onChange={e=>select(p,Number(e.target.value))}>{Array.from({length:11},(_,n)=><option key={n} value={n}>{n === 0 ? "不选择" : n + " 份"}</option>)}</select></label>
          </div>)}</div>}
          <div id="commerce-cart" className="scroll-mt-4 space-y-3 rounded-lg border border-[var(--border)] p-4" aria-label="购物车">
          <h3 className="text-lg font-semibold">购物车 · {cart.length} 种服务 / {cart.reduce((sum,line)=>sum+line.quantity,0)} 份</h3>
          {!cart.length&&<p className="text-sm">购物车为空，在商品卡片选择份数即可加入。</p>}
          {cart.map(line=>{const product=products.find(p=>p.id===line.product_id);return product?<div key={line.product_id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{product.name} · {line.quantity} 份</span><Button variant="outline" disabled={busy||!!pending||!cartLoaded} onClick={()=>act(async()=>{await replaceCart(cart.filter(row=>row.product_id!==line.product_id));})}>{"移除 "+product.sku}</Button></div>:null;})}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p>{cartLoaded ? "购物车已保存到当前账号 · 版本 " + cartVersion : pending ? "当前保留的是待确认订单，不改写服务器购物车。" : "购物车尚未加载或保存结果待核对。"}</p>
            <Button variant="outline" disabled={busy || !!pending} onClick={()=>act(reloadCart)}>重新加载购物车</Button>
          </div>
          {cart.some(line=>!products.some(p=>p.id===line.product_id)) && <p role="note">选择中有已下架商品，请先移除或清空，再核对报价。</p>}
          {cart.filter(line=>!products.some(p=>p.id===line.product_id)).map(line=><div className="flex flex-wrap items-center gap-2 text-sm" key={line.product_id}>
            <span>已下架商品 · 数量 {line.quantity}</span><Button variant="outline" disabled={busy || !!pending || !cartLoaded} onClick={()=>act(async()=>{await replaceCart(cart.filter(x=>x.product_id!==line.product_id));})}>移除该商品</Button>
          </div>)}
          {pending ? <div><p>上一笔请求等待确认。请先重试确认，避免重复购买；刷新页面会保留此请求。</p>
            <Button disabled={busy} onClick={purchase}>重试确认这笔订单</Button></div> :
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={busy || !cartLoaded || !cart.length} onClick={()=>act(async()=>{await replaceCart([]);})}>清空选择</Button>
              <Button variant="outline" disabled={busy || !cartLoaded || !cart.length} onClick={()=>act(async()=>{
                const current = cart.map(line => {
                  const product=products.find(p=>p.id===line.product_id);
                  return product ? {...line,revision:product.revision,terms_version:product.terms.version} : line;
                });
                const saved = JSON.stringify(current) === JSON.stringify(cart)
                  ? {revision:cartVersionRef.current,lines:cart} : await replaceCart(current);
                const result = await request<CommerceQuote>("/api/commerce/quote",{lines:saved.lines});
                if (cartVersionRef.current !== saved.revision) throw new Error("购物车已更新，请重新核对报价");
                quoteVersionRef.current=saved.revision; setQuoted(result);
              })}>核对当前报价</Button>
              {quoted && <div className="w-full space-y-3" data-quoted-terms>
                {quoted.lines.map(line=><div className={panel} key={line.product_id}><p>{line.sku} · {line.quantity} {line.terms.quantity_basis === "company" ? "家公司" : "份商标申请"} · {money(line.total_cents)}</p><CommerceTermsSummary terms={line.terms}/></div>)}
                <strong>本次合计 {money(quoted.total_cents)}</strong> <Button disabled={busy} onClick={purchase}>确认下单</Button>
              </div>}
            </div>}
          </div>
        </section>}
        <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{staff ? "购买订单" : "我的订单与进度"}</h2>
          <Button disabled={busy} variant="outline" onClick={()=>act(reload)}>刷新订单</Button></div>
          <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();searchRef.current=search;void act(reload);}}>
            <label className="min-w-0 flex-1 text-sm">订单搜索<input maxLength={80} className={field} placeholder="订单号、商品编号或成交名称" value={search} onChange={e=>setSearch(e.target.value)}/></label><Button type="submit" disabled={busy}>搜索订单</Button>
          </form>
          {showingOlder&&<p className="text-sm">正在查看较早订单；操作结果即时更新，其他变化请点“刷新订单”重新加载。</p>}
          {!sales.length && <p>暂无订单。</p>}
          {sales.map(sale => <article className={panel + " space-y-4"} key={sale.id} data-sale-id={sale.id} id={sale.id}>
            <h3 className="break-all font-semibold">{sale.id}</h3>
            {staff && <p>购买账号 #{sale.buyer_account_id} · {sale.buyer_name}</p>}
            <p>成交 {money(sale.total_cents)} · 账单 {sale.billing.settlement === "refund_due" ? "待退款" : sale.billing.settlement === "refunded" ? "已退款" : sale.billing.settlement === "voided" ? "无需收款" : sale.invoice.status === "paid" ? "已收款" : "未收款"}</p>
            <p className="break-all text-sm">账单号：{sale.invoice.id}</p>
            {staff && user.role === "admin" && sale.invoice.status === "unpaid" && sale.billing.balance_due_cents>0 &&
              <PaymentForm key={sale.id+":"+sale.billing.revision} busy={busy} onConfirm={reference=>act(async()=>{
                await request("/api/commerce/orders/" + sale.id + "/payment",{payment_reference:reference,revision:sale.billing.revision});
                setMessage("已确认收款，收入按办理份数分配，重复点击不重复记账。"); await reload();
              })}/>}
            <CommerceAftercare key={user.id+":"+sale.id+":"+sale.billing.revision} sale={sale} accountId={user.id} role={user.role} onUpdated={updated=>{listingGeneration.current++;setSales(current=>current.map(row=>row.id===updated.id && updated.billing.revision>=row.billing.revision?updated:row));setMessage("处理结果已更新；原成交与账单记录保留。");}}/>
            {sale.lines.map(line=><div key={line.id} className="space-y-3">
              <p className="font-medium">{line.sku} · {line.name} × {line.quantity} = {money(line.total_cents)}</p>
              <CommerceTermsSummary terms={line.terms}/>
              {line.fulfillments.map(f=><section key={f.order_id} className={panel}>
                <div className="flex flex-wrap items-center justify-between gap-2"><h4>第 {f.copy_no} 份 · {f.status}</h4>
                  {staff && <Link className="underline" href={"/orders/" + f.order_id}>进入原办理流程</Link>}</div>
                <ol className="my-3 grid gap-2 text-sm sm:grid-cols-2">{f.steps.map(step=><li key={step.id}>{step.step_order}. {step.name} · {step.status}</li>)}</ol>
                <p className="text-xs text-[var(--muted-foreground)]">按所购服务核对适用项目；原流程清单不代表新增附属服务、订阅或收费。</p>
                <ul className="my-3 space-y-2">{f.documents.map(doc=><li key={doc.id} className="flex flex-wrap items-center gap-2">
                  <span>{doc.name} · {doc.status}</span>{doc.file_url && <Button variant="outline" size="sm" disabled={busy} onClick={()=>download(doc.file_url,doc.name)}>下载资料</Button>}
                </li>)}</ul>
                {!staff && <label className="block text-sm">提交资料（PDF、图片、Word、Excel，最大 10 MB）
                  <input type="file" className={field} disabled={busy} aria-label={"向 " + f.order_id + " 提交资料"}
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" onChange={e=>{
                      const file=e.target.files?.[0];e.target.value="";if(file) void upload(f.order_id,file);
                    }}/></label>}
              </section>)}
            </div>)}
          </article>)}
          {nextCursor&&<Button variant="outline" disabled={busy} onClick={()=>act(async()=>{
            const version=generation.current,listing=listingGeneration.current;
            const page=await request<CommerceSalePage>("/api/commerce/orders/page?limit=20&search="+encodeURIComponent(searchRef.current)+"&cursor="+encodeURIComponent(nextCursor));
            if(version!==generation.current||listing!==listingGeneration.current)return;
            setSales(current=>[...current,...page.items.filter(item=>!current.some(row=>row.id===item.id))]);setNextCursor(page.next_cursor);olderPages.current=true;setShowingOlder(true);
          })}>加载更早订单</Button>}
        </section>
      </>}
  </main>;
}

function PaymentForm({busy,onConfirm}:{busy:boolean;onConfirm:(reference:string)=>Promise<void>}) {
  const [reference,setReference]=useState("");
  const [checked,setChecked]=useState(false);
  return <form className="space-y-2" onSubmit={e=>{e.preventDefault();if(checked) void onConfirm(reference);}}>
    <label className="block">收款凭证编号<input required maxLength={120} className={field} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核实收到此账单全额款项（不自动发起扣款）</label>
    <Button disabled={busy || !checked} type="submit">确认全额收款</Button>
  </form>;
}
function ProductEditor({products,busy,run,reload}:{products:CommerceProduct[];busy:boolean;run:(fn:()=>Promise<void>)=>Promise<void>;reload:()=>Promise<void>}) {
  const [sku,setSku]=useState("COM-001"),[name,setName]=useState(""),[cents,setCents]=useState(""),[active,setActive]=useState(false);
  const [editing,setEditing]=useState<CommerceProduct | null>(null);
  const existing=products.find(p=>p.sku===sku);
  function pick(next:string) {
    const product=products.find(p=>p.sku===next);setEditing(product || null);setSku(next);setName(product?.name || "");setCents(product ? String(product.price_cents) : "");setActive(product?.active===1);
  }
  return <details className={panel}><summary className="cursor-pointer font-semibold">管理员商品配置（改价只影响之后的订单）</summary>
    <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void run(async()=>{
      if (existing && !editing) throw new Error("请先载入当前商品再编辑，避免覆盖其他人的新报价");
      const saved=await request<CommerceProduct>("/api/commerce/products",{...(editing ? {id:editing.id,revision:editing.revision}:{}),sku,name,price_cents:Number(cents),active});
      setEditing(saved);
      await reload();
    });}}>
      <label>商品编号<select className={field} value={sku} onChange={e=>pick(e.target.value)}>{COMMERCE_SKUS.map(x=><option key={x}>{x}</option>)}</select></label>
      <Button variant="outline" type="button" disabled={busy} onClick={()=>pick(sku)}>载入当前商品</Button>
      <label>商品名称<input required className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>人民币售价（整数分）<input required type="number" min="1" max="100000000" step="1" className={field} value={cents} onChange={e=>setCents(e.target.value)}/></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>上架</label>
      <p className="text-sm sm:col-span-2">编号对应的公司/VAT 或商标规格固定；改名称和价格不改变权益，也不改旧成交。未核对的附加费和计量规格保持未开放。</p>
      <Button disabled={busy} type="submit">保存商品</Button>
    </form>
  </details>;
}
