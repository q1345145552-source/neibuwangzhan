#!/usr/bin/env node
// Synthetic migration and actual API regression. No production data or network is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..'),fixture=fs.mkdtempSync('/tmp/xt-shopee-aftercare-');
Object.assign(process.env,{DB_PATH:path.join(fixture,'fixture.db'),INTERNAL_APP_ROOT:fixture,NODE_ENV:'test',ALLOW_EMPTY_DB:'1',JWT_SECRET:'shopee-aftercare-fixture-only'});
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const resolve=Module._resolveFilename;Module._resolveFilename=function(id,...args){return resolve.call(this,id.startsWith('@/')?path.join(root,'src',id.slice(2)):id,...args)};
global.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const {ensureShopeeAftercareSchema:migrate}=require('../src/lib/shopee-aftercare-schema.ts');
function legacy(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`
 CREATE TABLE shopee_orders(id INTEGER PRIMARY KEY,customer_name TEXT);INSERT INTO shopee_orders VALUES(1,'原客户');
 CREATE TABLE shopee_stores(id INTEGER PRIMARY KEY AUTOINCREMENT,store_name TEXT,status TEXT NOT NULL DEFAULT '可售' CHECK(status IN ('可售','等待扫描','被封')),sold TEXT DEFAULT '未出售',ban_reason TEXT,extra_future_column TEXT);
 CREATE INDEX idx_stores_test ON shopee_stores(status);CREATE TABLE migration_audit(content TEXT);
 CREATE TRIGGER store_update_test AFTER UPDATE ON shopee_stores BEGIN INSERT INTO migration_audit VALUES(NEW.store_name);END;
 CREATE TABLE shopee_order_items(id INTEGER PRIMARY KEY,store_id INTEGER REFERENCES shopee_stores(id) ON DELETE CASCADE,order_id INTEGER REFERENCES shopee_orders(id));
 INSERT INTO shopee_stores(store_name,status,sold,ban_reason,extra_future_column) VALUES('旧可售','可售','未出售','','保留1'),('旧等待','等待扫描','未出售','','保留2'),('旧被封','被封','已出售','原封禁原因','保留3');
 INSERT INTO shopee_order_items VALUES(1,1,1);INSERT INTO shopee_stores(id,store_name) VALUES(99,'已删');DELETE FROM shopee_stores WHERE id=99;
 `);return db;}
