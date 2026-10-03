import { NextRequest, NextResponse } from "next/server";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { getDb } from "./db";
import { verifyAuth } from "./auth";
import { commerceJson } from "./commerce-api";
import { CommerceError, fail, boundedText } from "./commerce-validation";
import { listProducts, readSale } from "./commerce";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as changePassword } from "@/app/api/auth/change-password/route";
import { customerBridgeEnabled, bridgeSchema, customerProducts, importedRows, customerCart, changeCustomerCart, customerOrderDetail, customerOrders, purchaseCustomerCart, purchaseCustomerProduct, customerInvoice, customerOrder } from "./customer-bridge";
import { customerDocuments, submitCustomerDocuments, downloadCustomerDocument } from "./customer-bridge-documents";

const headers={"Cache-Control":"private, no-store",Vary:"Authorization, Cookie"};
const json=(value:unknown,status=200,extra:Record<string,string>={})=>NextResponse.json(value,{status,headers:{...headers,...extra}});
export async function customerBridgeRequest(original:NextRequest,segments:string[]):Promise<Response>{
 const route=segments.join("/"),method=original.method;let req=original;
 try{
  if(!customerBridgeEnabled())return fail(404,"BRIDGE_DISABLED","数据接线入口尚未启用");
  if(route==="auth/login"&&method==="POST"){
   const body=await commerceJson(req);
   const user=getDb().prepare("SELECT role FROM employees WHERE email=?").get(String(body.email??"")) as {role:string}|undefined;
   if(user&&user.role!=="client")return fail(403,"CUSTOMER_ENTRY","此处为客户原登录入口，员工请使用内部系统原登录页");
   const response=await login(new NextRequest(req.url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}));
   const value=await response.json();
   if(!response.ok)return json(value,response.status,Object.fromEntries(response.headers));
   const result=json({...value,user:{...value.user,id:String(value.user.id),role:"customer"}});
   result.cookies.set("customer_download",value.token,{httpOnly:true,sameSite:"strict",secure:req.nextUrl.protocol==="https:",path:"/api",maxAge:43200});return result;
  }
  if(route==="auth/register"&&method==="POST")return fail(501,"REGISTRATION_NOT_CONNECTED","旧客户注册与身份迁移尚未接通，请使用现有测试账号");
  if(route==="auth/logout"&&method==="POST"){
   const result=json({ok:true});result.cookies.set("customer_download","",{httpOnly:true,sameSite:"strict",path:"/api",maxAge:0});return result;
  }
  // Cookie is download-only. It never authorizes a write or an ordinary API request.
  if(method==="GET"&&/^documents\/[^/]+\/download$/.test(route)&&!req.headers.has("Authorization")){
   const token=req.cookies.get("customer_download")?.value;
   if(token){const h=new Headers(req.headers);h.set("Authorization","Bearer "+token);req=new NextRequest(req.url,{headers:h});}
  }
  const actor=await verifyAuth(req,{allowPasswordChangeRequired:route==="auth/change-password"});
  if(!actor)return fail(401,"LOGIN_REQUIRED","请先登录");
  if(actor.role!=="client")return fail(403,"CUSTOMER_REQUIRED","此数据接口只服务当前客户，员工使用内部原接口");
  const db=getDb();bridgeSchema(db);
  if(route==="auth/refresh-cookie"&&method==="POST"){
   const result=json({ok:true});result.cookies.set("customer_download",req.headers.get("Authorization")!.slice(7),{httpOnly:true,sameSite:"strict",secure:req.nextUrl.protocol==="https:",path:"/api",maxAge:43200});return result;
  }
  if(route==="auth/change-password"&&method==="POST"){
   const body=await commerceJson(req);return await changePassword(new NextRequest(req.url,{method:"POST",headers:{Authorization:req.headers.get("Authorization")!,"Content-Type":"application/json"},body:JSON.stringify({current_password:body.oldPassword,new_password:body.newPassword})}));
  }
  if(route==="auth/me"){
   if(method==="PATCH"){const body=await commerceJson(req);const name=boundedText(body.name,80,"姓名");db.prepare("UPDATE employees SET name=? WHERE id=?").run(name,actor.id);}
   else if(method!=="GET")return fail(405,"METHOD_NOT_ALLOWED","操作方法不匹配");
   const user=db.prepare("SELECT id,name,email FROM employees WHERE id=?").get(actor.id) as {id:number;name:string;email:string};return json({...user,id:String(user.id),role:"customer"});
  }
  if(route==="customers"&&method==="GET"){
   const user=db.prepare("SELECT id,name,email,created_at FROM employees WHERE id=?").get(actor.id) as {id:number;name:string;email:string;created_at:string};
   const orders=customerOrders(db,actor);return json({customers:[{...user,id:String(user.id),created_at:user.created_at.replace(" ","T")+"Z",phone:null,orderCount:orders.length,orders}]});
  }
  if(route==="products"&&method==="GET")return json(customerProducts(db,actor));
  if(route==="spot"&&method==="GET")return json(importedRows(db,"spot_items"));
  if(route.startsWith("spot/")&&segments.length===2&&method==="GET"){
   const row=importedRows(db,"spot_items").find(row=>row.id===segments[1]);if(!row)return fail(404,"NOT_FOUND","现货不存在");return json(row);
  }
  if(route==="subscriptions/products"&&method==="GET")return json(importedRows(db,"subscription_products"));
  if(route==="cart"&&method==="GET"){
   const current=customerCart(db,actor);return json(current.items,200,{"X-Cart-Revision":String(current.revision)});
  }
  if(route==="cart/checkout"&&method==="POST"){
   const body=await commerceJson(req);
   try{return json(purchaseCustomerCart(db,actor,body));}
   catch(error){
    if(error instanceof CommerceError&&error.code==="QUOTE_CHANGED"){
     const current=customerCart(db,actor),products=listProducts(db,actor);
     const changes=current.items.filter(item=>products.find(p=>p.id===item.core_product_id)?.revision!==item.product_revision).map(item=>{
      const now=products.find(p=>p.id===item.core_product_id);return {id:item.id,skuName:item.sku_name,reason:"当前报价或状态已变化",oldPrice:item.price,newPrice:now?.active?now.price_cents/100:null,oldCurrency:item.currency,newCurrency:now?.currency,available:!!now?.active};
     });
     return json({error:error.message,code:"CART_REVIEW_REQUIRED",changes},409);
    }
    throw error;
   }
  }
  if((route==="cart"||route.startsWith("cart/"))&&["POST","PATCH","DELETE"].includes(method)){
   const value=req.headers.get("If-Match");if(!value||!/^\d+$/.test(value))return fail(428,"CART_VERSION_REQUIRED","请先加载购物车后操作");
   const body=method==="DELETE"||route==="cart/refresh-prices"?{}:await commerceJson(req);const key=req.headers.get("X-Request-Id")??"";
   const result=changeCustomerCart(db,actor,route,method,body,Number(value),key);return json(result.items,200,{"X-Cart-Revision":String(result.revision)});
  }
  if(route==="orders"){
   if(method==="GET")return json(customerOrders(db,actor));
   if(method==="POST")return json(purchaseCustomerProduct(db,actor,await commerceJson(req)));
  }
  if(segments[0]==="orders"&&segments[1]){
   const id=segments[1];
   if(segments.length===2&&method==="GET")return json(customerOrderDetail(db,actor,id));
   if(segments[2]==="requirements"&&method==="GET")return json(customerDocuments(db,actor,id));
   if(segments[2]==="documents"&&method==="POST")return json(await submitCustomerDocuments(req,db,actor,id));
   if(segments[2]==="receipt"&&method==="POST")return json(await submitCustomerDocuments(req,db,actor,id,"receipt"));
   if(segments[2]==="receipts"&&method==="GET")return json({receipts:customerDocuments(db,actor,id,"receipt").submissions});
  }
  if(segments[0]==="documents"&&segments[2]==="download"&&method==="GET")return await downloadCustomerDocument(req,db,actor,segments[1]);
  if(route==="customer/doc-todos"&&method==="GET"){
   const todos=customerOrders(db,actor).filter(order=>!["completed","cancelled"].includes(order.status)).map(order=>{
    const data=customerDocuments(db,actor,order.id);const pendingCount=data.requirements.filter(req=>!data.submissions.some(s=>s.requirement_id===req.id&&s.status!=="rejected")).length;
    return {...order,...data,pendingCount,rejectedCount:data.submissions.filter(s=>s.status==="rejected").length,hasAction:pendingCount>0};
   }).filter(row=>row.hasAction);return json({todos});
  }
  if(route==="notifications"&&method==="GET"){
   // Customer events are derived solely from that customer's sales, not employee broadcasts.
   db.exec("CREATE TABLE IF NOT EXISTS commerce_customer_seen_events(account_id INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(account_id,event_id))");
   const list=customerOrders(db,actor).slice(0,50).map(order=>({id:order.id,type:"order",title:"订单已接收",message:order.sku_name,content:order.sku_name,order_id:order.id,link:"/dashboard/order/"+order.id,created_at:order.created_at,is_read:db.prepare("SELECT 1 FROM commerce_customer_seen_events WHERE account_id=? AND event_id=?").get(actor.id,order.id)?1:0}));return json({list,unread:list.filter(n=>!n.is_read).length});
  }
  if(route.startsWith("notifications/")&&method==="PATCH"){
   db.exec("CREATE TABLE IF NOT EXISTS commerce_customer_seen_events(account_id INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(account_id,event_id))");
   const ids=route==="notifications/read-all"?customerOrders(db,actor).map(o=>o.id):[readSale(db,actor,segments[1]).id];
   db.transaction(()=>{for(const id of ids)db.prepare("INSERT OR IGNORE INTO commerce_customer_seen_events VALUES (?,?)").run(actor.id,id);})();return json({ok:true});
  }
  if(segments[0]==="download-invoice"&&segments.length===2&&method==="GET"){
   const sale=readSale(db,actor,segments[1]);const assets=process.env.CUSTOMER_COMPAT_ASSETS;
   if(!assets)return fail(503,"ASSETS_NOT_READY","原账单模板尚未准备");
   const renderer=await import(/* webpackIgnore: true */ pathToFileURL(path.join(assets,"invoice-renderer.cjs")).href) as {generateInvoicePdf:(id:string,data:unknown)=>Promise<Buffer>};
   const user=db.prepare("SELECT name,email FROM employees WHERE id=?").get(actor.id);
   const buffer=await renderer.generateInvoicePdf(sale.id,{order:customerOrder(sale),invoice:customerInvoice(sale),user});return new NextResponse(new Uint8Array(buffer),{headers:{...headers,"Content-Type":"application/pdf"}});
  }
  if(segments[0]==="templates"&&segments.length===2&&method==="GET"){
   const allowed="company-register-form.xlsx";if(segments[1]!==allowed)return fail(404,"NOT_FOUND","模板不存在");
   const assets=process.env.CUSTOMER_COMPAT_ASSETS;if(!assets)return fail(503,"ASSETS_NOT_READY","原资料模板尚未准备");
   const buffer=await readFile(path.join(assets,"templates",allowed));return new NextResponse(new Uint8Array(buffer),{headers:{...headers,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}});
  }
  return fail(501,"MODULE_NOT_CONNECTED","该模块的数据映射尚未接通，本次未执行业务操作");
 }catch(error){
  if(error instanceof CommerceError)return json({error:error.message,code:error.code},error.status);
  console.error("[customer-bridge] request failed",error);return json({error:"操作结果尚未确认，请保留原请求后重试",code:"RETRY_SAME_REQUEST"},500);
 }
}
