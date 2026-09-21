"use client";
import { useEffect,useState } from "react";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { toThaiTime } from "@/lib/time";
import type { CommerceProduct,CommerceSelection } from "@/lib/commerce-types";
import type { ImportedCatalog,ImportedCatalogKind } from "@/lib/commerce-imported-catalog-types";
import { CommerceTermsSummary } from "./commerce-terms";

type Props={accountId:number;products:CommerceProduct[];cart:CommerceSelection[];disabled:boolean;onSelect?:(product:CommerceProduct,quantity:number)=>void};
const field="w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2";
export function CommerceImportedCatalog({accountId,products,cart,disabled,onSelect}:Props) {
  const [catalog,setCatalog]=useState<ImportedCatalog|null>(null),[error,setError]=useState("");
  const [search,setSearch]=useState(""),[kind,setKind]=useState<ImportedCatalogKind|"all">("products");
  useEffect(()=>{
    let active=true;
    async function load(){
      setCatalog(null);setError("");
      try{
        const response=await fetch("/api/commerce/imported-catalog",{headers:{Authorization:"Bearer "+getStoredAuthToken()},cache:"no-store"});
        const data=await response.json();if(!response.ok)throw new Error(data.error||"目录读取失败");
        if(active)setCatalog(data);
      }catch(e){if(active)setError(e instanceof Error?e.message:"目录读取失败");}
    }
    void load();return()=>{active=false;};
  },[accountId]);
  if(error)return <p role="alert">{error}，请刷新页面重试。</p>;
  if(!catalog)return <p role="status">正在读取本地商品目录…</p>;
  const keyword=search.trim().toLocaleLowerCase();
  const items=catalog.items.filter(p=>(kind==="all"||p.kind===kind)&&(!keyword||[p.name,p.sku,p.category,p.sub_category].some(v=>v.toLocaleLowerCase().includes(keyword))));
  return <div className="space-y-4" aria-label="线上导入的本地商品目录">
    <div className="space-y-1 text-sm"><p>线上目录已导入本地：普通商品 {catalog.counts.products} · 现货 {catalog.counts.spot_items} · 订阅 {catalog.counts.subscription_products}</p>
      <p>来源 {catalog.source} · 拉取时间 {toThaiTime(catalog.captured_at)}（曼谷）</p>
      <p>原名称、价格、币种和状态保留；已接入的服务可加入购物车，其余仅核对目录，不自动创建办理单。隐藏或已售条目仅员工可见。</p></div>
    <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm">商品搜索<input className={field} value={search} onChange={e=>setSearch(e.target.value)} placeholder="名称、SKU、分类"/></label>
      <label className="text-sm">商品类型<select aria-label="商品类型" className={field} value={kind} onChange={e=>setKind(e.target.value as ImportedCatalogKind|"all")}><option value="products">普通商品（{catalog.counts.products}）</option><option value="spot_items">现货（{catalog.counts.spot_items}）</option><option value="subscription_products">订阅（{catalog.counts.subscription_products}）</option><option value="all">全部</option></select></label></div>
    <p className="text-sm" role="status">当前显示 {items.length} 项</p>
    <div className="grid gap-4 sm:grid-cols-2">{items.map(item=>{
      const product=products.find(p=>p.id===item.product_id),canBuy=!!product&&item.status==="active";
      return <article key={item.key} className="space-y-2 rounded-lg border border-[var(--border)] p-4" data-imported-product={item.key}>
        <h3 className="font-medium">{item.name}</h3><p className="text-sm text-[var(--muted-foreground)]">{item.sku||item.category} · {item.category}{item.sub_category?" / "+item.sub_category:""}</p>
        <p className="font-semibold">{item.price===null?"按客户约定计价":`${item.currency||"币种待核对"} ${item.price.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2})}`}</p>
        {item.status!=="active"&&<p className="text-sm">线上状态：{item.status==="hidden"?"隐藏":item.status==="sold"?"已售":item.status}</p>}
        {canBuy&&product?<><CommerceTermsSummary terms={product.terms}/>{onSelect?<label className="block text-sm">加入购物车 · 份数<select className={field} aria-label={product.sku+" 份数"} disabled={disabled} value={cart.find(line=>line.product_id===product.id)?.quantity||0} onChange={e=>onSelect(product,Number(e.target.value))}>{Array.from({length:11},(_,n)=><option key={n} value={n}>{n===0?"不选择":n+" 份"}</option>)}</select></label>:<p className="text-sm">已接入本地下单流程</p>}</>:<p className="text-sm">{item.status!=="active"?"当前不参与下单":item.kind==="subscription_products"?"订阅计费流程待接入":item.kind==="spot_items"?"现货交易流程待接入；原币种保留，不自动换汇":item.sku==="CLASS-LIST"?"参考资料，不作为办理商品下单":"办理流程待接入，暂仅核对目录"}</p>}
      </article>;
    })}</div>
  </div>;
}