let groups=0;
function test(name,fn){fn();groups++;console.log('PASS '+name)}
test('Old migration preserves every row/column, incoming cascade FK, indexes/triggers and sequence',()=>{const db=legacy(),before=db.prepare('SELECT * FROM shopee_stores ORDER BY id').all();migrate(db);const after=db.prepare('SELECT * FROM shopee_stores ORDER BY id').all();for(let i=0;i<3;i++){assert.equal(after[i].aftercare_order_id,null);delete after[i].aftercare_order_id;assert.deepEqual(after[i],before[i]);}assert.equal(db.prepare('SELECT COUNT(*) n FROM shopee_order_items').get().n,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.prepare('SELECT COUNT(*) n FROM migration_audit').get().n,0);db.prepare("UPDATE shopee_stores SET status='售后',sold='已出售',aftercare_order_id=1 WHERE id=1").run();assert.equal(db.prepare('SELECT COUNT(*) n FROM migration_audit').get().n,1);assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_stores_test'").get());assert.equal(Number(db.prepare("INSERT INTO shopee_stores(store_name) VALUES('新增')").run().lastInsertRowid),100);assert.throws(()=>db.prepare('DELETE FROM shopee_orders WHERE id=1').run(),/FOREIGN KEY/);const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='shopee_stores'").get().sql;migrate(db);assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='shopee_stores'").get().sql,schema);db.close();});
test('Migration failure rolls back column/table edits and restores FK enforcement',()=>{const db=legacy();db.exec('CREATE TABLE shopee_stores_aftercare_upgrade(x)');assert.throws(()=>migrate(db),/临时表/);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.prepare('PRAGMA table_info(shopee_stores)').all().some(c=>c.name==='aftercare_order_id'),false);assert.equal(db.prepare('SELECT COUNT(*) n FROM shopee_stores').get().n,3);assert.equal(db.prepare('SELECT COUNT(*) n FROM shopee_order_items').get().n,1);assert.deepEqual(db.pragma('foreign_key_check'),[]);db.close();});
(async()=>{
 const db=require('../src/lib/db.ts').getDb(),{signToken}=require('../src/lib/auth.ts'),{NextRequest}=require('next/server');
 const stores=require('../src/app/api/shopee-stores/route.ts'),orders=require('../src/app/api/shopee-orders/route.ts'),items=require('../src/app/api/shopee-order-items/route.ts');
 const users={};for(const role of ['admin','employee','client']){const u=db.prepare('SELECT * FROM employees WHERE role=? LIMIT 1').get(role);db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(u.id);users[role]=await signToken({...u,must_change_password:0});}
 async function call(route,method,role,body,query=''){const response=await route[method](new NextRequest('http://fixture.test/api/test'+query,{method,headers:role?{Authorization:'Bearer '+users[role],'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined}));return {status:response.status,data:await response.json()};}
 const order=await call(orders,'POST','employee',{customer_name:'售后客户甲',order_date:'2026-10-17',store_qty:2});assert.equal(order.status,201);const orderId=order.data.id;
 for(const role of ['admin','employee']){assert.equal((await call(stores,'POST',role,{store_name:'缺订单',status:'售后'})).status,400);for(const value of [null,'',false,[],{},-1,1.5,'手填单号',999999])assert.equal((await call(stores,'POST',role,{store_name:'无效关联',status:'售后',aftercare_order_id:value})).status,400);}
 assert.equal((await call(stores,'GET',null)).status,401);assert.equal((await call(stores,'POST','client',{store_name:'越权'})).status,403);
 const created=await call(stores,'POST','employee',{store_name:'售后店铺',status:'售后',sold:'未出售',aftercare_order_id:orderId});assert.equal(created.status,201);assert.equal(created.data.sold,'已出售');assert.equal(created.data.aftercare_order_id,orderId);const id=created.data.id;
 let patched=await call(stores,'PATCH','employee',{id,sold:'未出售'});assert.equal(patched.status,200);assert.equal(patched.data.sold,'已出售');assert.equal(patched.data.aftercare_order_id,orderId);
 assert.equal((await call(stores,'PATCH','employee',{id,aftercare_order_id:null})).status,400);assert.equal((await call(stores,'PATCH','employee',{id,aftercare_order_id:999999})).status,400);
 const listing=(await call(stores,'GET','employee')).data.find(s=>s.id===id);assert.equal(listing.aftercare_customer_name,'售后客户甲');assert.equal(listing.aftercare_order_date,'2026-10-17');assert.equal((await call(orders,'DELETE','employee',null,'?id='+orderId)).status,409);
 assert.equal((await call(stores,'PATCH','employee',{id,status:'被封'})).status,400);patched=await call(stores,'PATCH','employee',{id,status:'被封',ban_reason:'原规则仍需原因'});assert.equal(patched.status,200);assert.equal(patched.data.ban_reason,'原规则仍需原因');assert.equal(patched.data.aftercare_order_id,null);
 patched=await call(stores,'PATCH','employee',{id,status:'等待扫描'});assert.equal(patched.data.status,'等待扫描');assert.equal(patched.data.ban_reason,'');
 patched=await call(stores,'PATCH','employee',{id,status:'售后',sold:'未出售',aftercare_order_id:String(orderId)});assert.equal(patched.status,200);assert.equal(patched.data.sold,'已出售');
 patched=await call(stores,'PATCH','employee',{id,status:'可售',sold:'未出售'});assert.equal(patched.data.aftercare_order_id,null);assert.equal(patched.data.sold,'未出售');
 assert.equal((await call(stores,'POST','employee',{store_name:'外购缺必填',source:'外购',status:'售后',aftercare_order_id:orderId})).status,400);
 assert.equal((await call(stores,'POST','employee',{store_name:'异常状态',status:'其他'})).status,400);
 groups++;console.log('PASS actual API: all roles, required/existing order selection, force sold on create/partial edit, joined labels, original ban/purchase/state rules');
 // Existing order-item flows still update ledger normally, clearing only the newly added association field.
 const item=await call(items,'POST','employee',{order_id:orderId,store_id:id});assert.equal(item.status,201);await call(stores,'PATCH','employee',{id,status:'售后',aftercare_order_id:orderId});
 let ban=await call(items,'PATCH','employee',{id:item.data.id,ban_status:'可以处理',ban_reason:'订单封禁原因'});assert.equal(ban.status,200);let row=db.prepare('SELECT * FROM shopee_stores WHERE id=?').get(id);assert.equal(row.status,'被封');assert.equal(row.aftercare_order_id,null);assert.equal(row.ban_reason,'订单封禁原因');
 await call(stores,'PATCH','employee',{id,status:'售后',aftercare_order_id:orderId});assert.equal((await call(items,'DELETE','employee',null,'?id='+item.data.id)).status,200);row=db.prepare('SELECT * FROM shopee_stores WHERE id=?').get(id);assert.equal(row.status,'可售');assert.equal(row.sold,'未出售');assert.equal(row.aftercare_order_id,null);assert.equal(row.ban_reason,'');
 assert.equal((await call(orders,'DELETE','employee',null,'?id='+orderId)).status,200);groups++;console.log('PASS original order-item ban/remove flows and safe deletion after ledger association cleared');
 assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.equal(db.pragma('quick_check',{simple:true}),'ok');db.close();console.log(`SHOPEE AFTERCARE: ${groups} groups passed; isolated fixture ${fixture}`);
})().catch(e=>{console.error(e);process.exitCode=1});
