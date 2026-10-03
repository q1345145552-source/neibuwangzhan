import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import type { CommerceSale } from "./commerce-types";
import { readSale } from "./commerce";
import { advanceRevision, expectRevision } from "./commerce-ledger";
import { fail, recordBody, only, boundedText, audit } from "./commerce-validation";

function key(value: unknown): string {
  const id = boundedText(value,80,"操作编号");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(id)) fail(400,"INVALID_REQUEST_ID","操作编号格式有误");
  return id;
}
function admin(actor: TokenPayload) { if (actor.role !== "admin") fail(403,"ADMIN_REQUIRED","此操作由管理员处理"); }
function customer(actor: TokenPayload) { if (actor.role !== "client") fail(403,"CUSTOMER_REQUIRED","请使用购买账号提交申请"); }
function orderIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 90) return fail(400,"INVALID_ITEMS","请选择要取消的办理份数");
  const ids=value.map(id=>boundedText(id,80,"办理单编号")).sort();
  if(new Set(ids).size!==ids.length) fail(400,"DUPLICATE_ITEM","同一份服务仅选择一次");
  return ids;
}
function creditItems(sale: CommerceSale, value: unknown, allowZero = false): {order_id:string;credit_cents:number}[] {
  if(!Array.isArray(value) || !value.length || value.length>90) return fail(400,"INVALID_CREDIT","请明确填写各份减免金额；不减免填 0");
  const items=value.map(v=>{
    const row=recordBody(v);only(row,["order_id","credit_cents"]);const order_id=boundedText(row.order_id,80,"办理单编号");const n=row.credit_cents;
    const allocation=sale.billing.allocations.find(a=>a.order_id===order_id);
    if(!allocation) return fail(404,"NOT_FOUND","办理单不属于这笔购买");
    if(typeof n!=="number" || !Number.isSafeInteger(n) || n<(allowZero?0:1) || n>allocation.adjusted_cents) return fail(400,"INVALID_CREDIT","减免应为整数分，且不超出该份尚未减免金额");
    return {order_id,credit_cents:n};
  }).sort((a,b)=>a.order_id.localeCompare(b.order_id));
  if(new Set(items.map(i=>i.order_id)).size!==items.length) fail(400,"DUPLICATE_ITEM","同一份服务仅填写一次");
  return items;
}
function addCredit(db: Database.Database, actor: TokenPayload, saleId: string, requestId:string, identity:string, reason:string, items:{order_id:string;credit_cents:number}[], cancellationId:string|null) {
  const nonzero=items.filter(item=>item.credit_cents>0);if(!nonzero.length) return;
  const id="CREDIT-"+randomUUID();
  db.prepare("INSERT INTO commerce_adjustments(id,sale_id,request_id,request_json,reason,cancellation_id,created_by) VALUES (?,?,?,?,?,?,?)").run(id,saleId,requestId,identity,reason,cancellationId,actor.id);
  for(const item of nonzero)db.prepare("INSERT INTO commerce_adjustment_items(adjustment_id,order_id,credit_cents) VALUES (?,?,?)").run(id,item.order_id,item.credit_cents);
}
function replay(old:{request_json:string}|undefined, identity:string): boolean {
  if(!old)return false;
  if(old.request_json!==identity)fail(409,"REQUEST_CONFLICT","同一操作编号的内容已经改变，请核对原记录");
  return true;
}

