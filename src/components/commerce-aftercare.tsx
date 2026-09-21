"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CommerceSale, CommerceCancellation } from "@/lib/commerce-types";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { Button } from "@/components/ui/button";
import { toThaiTime } from "@/lib/time";
import { readPendingCommerceRequest, reservePendingCommerceRequest, settlePendingCommerceRequest, type PendingCommerceRequest, type PendingCommerceLease } from "@/lib/commerce-pending-request";

type Context = {sale:CommerceSale;accountId:number;role:string;onUpdated:(sale:CommerceSale)=>void};
const money=(n:number)=>"¥"+(n/100).toFixed(2);
const field="w-full rounded-md border border-[var(--border)] bg-[var(--background)] p-2";
const panel="space-y-3 rounded-lg border border-[var(--border)] p-3";
function cents(value:string):number {
  if(!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value.trim()))throw new Error("金额按元填写，最多两位小数；不减免请明确填 0");
  const [whole,fraction=""]=value.trim().split(".");return Number(whole)*100+Number(fraction.padEnd(2,"0"));
}
function copyLabel(sale:CommerceSale,id:string) {
  for(const line of sale.lines){const copy=line.fulfillments.find(f=>f.order_id===id);if(copy)return line.sku+" 第 "+copy.copy_no+" 份";}return id;
}
function useCommand(context:Context,scope:string,route:string) {
  const storage="commerce-action-"+context.accountId+"-"+context.sale.id+"-"+scope;
  const [pending,setPending]=useState<PendingCommerceRequest|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const pendingRef=useRef<PendingCommerceRequest|null>(null);
  const working=useRef<object|null>(null),lifecycle=useRef(0),active=useRef(false);
  useEffect(()=>{
    const lifecycleRef=lifecycle;
    active.current=true;lifecycleRef.current++;
    function restore(){
      working.current=null;setBusy(false);setError("");
      try{const saved=readPendingCommerceRequest(sessionStorage,storage);pendingRef.current=saved?.request??null;setPending(pendingRef.current);}
      catch(e){pendingRef.current=null;setPending(null);setError(e instanceof Error?e.message:"原操作记录读取失败，请先核对处理结果");}
    }
    restore();return()=>{active.current=false;lifecycleRef.current++;working.current=null;};
  },[storage]);
  async function send(input?:Record<string,unknown>) {
    if(!active.current||working.current)return;
    const lock={},version=lifecycle.current;working.current=lock;setBusy(true);setError("");
    const isCurrent=()=>active.current&&lifecycle.current===version&&working.current===lock;
    let sent:PendingCommerceLease|null=null;
    function settle():boolean {
      if(!sent)return false;
      const cleared=settlePendingCommerceRequest(sessionStorage,storage,sent);
      if(!isCurrent()||pendingRef.current?.request_id!==sent.request.request_id)return false;
      if(cleared){pendingRef.current=null;setPending(null);return true;}
      // Another live instance owns this slot now; restore its input, never erase it.
      const latest=readPendingCommerceRequest(sessionStorage,storage);
      pendingRef.current=latest?.request??null;setPending(pendingRef.current);return false;
    }
    try{
      const candidate=pendingRef.current||{...input,request_id:crypto.randomUUID()};
      sent=reservePendingCommerceRequest(sessionStorage,storage,candidate);
      pendingRef.current=sent.request;setPending(sent.request);
      const response=await fetch("/api/commerce/orders/"+context.sale.id+"/"+route,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+getStoredAuthToken()},body:sent.serialized});
      const result=await response.json();
      if(!response.ok){
        // Ambiguous transport/auth failures must preserve the exact original input.
        if(response.status===400||(response.status===409&&["REVISION_CHANGED","REQUEST_ALREADY_DECIDED","ORDER_FINISHED","CANCELLATION_CONFLICT","REFUND_REFERENCE_EXISTS","NO_BALANCE"].includes(result.code)))settle();
        throw new Error(result.error||"请核对处理结果后重试同一操作");
      }
      if(settle())context.onUpdated(result);
    }catch(e){if(isCurrent())setError(e instanceof Error?e.message:"响应未确认，请重试同一操作");}
    finally{if(working.current===lock){working.current=null;if(active.current&&lifecycle.current===version)setBusy(false);}}
  }
  return {pending,busy,error,setError,send};
}
type Command=ReturnType<typeof useCommand>;
function CommandStatus({command}:{command:Command}) {
  return <>{command.error&&<p role="alert" className="text-sm text-red-700">{command.error}</p>}{command.pending&&<div className="space-y-2"><p className="text-sm">这次操作正在核对结果；重试沿用原编号，不重复处理。</p><Button disabled={command.busy} onClick={()=>command.send()} type="button">重试确认此操作</Button></div>}</>;
}
function submit(event:FormEvent,command:Command,body:()=>Record<string,unknown>){event.preventDefault();try{void command.send(body());}catch(error){command.setError(error instanceof Error?error.message:"请检查填写内容");}}
function CustomerRequest(context:Context) {
  const command=useCommand(context,"request","cancellations"),[selected,setSelected]=useState<string[]>([]),[reason,setReason]=useState("");
  const eligible=context.sale.lines.flatMap(l=>l.fulfillments).filter(f=>!["客户取消","已完成"].includes(f.status)&&!context.sale.cancellations.some(c=>c.status==="pending"&&c.order_ids.includes(f.order_id)));
  return <div className={panel}><CommandStatus command={command}/>{!command.pending&&eligible.length>0&&<form className="space-y-2" onSubmit={e=>submit(e,command,()=>({order_ids:selected.filter(id=>eligible.some(f=>f.order_id===id)),reason}))}>
    <h4 className="font-medium">申请取消部分服务</h4><p className="text-sm">申请后仍照常办理，管理员批准后才取消；退款另行核对。</p>
    {eligible.map(f=><label key={f.order_id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(f.order_id)} disabled={command.busy} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.order_id]:ids.filter(id=>id!==f.order_id))}/>{"取消 "+copyLabel(context.sale,f.order_id)}</label>)}
    <label className="block text-sm">取消原因<textarea required maxLength={500} className={field} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button disabled={command.busy||!selected.some(id=>eligible.some(f=>f.order_id===id))} type="submit">提交取消申请</Button>
  </form>}</div>;
}
function Withdraw(context:Context&{request:CommerceCancellation}) {
  const command=useCommand(context,"withdraw-"+context.request.id,"cancellations/"+context.request.id+"/withdraw");
  return <><CommandStatus command={command}/>{!command.pending&&context.request.status==="pending"&&<Button variant="outline" disabled={command.busy} onClick={()=>command.send({})}>撤回此申请</Button>}</>;
}
function Decision(context:Context&{request:CommerceCancellation}) {
  const command=useCommand(context,"decision-"+context.request.id,"cancellations/"+context.request.id+"/decision"),[decision,setDecision]=useState("approve"),[note,setNote]=useState(""),[amounts,setAmounts]=useState<Record<string,string>>({});
  return <><CommandStatus command={command}/>{!command.pending&&context.request.status==="pending"&&<form className="space-y-2" onSubmit={e=>submit(e,command,()=>({revision:context.sale.billing.revision,decision,public_note:note,credits:decision==="reject"?[]:context.request.order_ids.map(order_id=>({order_id,credit_cents:cents(amounts[order_id]??"")}))}))}>
    <label className="block text-sm">处理决定<select className={field} value={decision} onChange={e=>setDecision(e.target.value)}><option value="approve">批准取消</option><option value="reject">拒绝，继续办理</option></select></label>
    {decision==="approve"&&<><p className="text-sm">逐份明确本次减免：不减免填 0。批准不自动转账，已收款的减免会列为待退款。</p>{context.request.order_ids.map(id=><label key={id} className="block text-sm">{"本次减免（元） "+copyLabel(context.sale,id)}<input aria-label={"本次减免（元） "+copyLabel(context.sale,id)} required inputMode="decimal" className={field} value={amounts[id]??""} onChange={e=>setAmounts({...amounts,[id]:e.target.value})}/><span>最多 {money(context.sale.billing.allocations.find(a=>a.order_id===id)?.adjusted_cents??0)}</span></label>)}</>}
    <label className="block text-sm">公开处理说明<textarea required maxLength={500} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label><Button type="submit" disabled={command.busy}>确认处理申请</Button>
  </form>}</>;
}
function Credit(context:Context) {
  const command=useCommand(context,"credit","adjustments"),[amounts,setAmounts]=useState<Record<string,string>>({}),[reason,setReason]=useState("");
  return <details className={panel} open={!!command.pending||undefined}><summary className="cursor-pointer">管理员追加账单减免</summary><CommandStatus command={command}/>{!command.pending&&<form className="space-y-2" onSubmit={e=>submit(e,command,()=>({revision:context.sale.billing.revision,reason,credits:context.sale.billing.allocations.filter(a=>amounts[a.order_id]?.trim()).map(a=>({order_id:a.order_id,credit_cents:cents(amounts[a.order_id])}))}))}>
    <p className="text-sm">只追加减免记录，不改原成交、不恢复服务、不自动退款；未填写的份数保持不变。</p>
    {context.sale.billing.allocations.filter(a=>a.adjusted_cents>0).map(a=><label className="block text-sm" key={a.order_id}>{"追加减免（元） "+copyLabel(context.sale,a.order_id)}<input aria-label={"追加减免（元） "+copyLabel(context.sale,a.order_id)} inputMode="decimal" className={field} value={amounts[a.order_id]??""} onChange={e=>setAmounts({...amounts,[a.order_id]:e.target.value})}/><span>最多 {money(a.adjusted_cents)}</span></label>)}
    <label className="block text-sm">公开减免说明<textarea required maxLength={500} className={field} value={reason} onChange={e=>setReason(e.target.value)}/></label><Button type="submit" disabled={command.busy}>登记账单减免</Button>
  </form>}</details>;
}
function Refund(context:Context) {
  const command=useCommand(context,"refund","refunds"),[amounts,setAmounts]=useState<Record<string,string>>({}),[reason,setReason]=useState(""),[reference,setReference]=useState(""),[checked,setChecked]=useState(false);
  return <details className={panel} open={!!command.pending||undefined}><summary className="cursor-pointer">管理员登记实际退款 · 待退 {money(context.sale.billing.refund_due_cents)}</summary><CommandStatus command={command}/>{!command.pending&&context.sale.billing.refund_due_cents>0&&<form className="space-y-2" onSubmit={e=>submit(e,command,()=>({revision:context.sale.billing.revision,reason,reference,transferred:checked,items:context.sale.billing.allocations.filter(a=>a.refund_due_cents>0&&amounts[a.order_id]?.trim()).map(a=>({order_id:a.order_id,amount_cents:cents(amounts[a.order_id])}))}))}>
    <p className="text-sm">先在实际收付款渠道核实，这里只登记已发生的退款，不发起转账，不重复列为办理成本。</p>
    {context.sale.billing.allocations.filter(a=>a.refund_due_cents>0).map(a=><label className="block text-sm" key={a.order_id}>{"本次实退（元） "+copyLabel(context.sale,a.order_id)}<input aria-label={"本次实退（元） "+copyLabel(context.sale,a.order_id)} inputMode="decimal" className={field} value={amounts[a.order_id]??""} onChange={e=>setAmounts({...amounts,[a.order_id]:e.target.value})}/><span>最多 {money(a.refund_due_cents)}</span></label>)}
    <label className="block text-sm">实际退款凭证<input required maxLength={120} className={field} value={reference} onChange={e=>setReference(e.target.value)}/></label><label className="block text-sm">公开退款说明<textarea required maxLength={500} className={field} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>已核实实际退回上述款项（不是发起转账）</label><Button type="submit" disabled={command.busy||!checked}>登记实际退款</Button>
  </form>}</details>;
}
export function CommerceAftercare(context:Context) {
  const {sale,role}=context,b=sale.billing;
  const status={unpaid:"待收款",paid:"已结清",voided:"已全部减免，无需收款",refund_due:"待实际退款",refunded:"已全部退款"}[b.settlement];
  return <section className="space-y-3" aria-label="取消与账单联动">
    <div className={panel} data-commerce-billing><h4 className="font-medium">账单核对 · {status}</h4><p className="text-sm">原成交 {money(b.original_cents)} · 累计减免 {money(b.credited_cents)} · 调整后应收 {money(b.adjusted_cents)}</p><p className="text-sm">已收 {money(b.received_cents)} · 已退 {money(b.refunded_cents)} · 待收 {money(b.balance_due_cents)} · 待退 {money(b.refund_due_cents)}</p><p className="text-xs">原成交和凭证保留；减免与实际退款分开记录。核对版本 {b.revision}</p></div>
    {sale.cancellations.map(request=><div key={request.id} className={panel} data-cancellation-id={request.id}><h4 className="font-medium">取消申请 · {{pending:"待管理员处理",approved:"已批准",rejected:"已拒绝",withdrawn:"已撤回"}[request.status]}</h4><p className="text-sm">{request.order_ids.map(id=>copyLabel(sale,id)).join("、")}</p><p className="text-sm">申请原因：{request.reason}</p>{request.public_note&&<p className="text-sm">处理说明：{request.public_note}</p>}{role==="client"&&<Withdraw {...context} request={request}/>} {role==="admin"&&<Decision {...context} request={request}/>}</div>)}
    {role==="client"&&<CustomerRequest {...context}/>}{role==="admin"&&<><Credit {...context}/><Refund {...context}/></>}
    {(b.adjustments.length>0||b.refunds.length>0)&&<details className={panel}><summary className="cursor-pointer">查看减免与退款记录</summary>{b.adjustments.map(a=><p key={a.id} className="break-words text-sm">减免 {money(a.items.reduce((n,i)=>n+i.credit_cents,0))} · {a.reason} · {toThaiTime(a.created_at)}</p>)}{b.refunds.map(r=><p key={r.id} className="break-words text-sm">实退 {money(r.items.reduce((n,i)=>n+i.amount_cents,0))} · {r.reason} · 凭证 {r.reference} · {toThaiTime(r.created_at)}</p>)}</details>}
  </section>;
}
