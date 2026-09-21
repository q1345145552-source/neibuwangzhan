import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import type { CommerceProduct, CommerceSale, CommerceCart } from "../src/lib/commerce-types";

const root=process.env.INTERNAL_SOURCE_ROOT || process.cwd();
const evidence=process.env.MERGE_EVIDENCE || "/tmp";
fs.mkdirSync(evidence,{recursive:true});
const seedMode=process.argv.includes("--seed-v1");
const workerMode=process.argv.includes("--worker");
const fixture=process.env.COMMERCE_TEST_FIXTURE || fs.mkdtempSync("/tmp/xt-cart-terms-");
Object.assign(process.env,{NODE_ENV:"test",COMMERCE_PILOT_ENABLED:"1",JWT_SECRET:"local-merge-test-key",CUSTOMER_SYNC_URL:"",SYNC_SECRET:"",DB_PATH:path.join(fixture,"synthetic.db"),INTERNAL_APP_ROOT:root});
process.chdir(fixture);
const load=(relative:string)=>import(pathToFileURL(path.join(root,relative)).href);
const require=createRequire(path.join(root,"package.json"));
const {NextRequest}=require("next/server") as typeof import("next/server");
const bcrypt=require("bcryptjs") as typeof import("bcryptjs");
type Row=Record<string,unknown>;
type User={id:number;token:string};
const calls:Row[]=[];const results:Row[]=[];const children:Row[]=[];
let users:Record<string,User>={};
type Handler=(req:InstanceType<typeof NextRequest>,ctx:{params:Promise<{id:string}>})=>Promise<Response>;
async function call(route:string,method:string,role?:string,body?:unknown,status=200,id="") {
  const routeModule=await load("src/app/api/"+route+"/route.ts") as Record<string,Handler>;
  const headers:Record<string,string>={}; if(role)headers.Authorization="Bearer "+users[role].token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await routeModule[method](new NextRequest("http://127.0.0.1/api/"+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({id})});
  const text=await response.text(); calls.push({route,method,role:role||null,body:body??null,status:response.status,output:text,id});
  assert.equal(response.status,status,text);
  return JSON.parse(text);
}
async function group(name:string,fn:()=>Promise<void>) {
  try {await fn();results.push({name,passed:true});console.log("PASS "+name);}
  catch(e){results.push({name,passed:false,error:String(e)});console.error("FAIL "+name,e);}
}
const self=fileURLToPath(import.meta.url);
const loader=process.env.COMMERCE_TEST_LOADER || "/Users/liuyujiang/湘泰业务网站/node_modules/tsx/dist/loader.mjs";
function childEnv(childRoot:string):NodeJS.ProcessEnv {
  return {PATH:process.env.PATH,HOME:process.env.HOME,LANG:"en_US.UTF-8",TMPDIR:"/tmp",NODE_ENV:"test",INTERNAL_SOURCE_ROOT:childRoot,INTERNAL_APP_ROOT:childRoot,TSX_TSCONFIG_PATH:path.join(childRoot,"tsconfig.json"),COMMERCE_TEST_FIXTURE:fixture,COMMERCE_TEST_LOADER:loader,MERGE_EVIDENCE:evidence};
}
const tables=["commerce_products","commerce_sales","commerce_lines","commerce_fulfillments","commerce_public_steps","commerce_invoices","commerce_receipt_finances","orders","order_steps","step_documents","finances"];
if(!seedMode&&!workerMode) {
  const base=process.env.COMMERCE_BASELINE_ROOT || root;
  const args=["--import",loader,self,"--seed-v1"],env=childEnv(base);
  const seeded=spawnSync(process.execPath,args,{cwd:fixture,env,encoding:"utf8",timeout:60000});
  children.push({command:[process.execPath,...args],cwd:fixture,env,status:seeded.status,stdout:seeded.stdout,stderr:seeded.stderr});
  assert.equal(seeded.status,0,seeded.stderr);
}
const {getDb}=await load("src/lib/db.ts") as typeof import("../src/lib/db");
const db=getDb();
const snapshot=()=>Object.fromEntries(tables.map(t=>[t,db.prepare("SELECT * FROM "+t+" ORDER BY rowid").all()]));
if(seedMode) {
  for(const [role,kind] of [["admin","admin"],["staff","employee"],["a","client"],["b","client"]]){
    const id=Number(db.prepare("INSERT INTO employees(name,email,role,password,must_change_password) VALUES (?,?,?,?,0)").run(kind==="client"?"SAME NAME":role,role+"@example.test",kind,bcrypt.hashSync("SyntheticPass!42",4)).lastInsertRowid);
    db.prepare("INSERT INTO client_scope_settings(employee_id,mode) VALUES (?,'explicit')").run(id);
    const data=await call("auth/login","POST",undefined,{email:role+"@example.test",password:"SyntheticPass!42"});users[role]={id,token:data.token};
  }
  const product=await call("commerce/products","POST","admin",{sku:"COM-001",name:"Original name",price_cents:12345,active:true},201);
  const request={request_id:"original-first-slice-0001",lines:[{product_id:product.id,quantity:1,revision:product.revision}]};
  const purchase=await call("commerce/orders","POST","a",request,201);
  const data={users,product,request,sale:purchase.sale,snapshot:snapshot(),legacy:!fs.existsSync(path.join(root,"src/app/api/commerce/cart/route.ts")),calls};
  fs.writeFileSync(path.join(fixture,"seed.json"),JSON.stringify(data));
  console.log(JSON.stringify({baseline:root,cart_route_exists:!data.legacy,terms_present:"terms" in purchase.sale.lines[0],sale_id:purchase.sale.id}));db.close();process.exit(0);
}
const seed=JSON.parse(fs.readFileSync(path.join(fixture,"seed.json"),"utf8"));users=seed.users;
if(workerMode) {
  const input=JSON.parse(process.argv[process.argv.indexOf("--worker")+1]);
  const routeModule=await load("src/app/api/commerce/orders/route.ts") as {POST:Handler};
  const r=await routeModule.POST(new NextRequest("http://127.0.0.1/api/commerce/orders",{method:"POST",headers:{Authorization:"Bearer "+users.b.token,"Content-Type":"application/json"},body:JSON.stringify(input)}),{params:Promise.resolve({id:""})});
  console.log("WORKER_RESULT "+JSON.stringify({status:r.status,body:await r.json()}));db.close();process.exit(0);
}
const {ensureCommerceSchema}=await load("src/lib/commerce-schema.ts") as typeof import("../src/lib/commerce-schema");
const products:CommerceProduct[]=[];let cart:CommerceCart;let sale:CommerceSale;
const count=(t:string)=>Number((db.prepare("SELECT count(*) n FROM "+t).get() as {n:number}).n);
const state=()=>({snapshot:snapshot(),terms:db.prepare("SELECT * FROM commerce_line_terms ORDER BY rowid").all(),carts:db.prepare("SELECT * FROM commerce_carts ORDER BY rowid").all(),audit:count("audit_logs")});
try {
await group("additive upgrade preserves every old sale/line/bill/workflow byte; no inferred old terms",async()=>{
  assert.deepEqual(snapshot(),seed.snapshot);
  ensureCommerceSchema(db);ensureCommerceSchema(db);assert.deepEqual(snapshot(),seed.snapshot);
  assert.deepEqual(db.pragma("foreign_key_check"),[]);assert.equal(count("commerce_carts"),0);
  if(seed.legacy)assert.equal(count("commerce_line_terms"),0);
  const old=await call("commerce/orders/[id]","GET","a",undefined,200,seed.sale.id);
  if(seed.legacy)assert.equal(old.lines[0].terms,null);
  const replay=await call("commerce/orders","POST","a",seed.request,201);assert.equal(replay.sale.id,seed.sale.id);assert.equal(replay.duplicate,true);
  const detail=await call("orders/[id]","GET","staff",undefined,200,seed.sale.lines[0].fulfillments[0].order_id);
  if(seed.legacy)assert.equal(detail.commerce_purchase.terms,null);
});
await group("cart is private to current account; no auth, employee, administrator, buyer spoof rejected",async()=>{
  await call("commerce/cart","GET",undefined,undefined,401);for(const role of ["staff","admin"])await call("commerce/cart","GET",role,undefined,403);
  cart=await call("commerce/cart","GET","a");assert.deepEqual(cart,{revision:0,lines:[]});assert.equal(count("commerce_carts"),0);
  await call("commerce/cart","PUT","a",{revision:0,lines:[],buyer_account_id:users.b.id},400);
  for(const revision of [-1,"0",0.5,null,1_000_000_000])await call("commerce/cart","PUT","a",{revision,lines:[]},400);
});
await group("known company scope only: all four SKU rights explicit; addons/measured/unknown stay unopened",async()=>{
  products.push((await call("commerce/products","GET","admin")).find((p:CommerceProduct)=>p.sku==="COM-001"));
  for(const sku of ["COM-002","COM-003","COM-004"])products.push(await call("commerce/products","POST","admin",{sku,name:"Synthetic "+sku,price_cents:23456,active:true},201));
  for(const p of products){assert.equal(p.terms.quantity_basis,"company");if(p.terms.quantity_basis!=="company")throw new Error("Expected company fixture");assert.equal(p.terms.company_structure,["COM-001","COM-002"].includes(p.sku)?"foreign":"joint");assert.equal(p.terms.vat_registration,["COM-002","COM-004"].includes(p.sku)?"included":"excluded");assert.equal(p.terms.other_services,"not_specified");}
  for(const sku of ["OTH-007","OTH-008","VISA-002","TAX-005","UNKNOWN-001"])await call("commerce/products","POST","admin",{sku,name:"Unreviewed",price_cents:100,active:true},400);
});
await group("quantity validation distinguishes companies from invented meters or attached fees",async()=>{
  const line={product_id:products[0].id,quantity:2,revision:1,terms_version:products[0].terms.version};
  for(const quantity of [0,-1,1.1,11,"2",null])await call("commerce/cart","PUT","a",{revision:0,lines:[{...line,quantity}]},400);
  for(const bad of [{...line,units:50},{...line,parent_line_id:"x"},{...line,vat_registration:"included"}])await call("commerce/cart","PUT","a",{revision:0,lines:[bad]},400);
  await call("commerce/cart","PUT","a",{revision:0,lines:[line,line]},400);
  await call("commerce/cart","PUT","a",{revision:0,lines:[{...line,product_id:"unknown"}]},400);
  cart=await call("commerce/cart","PUT","a",{revision:0,lines:[line,{product_id:products[1].id,quantity:1,revision:1,terms_version:products[1].terms.version}]});
  assert.equal(cart.revision,1);assert.equal(cart.lines.length,2);
});
await group("cross-device persisted cart and optimistic conflict preserve the winning edits",async()=>{
  assert.deepEqual(await call("commerce/cart","GET","a"),cart);assert.deepEqual(await call("commerce/cart","GET","b"),{revision:0,lines:[]});
  const saved=structuredClone(cart);
  await call("commerce/cart","PUT","a",{revision:0,lines:[]},409);assert.deepEqual(await call("commerce/cart","GET","a"),saved);
  cart=await call("commerce/cart","PUT","a",cart);assert.equal(cart.revision,2);
  await call("commerce/cart","PUT","a",saved,409);assert.deepEqual(await call("commerce/cart","GET","a"),cart);
});
await group("stale terms and cart mismatch fail before writing sale; snapshots are server supplied",async()=>{
  const before=state();
  await call("commerce/quote","POST","a",{lines:cart.lines.map(l=>({...l,terms_version:"future-v999"}))},409);
  await call("commerce/orders","POST","a",{request_id:"cart-mismatch-00001",cart_revision:0,lines:cart.lines},409);
  await call("commerce/orders","POST","a",{request_id:"cart-mismatch-00002",cart_revision:cart.revision,lines:[cart.lines[0]]},409);
  await call("commerce/orders","POST","a",{request_id:"cart-mismatch-00003",cart_revision:cart.revision,lines:cart.lines,terms:{vat_registration:"included"}},400);
  assert.deepEqual(state(),before);
});
let purchase:Row;
await group("two company services, three companies, one invoice; VAT belongs to copy, not extra bill",async()=>{
  const q=await call("commerce/quote","POST","a",{lines:cart.lines});assert.equal(q.total_cents,48146);
  purchase={request_id:"cart-success-00000001",cart_revision:cart.revision,lines:cart.lines};
  const oldSales=count("commerce_sales"),oldInvoices=count("commerce_invoices"),oldOrders=count("orders");
  const result=await call("commerce/orders","POST","a",purchase,201);sale=result.sale;
  assert.equal(count("commerce_sales"),oldSales+1);assert.equal(count("commerce_invoices"),oldInvoices+1);assert.equal(count("orders"),oldOrders+3);assert.equal(count("finances"),0);
  assert.equal(sale.total_cents,48146);assert.equal(sale.invoice.status,"unpaid");assert.equal(sale.lines.flatMap(l=>l.fulfillments).length,3);
  for(const line of sale.lines){assert.deepEqual(line.terms,products.find(p=>p.sku===line.sku)?.terms);for(const f of line.fulfillments){assert.equal(f.steps.length,12);const details=await call("orders/[id]","GET","staff",undefined,200,f.order_id);assert.deepEqual(details.commerce_purchase.terms,line.terms);assert.equal(details.commerce_purchase.copy_no,f.copy_no);}}
  const consumed=await call("commerce/cart","GET","a");assert.equal(consumed.revision,cart.revision+1);assert.deepEqual(consumed.lines,[]);cart=consumed;
});
await group("lost checkout response replay survives changed price, consumed cart, and later new selection",async()=>{
  const p=products[0];products[0]=await call("commerce/products","POST","admin",{id:p.id,sku:p.sku,name:"New future name",price_cents:54321,active:true,revision:p.revision},201);
  cart=await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[{product_id:products[0].id,quantity:1,revision:products[0].revision,terms_version:products[0].terms.version}]});
  const before=state();for(let i=0;i<4;i++){const replay=await call("commerce/orders","POST","a",purchase,201);assert.equal(replay.duplicate,true);assert.deepEqual(replay.sale,sale);}
  assert.deepEqual(state(),before);assert.deepEqual(await call("commerce/cart","GET","a"),cart);
  await call("commerce/orders","POST","a",{...purchase,request_id:"second-tab-fresh-key-0001"},409);
  await call("commerce/orders","POST","a",{...purchase,cart_revision:cart.revision},409);assert.deepEqual(state(),before);
  const old=await call("commerce/orders","POST","a",seed.request,201);assert.equal(old.sale.id,seed.sale.id);if(seed.legacy)assert.equal(old.sale.lines[0].terms,null);
});
await group("faults at entitlement insert, cart consume, invoice, and audit roll back entire aggregate",async()=>{
  for(const [name,timing,table] of [["terms","INSERT","commerce_line_terms"],["cart","UPDATE","commerce_carts"],["invoice","INSERT","commerce_invoices"],["audit","INSERT","audit_logs"]]){
    const before=state();db.exec(`CREATE TRIGGER fault_${name} BEFORE ${timing} ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic cart fault'); END`);
    await call("commerce/orders","POST","a",{request_id:"fault-cart-"+name+"-00000001",cart_revision:cart.revision,lines:cart.lines},500);
    db.exec(`DROP TRIGGER fault_${name}`);assert.deepEqual(state(),before);
  }
});
await group("payment is still once, sums to invoice; cart and explicit rights do not create recurring rows",async()=>{
  await call("commerce/orders/[id]/payment","POST","staff",{payment_reference:"TERM-PAY-0001"},403,sale.id);
  await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"TERM-PAY-0001"},200,sale.id);
  const paid=state();await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"TERM-PAY-0001"},200,sale.id);assert.deepEqual(state(),paid);
  const cents=db.prepare("SELECT amount FROM finances WHERE type='income'").all() as {amount:number}[];assert.equal(cents.reduce((n,r)=>n+Math.round(r.amount*100),0),sale.total_cents);assert.equal(cents.length,3);
  for(const table of ["sync_inbox","sync_orders","sync_progress_outbox"])assert.equal(count(table),0);
});
await group("two independent processes submit same persisted cart: exactly one wins",async()=>{
  const b=await call("commerce/cart","PUT","b",{revision:0,lines:[{product_id:products[1].id,quantity:1,revision:products[1].revision}]});
  const before=count("commerce_sales");
  const run=(key:string)=>new Promise<{status:number;body:Row}>((resolve,reject)=>{
    const input={request_id:key,cart_revision:b.revision,lines:b.lines},args=["--import",loader,self,"--worker",JSON.stringify(input)],env=childEnv(root);
    const child=spawn(process.execPath,args,{cwd:fixture,env,timeout:45000});let stdout="",stderr="";
    child.stdout.on("data",v=>{stdout+=v;});child.stderr.on("data",v=>{stderr+=v;});child.on("error",reject);
    child.on("close",code=>{children.push({command:[process.execPath,...args],env,cwd:fixture,status:code,stdout,stderr});try{assert.equal(code,0,stderr);const row=stdout.split("\n").find(x=>x.startsWith("WORKER_RESULT "));assert(row,stdout);resolve(JSON.parse(row.slice(14)));}catch(e){reject(e);}});
  });
  const settled=await Promise.allSettled([run("process-cart-order-00001"),run("process-cart-order-00002")]);
  const outcomes=settled.map(r=>{if(r.status==="rejected")throw r.reason;return r.value;});assert.deepEqual(outcomes.map(x=>x.status).sort(),[201,409]);assert.equal(count("commerce_sales"),before+1);
  assert.deepEqual((await call("commerce/cart","GET","b")).lines,[]);assert.deepEqual(db.pragma("foreign_key_check"),[]);
});
await group("delisted and stale-price selections stay removable; no silent repricing or blank cart reset",async()=>{
  const p=products[0];products[0]=await call("commerce/products","POST","admin",{id:p.id,sku:p.sku,name:p.name,price_cents:p.price_cents,revision:p.revision,active:false},201);
  assert.deepEqual(await call("commerce/cart","GET","a"),cart);await call("commerce/quote","POST","a",{lines:cart.lines},409);
  cart=await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[]});assert.deepEqual(cart.lines,[]);
  const fake=await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[{product_id:products[1].id,quantity:1,revision:1,terms_version:"future-terms"}]});
  await call("commerce/quote","POST","a",{lines:fake.lines},409);
  cart=await call("commerce/cart","PUT","a",{revision:fake.revision,lines:[]});
});
await group("deleting an unpurchased account removes only its cart; historical buyers remain protected",async()=>{
  const id=Number(db.prepare("INSERT INTO employees(name,email,role,password,must_change_password) VALUES ('SAME NAME','discard@example.test','client',?,0)").run(bcrypt.hashSync("SyntheticPass!42",4)).lastInsertRowid);
  db.prepare("INSERT INTO client_scope_settings(employee_id,mode) VALUES (?,'explicit')").run(id);
  const login=await call("auth/login","POST",undefined,{email:"discard@example.test",password:"SyntheticPass!42"});users.discard={id,token:login.token};
  await call("commerce/cart","PUT","discard",{revision:0,lines:[{product_id:products[1].id,quantity:1,revision:1}]});
  await call("employees","DELETE","staff",{id},403);
  await call("employees","DELETE","admin",{id});assert.equal(db.prepare("SELECT 1 FROM commerce_carts WHERE buyer_account_id=?").get(id),undefined);
  await call("commerce/cart","GET","discard",undefined,401);
  await call("employees","DELETE","admin",{id:users.a.id},409);assert.deepEqual(await call("commerce/cart","GET","a"),cart);
});
await group("gate off blocks carts but recorded staff rights remain; no current-name identity fallback",async()=>{
  db.prepare("UPDATE employees SET name='Renamed buyer' WHERE id=?").run(users.a.id);
  assert.equal((await call("commerce/orders/[id]","GET","a",undefined,200,sale.id)).id,sale.id);
  await call("commerce/orders/[id]","GET","b",undefined,404,sale.id);
  process.env.COMMERCE_PILOT_ENABLED="0";await call("commerce/cart","GET","a",undefined,404);await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[]},404);
  const details=await call("orders/[id]","GET","staff",undefined,200,sale.lines[0].fulfillments[0].order_id);assert.deepEqual(details.commerce_purchase.terms,sale.lines[0].terms);
  process.env.COMMERCE_PILOT_ENABLED="1";ensureCommerceSchema(db);assert.deepEqual(await call("commerce/cart","GET","a"),cart);
});
} finally {
  const record={fixture,root,baseline:process.env.COMMERCE_BASELINE_ROOT||null,legacy_upgrade_exercised:seed.legacy,results,calls,children,final_foreign_key_check:db.pragma("foreign_key_check")};
  fs.writeFileSync(path.join(evidence,"commerce-cart-calls.json"),JSON.stringify(record,null,2));db.close();
}
console.log(`SUMMARY ${results.filter(r=>r.passed).length}/${results.length} groups, ${calls.length} real handler calls; ${children.length} child process records`);
if(results.some(r=>!r.passed))process.exitCode=1;
