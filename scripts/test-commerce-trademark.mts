import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync, spawn } from "node:child_process";
import type Database from "better-sqlite3";
import type { CommerceProduct, CommerceSale, CommerceCart } from "../src/lib/commerce-types";

const root=process.env.INTERNAL_SOURCE_ROOT || process.cwd(),evidence=process.env.MERGE_EVIDENCE || "/tmp";
fs.mkdirSync(evidence,{recursive:true});
const fixture=process.env.COMMERCE_TEST_FIXTURE || fs.mkdtempSync("/tmp/xt-trademark-test-");
const seedMode=process.argv.includes("--seed-v2"),workerMode=process.argv.includes("--worker"),bootMode=process.argv.includes("--boot");
Object.assign(process.env,{NODE_ENV:"test",COMMERCE_PILOT_ENABLED:"1",JWT_SECRET:"local-merge-test-key",CUSTOMER_SYNC_URL:"",SYNC_SECRET:"",DB_PATH:path.join(fixture,"synthetic.db"),INTERNAL_APP_ROOT:root});
process.chdir(fixture);
const require=createRequire(path.join(root,"package.json"));
const {NextRequest}=require("next/server") as typeof import("next/server");
const bcrypt=require("bcryptjs") as typeof import("bcryptjs");
const SQLite=require("better-sqlite3") as typeof Database;
const load=(relative:string)=>import(pathToFileURL(path.join(root,relative)).href);
type Row=Record<string,unknown>;type User={id:number;token:string};let users:Record<string,User>={};
const calls:Row[]=[],groups:Row[]=[],children:Row[]=[],migrations:Row[]=[];
type Handler=(req:InstanceType<typeof NextRequest>,ctx:{params:Promise<{id:string}>})=>Promise<Response>;
async function call(route:string,method:string,role?:string,body?:unknown,status=200,id="") {
 const routeModule=await load("src/app/api/"+route+"/route.ts") as Record<string,Handler>;
 const headers:Record<string,string>={};if(role)headers.Authorization="Bearer "+users[role].token;
 if(body!==undefined)headers["Content-Type"]="application/json";
 const response=await routeModule[method](new NextRequest("http://127.0.0.1/api/"+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),{params:Promise.resolve({id})});
 const text=await response.text();calls.push({route,method,role:role||null,input:body??null,status:response.status,output:text,id});assert.equal(response.status,status,text);return JSON.parse(text);
}
async function group(name:string,fn:()=>Promise<void>) {try{await fn();groups.push({name,passed:true});console.log("PASS "+name);}catch(e){groups.push({name,passed:false,error:String(e)});console.error("FAIL "+name,e);}}
const self=fileURLToPath(import.meta.url),loader=process.env.COMMERCE_TEST_LOADER || "/Users/liuyujiang/湘泰业务网站/node_modules/tsx/dist/loader.mjs";
function environment(source:string):NodeJS.ProcessEnv {return {NODE_ENV:"test",PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:"/tmp",LANG:"en_US.UTF-8",INTERNAL_SOURCE_ROOT:source,INTERNAL_APP_ROOT:source,TSX_TSCONFIG_PATH:path.join(source,"tsconfig.json"),COMMERCE_TEST_FIXTURE:fixture,COMMERCE_TEST_LOADER:loader,MERGE_EVIDENCE:evidence};}
if(!seedMode&&!workerMode&&!bootMode){
 const base=process.env.COMMERCE_PREVIOUS_ROOT || root,env=environment(base),args=["--import",loader,self,"--seed-v2"];
 const seeded=spawnSync(process.execPath,args,{env,cwd:fixture,encoding:"utf8",timeout:90000});children.push({argv:[process.execPath,...args],cwd:fixture,env,exit_status:seeded.status,stdout:seeded.stdout,stderr:seeded.stderr});assert.equal(seeded.status,0,seeded.stderr);
 fs.copyFileSync(path.join(fixture,"synthetic.db"),path.join(fixture,"prior-v2.db"));
}
const {getDb,getOrderStepsWithDocs}=await load("src/lib/db.ts") as typeof import("../src/lib/db");
const db=getDb();
if(bootMode){console.log("BOOT_CATALOG "+JSON.stringify({expanded:(db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_products'").get() as {sql:string}).sql.includes("TRA-006"),foreign_keys:db.pragma("foreign_key_check")}));db.close();process.exit(0);}
const tables=["commerce_products","commerce_sales","commerce_lines","commerce_fulfillments","commerce_public_steps","commerce_invoices","commerce_receipt_finances","commerce_line_terms","commerce_carts","orders","order_steps","step_documents","documents","step_notes","finances","audit_logs"];
const snapshot=(d:Database.Database)=>Object.fromEntries(tables.map(t=>[t,d.prepare("SELECT rowid,* FROM "+t+" ORDER BY rowid").all()]));
if(seedMode){
 for(const [key,role] of [["admin","admin"],["staff","employee"],["a","client"],["b","client"]]){
  const id=Number(db.prepare("INSERT INTO employees(name,email,role,password,must_change_password) VALUES (?,?,?,?,0)").run(role==="client"?"SAME BUYER NAME":key,key+"@example.test",role,bcrypt.hashSync("SyntheticPass!42",4)).lastInsertRowid);
  db.prepare("INSERT INTO client_scope_settings(employee_id,mode) VALUES (?,'explicit')").run(id);
  const login=await call("auth/login","POST",undefined,{email:key+"@example.test",password:"SyntheticPass!42"});users[key]={id,token:login.token};
 }
 const product=await call("commerce/products","POST","admin",{sku:"COM-001",name:"Existing company purchase",price_cents:12345,active:true},201);
 const line={product_id:product.id,quantity:2,revision:1,terms_version:product.terms.version};
 let cart=await call("commerce/cart","PUT","a",{revision:0,lines:[line]});
 const request={request_id:"prior-company-purchase-0001",cart_revision:cart.revision,lines:cart.lines};
 let sale=(await call("commerce/orders","POST","a",request,201)).sale;
 await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"PREVIOUS-RECEIPT"},200,sale.id);
 sale=await call("commerce/orders/[id]","GET","a",undefined,200,sale.id);
 cart=await call("commerce/cart","GET","a");cart=await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[{...line,quantity:1}]});
 db.prepare("INSERT INTO documents(order_id,name,status,direction,file_url,client_author_id) VALUES (?,'old-upload.pdf','待审核','client_to_us','/api/files/old-upload.pdf',?)").run(sale.lines[0].fulfillments[0].order_id,users.a.id);
 db.exec("CREATE TABLE commerce_test_trigger_log(value TEXT); CREATE INDEX commerce_test_product_name ON commerce_products(name); CREATE TRIGGER commerce_test_price_history AFTER UPDATE OF price_cents ON commerce_products BEGIN INSERT INTO commerce_test_trigger_log(value) VALUES (NEW.id); END;");
 const oldCatalog=!((db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_products'").get() as {sql:string}).sql.includes("TRA-006"));
 if(oldCatalog)await call("commerce/products","POST","admin",{sku:"TRA-006",name:"Five items",price_cents:34567,active:true},400);
 const data={users,product,request,sale,cart,snapshot:snapshot(db),oldCatalog,calls};fs.writeFileSync(path.join(fixture,"seed.json"),JSON.stringify(data));console.log(JSON.stringify({oldCatalog,sale_id:sale.id,paid:true,cart_revision:cart.revision}));db.close();process.exit(0);
}
const seed=JSON.parse(fs.readFileSync(path.join(fixture,"seed.json"),"utf8"));users=seed.users;
if(workerMode){
 const input=JSON.parse(process.argv[process.argv.indexOf("--worker")+1]);const routeModule=await load("src/app/api/commerce/orders/route.ts") as {POST:Handler};
 const r=await routeModule.POST(new NextRequest("http://127.0.0.1/api/commerce/orders",{method:"POST",headers:{Authorization:"Bearer "+users.b.token,"Content-Type":"application/json"},body:JSON.stringify(input)}),{params:Promise.resolve({id:""})});
 console.log("TRADEMARK_WORKER "+JSON.stringify({status:r.status,body:await r.json()}));db.close();process.exit(0);
}
const {ensureCommerceSchema}=await load("src/lib/commerce-schema.ts") as typeof import("../src/lib/commerce-schema");
const products:CommerceProduct[]=[];let sale:CommerceSale;let cart:CommerceCart;let purchase:Row;
const count=(table:string)=>Number((db.prepare("SELECT count(*) n FROM "+table).get() as {n:number}).n);
function oldCopy(){const filename=path.join(fixture,"migration-"+migrations.length+".db");fs.copyFileSync(path.join(fixture,"prior-v2.db"),filename);const copy=new SQLite(filename);copy.pragma("foreign_keys=ON");return copy;}
try{
await group("upgrade keeps previous paid sale, rowids, terms, live cart, documents, receipts, indexes and triggers",async()=>{
 assert.deepEqual(snapshot(db),seed.snapshot);assert.equal(count("commerce_products"),1);assert.equal(count("commerce_test_trigger_log"),0);assert.deepEqual(db.pragma("foreign_key_check"),[]);
 assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_test_product_name'").get());assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_test_price_history'").get());
 ensureCommerceSchema(db);ensureCommerceSchema(db);assert.deepEqual(snapshot(db),seed.snapshot);
 assert.deepEqual(await call("commerce/cart","GET","a"),seed.cart);
 const replay=await call("commerce/orders","POST","a",seed.request,201);assert.equal(replay.duplicate,true);assert.equal(replay.sale.id,seed.sale.id);assert.deepEqual(replay.sale.lines[0].terms,seed.sale.lines[0].terms);
 migrations.push({case:"real-v2-upgrade",oldCatalog:seed.oldCatalog,all_old_table_values_preserved:true,foreign_keys:db.pragma("foreign_key_check")});
});
await group("upgrade mid-copy failure rolls back schema and values; retries preserve all foreign keys",async()=>{
 if(!seed.oldCatalog){migrations.push({case:"mid-copy",skipped:"baseline already extended"});return;}
 const d=oldCopy();const before=snapshot(d),schema=d.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
 const original=d.exec;let hit=false;
 d.exec=function(sql:string){if(sql.includes("INSERT INTO commerce_lines_reviewed_upgrade")){hit=true;throw new Error("INJECTED_MIDDLE_MIGRATION_FAILURE");}return original.call(this,sql);};
 assert.throws(()=>ensureCommerceSchema(d),/INJECTED_MIDDLE/);d.exec=original;assert(hit);assert.deepEqual(snapshot(d),before);assert.deepEqual(d.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),schema);
 ensureCommerceSchema(d);assert.deepEqual(snapshot(d),before);assert.deepEqual(d.pragma("foreign_key_check"),[]);assert.equal(d.pragma("foreign_keys",{simple:true}),1);migrations.push({case:"mid-copy",rollback:true,retry:true});d.close();
});
await group("unexpected columns, cascade dependencies, and occupied upgrade names are rejected without loss",async()=>{
 if(!seed.oldCatalog){migrations.push({case:"drift",skipped:"baseline already extended"});return;}
 for(const [name,sql,pattern] of [["column","ALTER TABLE commerce_products ADD COLUMN local_note TEXT DEFAULT 'KEEP'","额外改动"],["cascade","CREATE TABLE local_extension(product_id TEXT REFERENCES commerce_products(id) ON DELETE CASCADE);INSERT INTO local_extension SELECT id FROM commerce_products","级联依赖"],["occupied","CREATE TABLE commerce_products_reviewed_upgrade(keep TEXT);INSERT INTO commerce_products_reviewed_upgrade VALUES('KEEP')","临时对象"]]){
  const d=oldCopy();d.exec(sql);const before=d.serialize();assert.throws(()=>ensureCommerceSchema(d),new RegExp(pattern));assert.deepEqual(d.serialize(),before);migrations.push({case:name,unchanged:true});d.close();
 }
});
await group("four cold workers upgrade the same v2 database without lost rows or duplicate schema objects",async()=>{
 const cold=fs.mkdtempSync("/tmp/xt-trademark-cold-");fs.copyFileSync(path.join(fixture,"prior-v2.db"),path.join(cold,"synthetic.db"));
 const run=()=>new Promise<void>((resolve,reject)=>{const args=["--import",loader,self,"--boot"],env={...environment(root),COMMERCE_TEST_FIXTURE:cold};const child=spawn(process.execPath,args,{cwd:cold,env,timeout:45000});let stdout="",stderr="";child.stdout.on("data",v=>{stdout+=v;});child.stderr.on("data",v=>{stderr+=v;});child.on("error",reject);child.on("close",code=>{children.push({argv:[process.execPath,...args],env,cwd:cold,exit_status:code,stdout,stderr});try{assert.equal(code,0,stderr);const result=stdout.split("\n").find(r=>r.startsWith("BOOT_CATALOG "));assert(result,stdout);assert.deepEqual(JSON.parse(result.slice(13)),{expanded:true,foreign_keys:[]});resolve();}catch(e){reject(e);}});});
 const outcomes=await Promise.allSettled(Array.from({length:4},()=>run()));for(const outcome of outcomes)if(outcome.status==="rejected")throw outcome.reason;
 const d=new SQLite(path.join(cold,"synthetic.db"));assert.deepEqual(snapshot(d),seed.snapshot);assert.deepEqual(d.pragma("foreign_key_check"),[]);d.close();migrations.push({case:"four-cold-workers",preserved:true});
});
await group("only reviewed five trademark tiers publish; unsupported tiers/prototype keys/admin bypass rejected",async()=>{
 products.push((await call("commerce/products","GET","admin"))[0]);
 for(const sku of ["COM-002","COM-003","COM-004","TRA-001","TRA-002","TRA-003","TRA-005","TRA-006"]){
  const p=await call("commerce/products","POST","admin",{sku,name:"Synthetic "+sku,price_cents:sku==="TRA-006"?34567:23456,active:true},201);products.push(p);
 }
 for(const [sku,items] of [["TRA-001",1],["TRA-002",2],["TRA-003",3],["TRA-005",4],["TRA-006",5]]){
  const p=products.find(p=>p.sku===sku)!;assert.equal(p.terms.quantity_basis,"trademark");if(p.terms.quantity_basis!=="trademark")throw new Error("Wrong terms kind");assert.equal(p.terms.minor_items_per_copy,items);assert.equal(p.terms.major_classes_per_copy,1);assert.equal(p.terms.registration_country,"TH");
 }
 for(const sku of ["TRA-004","TRA-007","TRA-008","TRA-009","TM-VN","OTH-007","CLASS-LIST","__proto__","constructor"])await call("commerce/products","POST","admin",{sku,name:"Unreviewed",price_cents:100,active:true},400);
 const body={sku:"TRA-001",name:"Override",price_cents:1,active:true};for(const role of ["a","staff"])await call("commerce/products","POST",role,body,403);
 assert.equal((await call("commerce/products","GET","a")).length,9);
});
await group("server defines counts, country and unit: invented parameters, quantities and missing new version rejected",async()=>{
 const product=products.find(p=>p.sku==="TRA-006")!;const line={product_id:product.id,quantity:2,revision:product.revision,terms_version:product.terms.version};
 for(const extra of [{minor_items_per_copy:99},{major_classes_per_copy:20},{country:"VN"},{parent_line_id:"fake"},{unit_cents:1}])await call("commerce/quote","POST","a",{lines:[{...line,...extra}]},400);
 for(const quantity of [0,-1,1.5,11,"2"])await call("commerce/quote","POST","a",{lines:[{...line,quantity}]},400);
 await call("commerce/quote","POST","a",{lines:[{product_id:product.id,quantity:2,revision:1}]},409);
 await call("commerce/quote","POST","a",{lines:[{...line,terms_version:"company-registration-v1"}]},409);
 const current=await call("commerce/cart","GET","a");cart=await call("commerce/cart","PUT","a",{revision:current.revision,lines:[line,{product_id:products[0].id,quantity:1,revision:1,terms_version:products[0].terms.version}]});
 const q=await call("commerce/quote","POST","a",{lines:cart.lines});assert.equal(q.total_cents,81479);
});
await group("one company plus two five-item trademark applications creates three workflows and one bill, never eleven",async()=>{
 const oldOrders=count("orders"),oldInvoices=count("commerce_invoices"),oldIncome=count("finances");purchase={request_id:"mixed-trademark-purchase-0001",cart_revision:cart.revision,lines:cart.lines};
 sale=(await call("commerce/orders","POST","a",purchase,201)).sale;assert.equal(count("orders"),oldOrders+3);assert.equal(count("commerce_invoices"),oldInvoices+1);assert.equal(count("finances"),oldIncome);assert.equal(sale.invoice.status,"unpaid");assert.equal(sale.total_cents,81479);
 for(const line of sale.lines){const trademark=line.terms?.quantity_basis==="trademark";assert.equal(line.fulfillments.length,trademark?2:1);
  for(const f of line.fulfillments){const stored=db.prepare("SELECT business_type_id,sub_service_type,address_type,total_amount FROM orders WHERE id=?").get(f.order_id) as {business_type_id:number;sub_service_type:string;address_type:string;total_amount:number};
   assert.equal(stored.business_type_id,trademark?2:1);assert.equal(stored.sub_service_type,trademark?"tm-reg":"company-reg");assert.equal(stored.address_type,trademark?"":"client");assert.equal(stored.total_amount, line.unit_cents/100);
   const original=getOrderStepsWithDocs(stored.business_type_id,stored.sub_service_type,stored.address_type);
   const steps=db.prepare("SELECT id,step_name,assignee,notes FROM order_steps WHERE order_id=? ORDER BY step_order").all(f.order_id) as {id:number;step_name:string;assignee:string;notes:string}[];
   assert.equal(steps.length,trademark?8:12);assert.deepEqual(steps.map(s=>({name:s.step_name,assignee:s.assignee,notes:s.notes})),original.map(s=>({name:s.name,assignee:s.assignee,notes:s.notes||""})));
   for(const [i,step] of steps.entries()){const docs=db.prepare("SELECT document_name FROM step_documents WHERE step_id=? ORDER BY id").all(step.id) as {document_name:string}[];assert.deepEqual(docs.map(d=>d.document_name),original[i].docs);}
   const detail=await call("orders/[id]","GET","staff",undefined,200,f.order_id);assert.deepEqual(detail.commerce_purchase.terms,line.terms);
  }
 }
 assert.equal(sale.lines.flatMap(l=>l.fulfillments).reduce((n,f)=>n+f.allocated_cents,0),81479);assert.deepEqual((await call("commerce/cart","GET","a")).lines,[]);
});
await group("trademark ownership and public progress follow original buyer; old raw endpoints and income bypass stay blocked",async()=>{
 const line=sale.lines.find(l=>l.sku==="TRA-006")!,order=line.fulfillments[0].order_id;
 await call("commerce/orders/[id]","GET","b",undefined,404,sale.id);await call("orders/[id]","GET","a",undefined,404,order);
 const publicText=JSON.stringify(await call("commerce/orders/[id]","GET","a",undefined,200,sale.id));for(const privateWord of ["Ing","Fern","Pop","营业执照副本"])assert(!publicText.includes(privateWord));
 const detail=await call("orders/[id]","GET","staff",undefined,200,order);const first=detail.steps[0].id;
 await call("orders/[id]/steps","PATCH","a",{step_id:first,status:"已完成"},403,order);
 await call("orders/[id]/steps","PATCH","staff",{step_id:first,status:"已完成"},200,order);
 const updated=await call("commerce/orders/[id]","GET","a",undefined,200,sale.id);assert.equal(updated.lines.find((l:{sku:string})=>l.sku==="TRA-006").fulfillments[0].steps[0].status,"已完成");
 await call("orders/[id]/finances","POST","staff",{type:"income",amount:1,currency:"CNY",status:"paid"},409,order);
 await call("orders/[id]/finances","POST","staff",{type:"expense",amount:1,currency:"CNY",status:"paid",description:"Synthetic trademark cost"},201,order);
 await call("orders/[id]","PATCH","admin",{business_type_id:1},409,order);await call("orders/[id]","PATCH","admin",{cancel:true,cancel_reason:"test"},409,order);
});
await group("price edits retain old trademark specs and receipt allocation stays one per independent application",async()=>{
 const idx=products.findIndex(p=>p.sku==="TRA-006"),p=products[idx];products[idx]=await call("commerce/products","POST","admin",{id:p.id,sku:p.sku,name:"Future label changed",price_cents:99999,active:true,revision:p.revision},201);assert.equal(count("commerce_test_trigger_log"),1);
 const snapshotBefore=snapshot(db);const replay=await call("commerce/orders","POST","a",purchase,201);assert.equal(replay.sale.id,sale.id);assert.equal(replay.sale.total_cents,81479);assert.deepEqual(replay.sale.lines.find((l:{sku:string})=>l.sku==="TRA-006").terms,p.terms);assert.deepEqual(snapshot(db),snapshotBefore);
 await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"MIXED-RECEIPT-0001"},200,sale.id);const paid=snapshot(db);
 await call("commerce/orders/[id]/payment","POST","admin",{payment_reference:"MIXED-RECEIPT-0001"},200,sale.id);assert.deepEqual(snapshot(db),paid);
 const incomes=db.prepare("SELECT f.amount FROM commerce_receipt_finances r JOIN finances f ON f.id=r.finance_id WHERE r.invoice_id=?").all(sale.invoice.id) as {amount:number}[];assert.equal(incomes.length,3);assert.equal(incomes.reduce((n,r)=>n+Math.round(r.amount*100),0),81479);
});
await group("selected template validation is independent: wrong trademark type blocks mixed sale, not company-only",async()=>{
 const lines=[{product_id:products[0].id,quantity:1,revision:1,terms_version:products[0].terms.version},{product_id:products.find(p=>p.sku==="TRA-001")!.id,quantity:1,revision:1,terms_version:"thai-trademark-v1"}];
 db.prepare("UPDATE business_types SET name='DRIFTED TRADEMARK' WHERE id=2").run();const before=snapshot(db);
 await call("commerce/orders","POST","a",{request_id:"drift-mixed-trademark-0001",lines},409);assert.deepEqual(snapshot(db),before);
 await call("commerce/orders","POST","a",{request_id:"company-only-during-drift-0001",lines:[lines[0]]},201);
 db.prepare("UPDATE business_types SET name='商标' WHERE id=2").run();db.prepare("UPDATE business_types SET name='DRIFTED COMPANY' WHERE id=1").run();
 await call("commerce/orders","POST","a",{request_id:"trademark-only-during-drift-0001",lines:[lines[1]]},201);
 db.prepare("UPDATE business_types SET name='公司注册' WHERE id=1").run();
});
await group("late trademark step or entitlement failure rolls back earlier company line, bill, and cart together",async()=>{
 const current=await call("commerce/cart","GET","a");const trade=products.find(p=>p.sku==="TRA-006")!;
 cart=await call("commerce/cart","PUT","a",{revision:current.revision,lines:[{product_id:products[0].id,quantity:1,revision:1,terms_version:products[0].terms.version},{product_id:trade.id,quantity:2,revision:trade.revision,terms_version:trade.terms.version}]});
 for(const [name,sql] of [["steps","CREATE TRIGGER fail_trade BEFORE INSERT ON order_steps WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND business_type_id=2) BEGIN SELECT RAISE(ABORT,'TRADE STEP FAULT'); END"],["terms","CREATE TRIGGER fail_trade BEFORE INSERT ON commerce_line_terms WHEN json_extract(NEW.terms_json,'$.quantity_basis')='trademark' BEGIN SELECT RAISE(ABORT,'TRADE TERMS FAULT'); END"]]){
  const before=snapshot(db);db.exec(sql);await call("commerce/orders","POST","a",{request_id:"mixed-fault-"+name+"-0001",cart_revision:cart.revision,lines:cart.lines},500);db.exec("DROP TRIGGER fail_trade");assert.deepEqual(snapshot(db),before);
 }
});
await group("nine distinct reviewed products quote correctly; duplicate, excess and unknown selections remain rejected",async()=>{
 const lines=products.map(p=>({product_id:p.id,quantity:1,revision:p.revision,terms_version:p.terms.version}));
 const q=await call("commerce/quote","POST","a",{lines});assert.equal(q.lines.length,9);assert.equal(q.total_cents,products.reduce((n,p)=>n+p.price_cents,0));
 await call("commerce/quote","POST","a",{lines:[...lines,lines[0]]},400);await call("commerce/quote","POST","a",{lines:[lines[0],lines[0]]},400);
 await call("commerce/cart","PUT","a",{revision:cart.revision,lines:[{...lines[0],product_id:"unreviewed-unknown"}]},400);
});
await group("two independent processes consuming one trademark cart produce only one sale",async()=>{
 const trade=products.find(p=>p.sku==="TRA-006")!;const b=await call("commerce/cart","PUT","b",{revision:0,lines:[{product_id:trade.id,quantity:2,revision:trade.revision,terms_version:trade.terms.version}]});const before=count("commerce_sales");
 const run=(key:string)=>new Promise<{status:number;body:Row}>((resolve,reject)=>{const input={request_id:key,cart_revision:b.revision,lines:b.lines},args=["--import",loader,self,"--worker",JSON.stringify(input)],env=environment(root);const child=spawn(process.execPath,args,{cwd:fixture,env,timeout:45000});let stdout="",stderr="";child.stdout.on("data",v=>{stdout+=v;});child.stderr.on("data",v=>{stderr+=v;});child.on("error",reject);child.on("close",code=>{children.push({argv:[process.execPath,...args],cwd:fixture,env,exit_status:code,stdout,stderr});try{assert.equal(code,0,stderr);const row=stdout.split("\n").find(x=>x.startsWith("TRADEMARK_WORKER "));assert(row,stdout);resolve(JSON.parse(row.slice(17)));}catch(e){reject(e);}});});
 const outcomes=(await Promise.allSettled([run("parallel-trademark-cart-0001"),run("parallel-trademark-cart-0002")])).map(r=>{if(r.status==="rejected")throw r.reason;return r.value;});assert.deepEqual(outcomes.map(o=>o.status).sort(),[201,409]);assert.equal(count("commerce_sales"),before+1);assert.deepEqual((await call("commerce/cart","GET","b")).lines,[]);
});
await group("closed pilot hides new catalog/actions; old flows and recorded mixed-scope staff details remain",async()=>{
 process.env.COMMERCE_PILOT_ENABLED="0";await call("commerce/products","GET","a",undefined,404);await call("commerce/orders","POST","a",purchase,404);await call("commerce/cart","GET","a",undefined,404);
 const f=sale.lines.find(l=>l.sku==="TRA-006")!.fulfillments[0];const detail=await call("orders/[id]","GET","staff",undefined,200,f.order_id);assert.equal(detail.commerce_purchase.terms.minor_items_per_copy,5);
 process.env.COMMERCE_PILOT_ENABLED="1";ensureCommerceSchema(db);assert.deepEqual(db.pragma("foreign_key_check"),[]);for(const table of ["sync_inbox","sync_orders","sync_progress_outbox"])assert.equal(count(table),0);
});
}finally{fs.writeFileSync(path.join(evidence,"commerce-trademark-calls.json"),JSON.stringify({root,fixture,baseline:process.env.COMMERCE_PREVIOUS_ROOT||null,old_catalog_exercised:seed.oldCatalog,groups,calls,children,migrations,foreign_keys:db.pragma("foreign_key_check")},null,2));db.close();}
console.log(`SUMMARY ${groups.filter(g=>g.passed).length}/${groups.length} groups, ${calls.length} handler calls, ${migrations.length} migration checks`);if(groups.some(g=>!g.passed))process.exitCode=1;