export function requestCancellation(db: Database.Database, actor:TokenPayload, saleId:string, input:unknown):CommerceSale {
  customer(actor);const body=recordBody(input);only(body,["request_id","order_ids","reason"]);
  const requestId=key(body.request_id),ids=orderIds(body.order_ids),reason=boundedText(body.reason,500,"取消原因"),identity=JSON.stringify({order_ids:ids,reason});
  return db.transaction(()=>{
    const sale=readSale(db,actor,saleId);
    if(replay(db.prepare("SELECT request_json FROM commerce_cancellations WHERE sale_id=? AND buyer_account_id=? AND request_id=?").get(saleId,actor.id,requestId) as {request_json:string}|undefined,identity))return sale;
    for(const id of ids){
      const order=sale.lines.flatMap(line=>line.fulfillments).find(f=>f.order_id===id);
      if(!order)fail(404,"NOT_FOUND","办理单不属于这笔购买");
      if(order.status==="客户取消"||order.status==="已完成")fail(409,"ORDER_FINISHED","该份已取消或已完成，请联系管理员核对");
      if(sale.cancellations.some(c=>c.status==="pending"&&c.order_ids.includes(id)))fail(409,"CANCELLATION_CONFLICT","该份已有待处理申请，请查看原申请");
    }
    const id="CANCEL-"+randomUUID();db.prepare("INSERT INTO commerce_cancellations(id,sale_id,buyer_account_id,request_id,request_json,reason) VALUES (?,?,?,?,?,?)").run(id,saleId,actor.id,requestId,identity,reason);
    for(const orderId of ids)db.prepare("INSERT INTO commerce_cancellation_items(cancellation_id,order_id) VALUES (?,?)").run(id,orderId);
    advanceRevision(db,saleId);audit(db,actor,"申请取消商城服务",saleId,JSON.stringify({id,order_ids:ids,reason}));return readSale(db,actor,saleId);
  }).immediate();
}
export function withdrawCancellation(db:Database.Database,actor:TokenPayload,saleId:string,cancellationId:string,input:unknown):CommerceSale {
  customer(actor);const body=recordBody(input);only(body,["request_id"]);const requestId=key(body.request_id),identity=JSON.stringify({action:"withdraw"});
  return db.transaction(()=>{
    const sale=readSale(db,actor,saleId);
    const row=db.prepare("SELECT status,decision_id,decision_json FROM commerce_cancellations WHERE id=? AND sale_id=? AND buyer_account_id=?").get(cancellationId,saleId,actor.id) as {status:string;decision_id:string;decision_json:string}|undefined;
    if(!row)fail(404,"NOT_FOUND","取消申请不存在");
    if(row.status==="withdrawn" && row.decision_id===requestId && row.decision_json===identity)return sale;
    if(row.status!=="pending")fail(409,"REQUEST_ALREADY_DECIDED","申请已有处理结果，请刷新核对");
    db.prepare("UPDATE commerce_cancellations SET status='withdrawn',decision_id=?,decision_json=?,public_note='客户撤回申请',decided_by=?,decided_at=datetime('now') WHERE id=?").run(requestId,identity,actor.id,cancellationId);
    advanceRevision(db,saleId);audit(db,actor,"撤回商城取消申请",saleId,cancellationId);return readSale(db,actor,saleId);
  }).immediate();
}
export function decideCancellation(db:Database.Database,actor:TokenPayload,saleId:string,cancellationId:string,input:unknown):CommerceSale {
  admin(actor);const body=recordBody(input);only(body,["request_id","revision","decision","public_note","credits"]);
  const requestId=key(body.request_id),note=boundedText(body.public_note,500,"向客户展示的处理说明");
  if(body.decision!=="approve" && body.decision!=="reject")fail(400,"INVALID_DECISION","请选择批准或拒绝");
  // Retain the original submitted version in identity, before interpreting mutable balances.
  const identity=JSON.stringify({revision:body.revision,decision:body.decision,public_note:note,credits:body.credits});
  return db.transaction(()=>{
    const sale=readSale(db,actor,saleId);
    const row=db.prepare("SELECT status,decision_id,decision_json FROM commerce_cancellations WHERE id=? AND sale_id=?").get(cancellationId,saleId) as {status:string;decision_id:string;decision_json:string}|undefined;
    if(!row)fail(404,"NOT_FOUND","取消申请不存在");
    if(row.decision_id===requestId){if(row.decision_json!==identity)fail(409,"REQUEST_CONFLICT","同一操作编号内容已改变");return sale;}
    if(row.status!=="pending")fail(409,"REQUEST_ALREADY_DECIDED","申请已有处理结果，请刷新核对");
    expectRevision(db,saleId,body.revision);
    if(body.decision==="reject"){
      if(!Array.isArray(body.credits)||body.credits.length)fail(400,"INVALID_CREDIT","拒绝申请不调整金额");
    } else {
      const credits=creditItems(sale,body.credits,true),request=sale.cancellations.find(c=>c.id===cancellationId)!;
      if(JSON.stringify(credits.map(c=>c.order_id).sort())!==JSON.stringify([...request.order_ids].sort()))fail(400,"INVALID_CREDIT","只填写本次申请的各份减免，其他服务保持原样");
      for(const item of credits){
        const order=sale.lines.flatMap(l=>l.fulfillments).find(f=>f.order_id===item.order_id)!;
        if(order.status==="已完成"||order.status==="客户取消")fail(409,"ORDER_FINISHED","办理状态已变化，请重新核对申请");
        db.prepare("UPDATE orders SET status='客户取消',cancel_reason=?,updated_at=datetime('now') WHERE id=?").run(note,item.order_id);
      }
      addCredit(db,actor,saleId,"approval:"+cancellationId,identity,note,credits,cancellationId);
    }
    db.prepare("UPDATE commerce_cancellations SET status=?,decision_id=?,decision_json=?,public_note=?,decided_by=?,decided_at=datetime('now') WHERE id=?").run(body.decision==="approve"?"approved":"rejected",requestId,identity,note,actor.id,cancellationId);
    advanceRevision(db,saleId);audit(db,actor,"处理商城取消申请",saleId,JSON.stringify({cancellation_id:cancellationId,decision:body.decision,public_note:note,credits:body.credits}));return readSale(db,actor,saleId);
  }).immediate();
}
export function adjustBill(db:Database.Database,actor:TokenPayload,saleId:string,input:unknown):CommerceSale {
  admin(actor);const body=recordBody(input);only(body,["request_id","revision","reason","credits"]);const requestId=key(body.request_id),reason=boundedText(body.reason,500,"公开减免说明");
  const identity=JSON.stringify({revision:body.revision,reason,credits:body.credits});
  return db.transaction(()=>{
    const sale=readSale(db,actor,saleId);
    if(replay(db.prepare("SELECT request_json FROM commerce_adjustments WHERE sale_id=? AND request_id=?").get(saleId,requestId) as {request_json:string}|undefined,identity))return sale;
    expectRevision(db,saleId,body.revision);const items=creditItems(sale,body.credits);
    addCredit(db,actor,saleId,requestId,identity,reason,items,null);advanceRevision(db,saleId);audit(db,actor,"登记商城减免",saleId,JSON.stringify({request_id:requestId,reason,credits:items}));return readSale(db,actor,saleId);
  }).immediate();
}
export function recordRefund(db:Database.Database,actor:TokenPayload,saleId:string,input:unknown):CommerceSale {
  admin(actor);const body=recordBody(input);only(body,["request_id","revision","reason","reference","items","transferred"]);
  const requestId=key(body.request_id),reason=boundedText(body.reason,500,"公开退款说明"),reference=boundedText(body.reference,120,"实际退款凭证");
  if(body.transferred!==true)fail(400,"REFUND_NOT_CONFIRMED","请核实实际退款后再登记，不会自动转账");
  const identity=JSON.stringify({revision:body.revision,reason,reference,items:body.items,transferred:true});
  return db.transaction(()=>{
    const sale=readSale(db,actor,saleId);
    if(replay(db.prepare("SELECT request_json FROM commerce_refunds WHERE sale_id=? AND request_id=?").get(saleId,requestId) as {request_json:string}|undefined,identity))return sale;
    expectRevision(db,saleId,body.revision);
    if(db.prepare("SELECT 1 FROM commerce_refunds WHERE sale_id=? AND reference=?").get(saleId,reference))fail(409,"REFUND_REFERENCE_EXISTS","该退款凭证已有记录，请核对原记录");
    if(!Array.isArray(body.items)||!body.items.length||body.items.length>90)fail(400,"INVALID_REFUND","请填写实际退款的各份金额");
    const items=body.items.map(value=>{
      const item=recordBody(value);only(item,["order_id","amount_cents"]);const order_id=boundedText(item.order_id,80,"办理单编号"),n=item.amount_cents;
      const allocation=sale.billing.allocations.find(a=>a.order_id===order_id);if(!allocation)fail(404,"NOT_FOUND","办理单不属于这笔购买");
      if(typeof n!=="number"||!Number.isSafeInteger(n)||n<1||n>allocation.refund_due_cents)fail(400,"INVALID_REFUND","退款应为整数分，且不超出该份已经减免而尚未退回的实收款");
      return {order_id,amount_cents:n};
    });
    if(new Set(items.map(i=>i.order_id)).size!==items.length)fail(400,"DUPLICATE_ITEM","同一份退款仅填写一次");
    const id="REFUND-"+randomUUID();db.prepare("INSERT INTO commerce_refunds(id,sale_id,request_id,request_json,reference,reason,created_by) VALUES (?,?,?,?,?,?,?)").run(id,saleId,requestId,identity,reference,reason,actor.id);
    for(const item of items){
      const finance=db.prepare("INSERT INTO finances(order_id,type,amount,status,currency,description,slip_number) VALUES (?,'expense',?,'paid','CNY',?,?)").run(item.order_id,item.amount_cents/100,"商城退款（非办理成本） "+id,reference);
      db.prepare("INSERT INTO commerce_refund_items(refund_id,order_id,amount_cents,finance_id) VALUES (?,?,?,?)").run(id,item.order_id,item.amount_cents,finance.lastInsertRowid);
    }
    advanceRevision(db,saleId);audit(db,actor,"登记商城实际退款",saleId,JSON.stringify({id,reference,items}));return readSale(db,actor,saleId);
  }).immediate();
}
