import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root=process.env.INTERNAL_SOURCE_ROOT || process.cwd();
const output=process.env.MERGE_EVIDENCE || "/tmp";
const fixture=fs.mkdtempSync("/tmp/xt-commerce-handlers-");
process.env.DB_PATH=path.join(fixture,"synthetic.db");
process.env.INTERNAL_APP_ROOT=root;
Object.assign(process.env,{NODE_ENV:"test"}); process.env.COMMERCE_PILOT_ENABLED="1";
process.env.JWT_SECRET="local-merge-test-key"; process.env.CUSTOMER_SYNC_URL=""; process.env.SYNC_SECRET="";
process.chdir(fixture); // Uploaded bytes belong to this isolated fixture, not project uploads.
const require=createRequire(path.join(root,"package.json"));
const { NextRequest }=require("next/server") as typeof import("next/server");
const bcrypt=require("bcryptjs") as typeof import("bcryptjs");
const load=(relative:string)=>import(pathToFileURL(path.join(root,relative)).href);
const {getDb}=await load("src/lib/db.ts") as typeof import("../src/lib/db");
const {ensureCommerceSchema}=await load("src/lib/commerce-schema.ts") as typeof import("../src/lib/commerce-schema");
const db=getDb();
type Row=Record<string,unknown>;
const records: Row[]=[];const results: Row[]=[];
const users:Record<string,{id:number;token:string}>={};
type Context={params:Promise<{id:string;filename?:string}>};
type Handler=(req:InstanceType<typeof NextRequest>,ctx:Context)=>Promise<Response>;
async function call(route:string,method:string,role?:string,body?:unknown,id="",expected?:number) {
  const routeModule=await load("src/app/api/"+route+"/route.ts") as Record<string,Handler>;
  const headers:Record<string,string>={};
  if(role)headers.Authorization="Bearer "+users[role].token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await routeModule[method](new NextRequest("http://127.0.0.1/api/"+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({id,filename:id})});
  const text=await response.text();let value:unknown=text;
  try{value=JSON.parse(text);}catch{}
  records.push({route,method,role:role || null,input:body??null,id,status:response.status,body:text});
  if(expected!==undefined)assert.equal(response.status,expected,text.slice(0,600));
  return value as Row;
}
async function test(name:string,fn:()=>Promise<void>) {
  try{await fn();results.push({name,passed:true});console.log("PASS "+name);}
  catch(error){results.push({name,passed:false,error:String(error)});console.error("FAIL "+name,error);}
}
for(const [key,role]of [["admin","admin"],["staff","employee"],["a","client"],["b","client"]]) {
  const id=Number(db.prepare("INSERT INTO employees(name,email,role,password,must_change_password) VALUES (?,?,?,?,0)").run(key==="a"||key==="b"?"SAME NAME":key,key+"@example.test",role,bcrypt.hashSync("SyntheticPass!42",4)).lastInsertRowid);
  db.prepare("INSERT INTO client_scope_settings(employee_id,mode) VALUES (?,'explicit')").run(id);
  const data=await call("auth/login","POST",undefined,{email:key+"@example.test",password:"SyntheticPass!42"},"",200);
  users[key]={id,token:String(data.token)};
}
type Sale=import("../src/lib/commerce-types").CommerceSale;
type Product=import("../src/lib/commerce-types").CommerceProduct;
let product:Product;let sale:Sale;let purchase:Row;let firstOrder:string;
const count=(table:string)=>Number((db.prepare("SELECT count(*) n FROM "+table).get() as {n:number}).n);
const totals=()=>Object.fromEntries(["commerce_sales","commerce_lines","commerce_invoices","commerce_fulfillments","orders","order_steps","step_documents","audit_logs","finances","sync_inbox","sync_orders","sync_progress_outbox"].map(t=>[t,count(t)]));
try {
await test("feature gate is off before auth and does not create sales",async()=>{
  process.env.COMMERCE_PILOT_ENABLED="0";await call("commerce/products","GET",undefined,undefined,"",404);
  process.env.COMMERCE_PILOT_ENABLED="1";await call("commerce/orders","POST",undefined,{},"",401);
  assert.equal(count("commerce_sales"),0);
});
await test("admin products: employee/customer denied, unsupported SKU/float/currency rejected",async()=>{
  const body={sku:"COM-001",name:"Synthetic registration (without VAT)",price_cents:12345,active:true};
  await call("commerce/products","POST","staff",body,"",403);await call("commerce/products","POST","a",body,"",403);
  await call("commerce/products","POST","admin",{...body,sku:"TAX-012"},"",400);
  await call("commerce/products","POST","admin",{...body,price_cents:1.5},"",400);
  await call("commerce/products","POST","admin",{...body,currency:"THB"},"",400);
  product=await call("commerce/products","POST","admin",body,"",201) as unknown as Product;
  await call("commerce/products","POST","admin",body,"",409);
});
await test("server quote, quantity and ownership supplied by session rather than body",async()=>{
  purchase={request_id:"native-request-00000001",lines:[{product_id:product.id,quantity:2,revision:product.revision}]};
  const q=await call("commerce/quote","POST","a",{lines:purchase.lines},"",200);assert.equal(q.total_cents,24690);
  for(const quantity of [0,-1,1.1,11,"2"])await call("commerce/orders","POST","a",{...purchase,lines:[{product_id:product.id,quantity,revision:1}]},"",400);
  for(const body of [{...purchase,buyer_account_id:users.b.id},{...purchase,total_cents:1},{...purchase,currency:"THB"}])await call("commerce/orders","POST","a",body,"",400);
  await call("commerce/orders","POST","staff",purchase,"",403);
});
await test("one sale + one unpaid bill + two native original-workflow fulfillments, no sync or income",async()=>{
  const data=await call("commerce/orders","POST","a",purchase,"",201);sale=data.sale as Sale;
  assert.equal(data.duplicate,false);assert.equal(sale.buyer_account_id,users.a.id);
  assert.equal(sale.total_cents,24690);assert.equal(sale.invoice.status,"unpaid");
  assert.equal(sale.lines[0].fulfillments.length,2);
  [firstOrder]=sale.lines[0].fulfillments.map(f=>f.order_id);
  assert.equal(count("commerce_invoices"),1);assert.equal(count("finances"),0);assert.equal(count("sync_inbox"),0);assert.equal(count("sync_orders"),0);assert.equal(count("sync_progress_outbox"),0);
  assert.equal(sale.lines[0].fulfillments.reduce((n,f)=>n+f.allocated_cents,0),24690);
  for(const f of sale.lines[0].fulfillments)assert.equal(f.steps.length,12);
  const s=JSON.stringify(sale);assert(!s.includes("Bam"));assert(!s.includes("等待老板"));assert(!s.includes("飞书"));
});
await test("same key replays exact order after repricing; changed payload conflicts; new order uses new price",async()=>{
  const snapshot=totals();
  const repeats=await Promise.all(Array.from({length:5},()=>call("commerce/orders","POST","a",purchase,"",201)));
  for(const d of repeats){assert.equal((d.sale as Sale).id,sale.id);assert.equal(d.duplicate,true);}
  assert.deepEqual(totals(),snapshot);
  product=await call("commerce/products","POST","admin",{id:product.id,sku:product.sku,name:product.name,price_cents:23456,active:true,revision:1},"",201) as unknown as Product;
  const replay=await call("commerce/orders","POST","a",purchase,"",201);assert.equal((replay.sale as Sale).total_cents,24690);
  await call("commerce/orders","POST","a",{...purchase,lines:[{product_id:product.id,quantity:1,revision:1}]},"",409);
  await call("commerce/orders","POST","a",{...purchase,request_id:"different-request-stale"},"",409);
  const next=await call("commerce/orders","POST","a",{request_id:"different-request-fresh",lines:[{product_id:product.id,quantity:1,revision:2}]},"",201);
  assert.equal((next.sale as Sale).total_cents,23456);
});
await test("same-name buyer B sees no A orders; generic APIs remain separated; rename retains exact owner",async()=>{
  await call("commerce/orders/[id]","GET","b",undefined,sale.id,404);
  assert.equal((await call("commerce/orders","GET","b",undefined,"",200) as unknown as unknown[]).length,0);
  await call("orders/[id]","GET","a",undefined,firstOrder,404);
  await call("external/orders/[id]","GET","a",undefined,firstOrder,404);
  db.prepare("UPDATE employees SET name='RENAMED BUYER' WHERE id=?").run(users.a.id);
  await call("commerce/orders/[id]","GET","a",undefined,sale.id,200);
});
await test("staff original steps advance immediately; private notes/costs absent; buyer step edits denied",async()=>{
  const step=sale.lines[0].fulfillments[0].steps[0].id;
  await call("orders/[id]/steps","PATCH","a",{step_id:step,status:"已完成"},firstOrder,403);
  await call("orders/[id]/steps","PATCH","staff",{step_id:step,status:"已完成",notes:"PRIVATE_NOTE_SENTINEL"},firstOrder,200);
  await call("orders/[id]/finances","POST","staff",{type:"expense",amount:10,description:"PRIVATE_COST_SENTINEL"},firstOrder,201);
  const detail=await call("commerce/orders/[id]","GET","a",undefined,sale.id,200) as unknown as Sale;
  assert.equal(detail.lines[0].fulfillments[0].steps[0].status,"已完成");
  assert.equal(detail.lines[0].fulfillments[0].status,"进行中");
  assert(!JSON.stringify(detail).includes("PRIVATE_"));assert.equal(count("sync_progress_outbox"),0);
  await call("orders/[id]/finances","GET","a",undefined,firstOrder,403);
});
await test("money/scope/cancel/delete bypasses blocked while costs and staff notes preserved",async()=>{
  for(const body of [{type:"income",amount:1},{type:"income",amount:246.9,status:"paid"}])await call("orders/[id]/finances","POST","staff",body,firstOrder,409);
  const cost=db.prepare("SELECT id FROM finances WHERE order_id=? AND type='expense'").get(firstOrder) as {id:number};
  await call("orders/[id]/finances","PATCH","staff",{finance_id:cost.id,type:"income"},firstOrder,409);
  await call("orders/[id]/finances","PATCH","staff",{finance_id:cost.id,amount:20},firstOrder,200);
  for (const amount of [-100, "Infinity", 1.001, null]) {
    await call("orders/[id]/finances","POST","staff",{type:"expense",amount},firstOrder,400);
    await call("orders/[id]/finances","PATCH","staff",{finance_id:cost.id,amount},firstOrder,400);
  }
  assert.equal((db.prepare("SELECT amount FROM finances WHERE id=?").get(cost.id) as {amount:number}).amount,20);
  for(const body of [{total_amount:1},{business_type_id:2},{sub_service_type:"vat"},{customer_name:"OTHER"},{cancel:true,cancel_reason:"test"},{restore:true},{status:"客户取消"}])
    await call("orders/[id]","PATCH","admin",body,firstOrder,409);
  await call("orders/[id]","DELETE","admin",undefined,firstOrder,409);
  await call("orders/[id]","PATCH","staff",{description:"PRIVATE DESCRIPTION",responsible_person:"staff"},firstOrder,200);
});
await test("real file bytes: buyer uploads, staff reviews/publishes, another buyer denied, withdraw revokes",async()=>{
  async function upload(role:string,name:string) {
    const form=new FormData();form.set("file",new File(["%PDF-1.4\nSynthetic file\n%%EOF"],name,{type:"application/pdf"}));
    const mod=await load("src/app/api/upload/route.ts") as {POST:Handler};
    const response=await mod.POST(new NextRequest("http://127.0.0.1/api/upload",{method:"POST",headers:{Authorization:"Bearer "+users[role].token},body:form}),{params:Promise.resolve({id:""})});
    const value=await response.json();records.push({route:"upload",role,status:response.status,input:{name,bytes:"%PDF-1.4\\nSynthetic file\\n%%EOF"},output:value});assert.equal(response.status,200);
    return value as {url:string};
  }
  const own=await upload("a","buyer.pdf");
  const doc=await call("orders/[id]/documents","POST","a",{name:"buyer.pdf",file_url:own.url,status:"已审核",direction:"us_to_client"},firstOrder,201);
  assert.equal(doc.status,"待审核");assert.equal(doc.direction,"client_to_us");
  await call("orders/[id]/documents","POST","b",{name:"steal",file_url:own.url},firstOrder,403);
  const otherSale=await call("commerce/orders","POST","b",{request_id:"buyer-b-own-order-key",lines:[{product_id:product.id,quantity:1,revision:2}]},"",201);
  const bOrder=(otherSale.sale as Sale).lines[0].fulfillments[0].order_id;
  await call("orders/[id]/documents","POST","b",{name:"steal",file_url:own.url},bOrder,403);
  await call("orders/[id]/documents","PATCH","staff",{document_id:doc.id,status:"已审核"},firstOrder,200);
  const result=await upload("staff","delivery.pdf");
  const privateDoc=await call("orders/[id]/documents","POST","staff",{name:"PRIVATE_FILE_SENTINEL",file_url:result.url,status:"已审核",direction:"client_to_us"},firstOrder,201);
  assert(!JSON.stringify(await call("commerce/orders/[id]","GET","a",undefined,sale.id,200)).includes("PRIVATE_FILE_SENTINEL"));
  const filename=result.url.split("/").pop()!;
  await call("files/[filename]","GET","a",undefined,filename,403);
  await call("orders/[id]/documents","PATCH","staff",{document_id:privateDoc.id,direction:"us_to_client"},firstOrder,200);
  await call("files/[filename]","GET","a",undefined,filename,200);
  await call("files/[filename]","GET","b",undefined,filename,403);
  await call("orders/[id]/documents","PATCH","staff",{document_id:privateDoc.id,direction:"client_to_us"},firstOrder,200);
  await call("files/[filename]","GET","a",undefined,filename,403);
});
await test("payment admin only, transaction failure rolls back, one receipt and allocated actual income",async()=>{
  await call("commerce/orders/[id]/payment","POST","staff",{payment_reference:"BANK-001"},sale.id,403);
  await call("commerce/orders/[id]/payment","POST","a",{payment_reference:"BANK-001"},sale.id,403);
  const before=totals();
  db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON commerce_receipt_finances BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;");
  await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"BANK-001"},sale.id,500);
  db.exec("DROP TRIGGER fail_payment");assert.deepEqual(totals(),before);
  const paid=await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"BANK-001"},sale.id,200) as unknown as Sale;
  assert.equal(paid.invoice.status,"paid");
  const income=db.prepare("SELECT SUM(ROUND(f.amount*100)) cents,COUNT(*) n FROM finances f JOIN commerce_receipt_finances r ON r.finance_id=f.id WHERE r.invoice_id=?").get(sale.invoice.id) as {cents:number;n:number};
  assert.deepEqual(income,{cents:24690,n:2});
  const after=totals();await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"BANK-001"},sale.id,200);assert.deepEqual(totals(),after);
  await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"BANK-OTHER"},sale.id,409);
  const f=db.prepare("SELECT id FROM finances WHERE order_id=? AND type='income'").get(firstOrder) as {id:number};
  await call("orders/[id]/finances","PATCH","admin",{finance_id:f.id,amount:1},firstOrder,409);
  await call("orders/[id]/finances","DELETE","admin",{finance_id:f.id},firstOrder,409);
});
await test("sale transaction fault injection at steps/docs/invoice/audit leaves no orphan rows",async()=>{
  for(const table of ["order_steps","step_documents","commerce_invoices","audit_logs"]) {
    const before=totals();db.exec(`CREATE TRIGGER fail_checkout BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected checkout failure'); END;`);
    await call("commerce/orders","POST","a",{request_id:"transaction-failure-"+table,lines:[{product_id:product.id,quantity:2,revision:2}]},"",500);
    db.exec("DROP TRIGGER fail_checkout");assert.deepEqual(totals(),before);
  }
});
await test("account downgrade, disabled pilot, template ID drift and repeated additive schema remain fail-closed",async()=>{
  db.prepare("UPDATE employees SET role='client' WHERE id=?").run(users.admin.id);
  await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"FAIL"},sale.id,403);
  db.prepare("UPDATE employees SET role='admin' WHERE id=?").run(users.admin.id);
  const before=totals();ensureCommerceSchema(db);ensureCommerceSchema(db);assert.deepEqual(totals(),before);
  db.prepare("UPDATE business_types SET name='TEMP_NAME' WHERE id=1").run();
  const newType=db.prepare("INSERT INTO business_types(name) VALUES ('公司注册')").run().lastInsertRowid;
  await call("commerce/orders","POST","a",{request_id:"template-id-drift-key",lines:[{product_id:product.id,quantity:1,revision:2}]},"",409);
  db.prepare("DELETE FROM business_types WHERE id=?").run(newType);db.prepare("UPDATE business_types SET name='公司注册' WHERE id=1").run();
  assert.deepEqual(totals(),before);
  await call("employees","DELETE","admin",{id:users.a.id},"",409);
  assert(db.prepare("SELECT 1 FROM employees WHERE id=?").get(users.a.id));
  process.env.COMMERCE_PILOT_ENABLED="0";
  await call("commerce/orders","GET","a",undefined,"",404);
  await call("orders/[id]","PATCH","admin",{cancel:true,cancel_reason:"off"},firstOrder,409);
  await call("orders/[id]/finances","POST","admin",{type:"income",amount:1},firstOrder,409);
  process.env.COMMERCE_PILOT_ENABLED="1";
});
await test("legacy manual order still creates, bills cost/income, edits steps, deletes normally",async()=>{
  const legacy=await call("orders","POST","staff",{customer_name:"LEGACY FIXTURE",business_type_id:1,total_amount:100},"",201);
  await call("orders/[id]/finances","POST","staff",{type:"income",amount:100},String(legacy.id),201);
  await call("orders/[id]","PATCH","staff",{total_amount:120},String(legacy.id),200);
  await call("orders/[id]","DELETE","staff",undefined,String(legacy.id),200);
});
} finally {
  fs.writeFileSync(path.join(output,"commerce-handler-calls.json"),JSON.stringify({fixture,results,records,foreignKeyCheck:db.pragma("foreign_key_check"),integrity:db.pragma("quick_check")},null,2));
  db.close();
}
const failed=results.filter(r=>!r.passed).length;
console.log(`SUMMARY ${results.length-failed}/${results.length} groups, ${records.length} real handler calls`);
if(failed)process.exitCode=1;
