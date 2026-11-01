"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {fetchWithAuth} from "@/lib/api";
export default function OrderCompanyArchive({orderId}:{orderId:string}){
 const[state,setState]=useState<{key:string;rows:{id:number;name_zh:string;name_foreign:string}[];error:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();fetchWithAuth(`/api/company-archives?order_id=${encodeURIComponent(orderId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const rows=await response.json();if(!response.ok)throw Error(rows.error||'公司档案加载失败');if(!controller.signal.aborted)setState({key:orderId,rows,error:''});}).catch(error=>{if(!controller.signal.aborted)setState({key:orderId,rows:[],error:error.message||'公司档案加载失败'});});return()=>controller.abort();},[orderId]);
 return <section aria-label="订单公司档案" className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] p-4"><h2 className="text-sm font-medium">公司档案</h2>{!state||state.key!==orderId?<span className="text-xs text-[var(--muted-foreground)]">加载中…</span>:state.error?<span role="alert" className="text-sm text-red-600">{state.error}</span>:state.rows.length?state.rows.map(row=><Link key={row.id} className="min-w-0 break-words text-sm text-[var(--primary)] hover:underline" href={`/company-archives/${row.id}`}>{row.name_zh||row.name_foreign} · 查看公司档案</Link>):<Link className="inline-flex min-h-10 items-center rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--primary)]" href={`/company-archives?create_order=${encodeURIComponent(orderId)}`}>新建公司档案</Link>}</section>;
}
