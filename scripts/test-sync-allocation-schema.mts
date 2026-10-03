import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { allocateCents, splitCents, moneyToCents } from '../src/lib/sync-money';
import { initializeSyncSchema } from '../src/lib/sync-schema';

let state = 0x5eeda11;
function random(max: number) { state = (Math.imul(1664525,state) + 1013904223) >>> 0; return state % max; }
let cases = 0;
for(let iteration=0; iteration<20000; iteration++) {
  const weights = Array.from({length:1+random(20)}, () => random(1_000_000_000));
  const total = random(1_000_000_000_000);
  const lines = allocateCents(total,weights);
  assert.equal(lines.reduce((a,b)=>a+b,0),total);
  assert(lines.every(x=>Number.isSafeInteger(x) && x>=0));
  for(let i=0;i<lines.length;i++) {
    const parts = splitCents(lines[i],1+random(999));
    assert.equal(parts.reduce((a,b)=>a+b,0),lines[i]);
    assert(Math.max(...parts)-Math.min(...parts)<=1);
    assert(parts.every(x=>Number.isSafeInteger(x)&&x>=0));
    cases++;
  }
}
assert.deepEqual(allocateCents(0,[0,0]),[0,0]);
assert.throws(()=>allocateCents(1,[0,0]));
assert.deepEqual(allocateCents(29800,[10000,10000,10000]),[9934,9933,9933]);
assert.deepEqual(splitCents(5,10),[1,1,1,1,1,0,0,0,0,0]);
assert.equal(moneyToCents(0.1+0.2,'fixture'),30);
for(const invalid of [-1,NaN,Infinity,0.001,'1',null]) assert.throws(()=>moneyToCents(invalid,'fixture'));
console.log(JSON.stringify({test:'two-level integer-cent conservation',parentCases:20000,splitCases:cases,status:'PASS'}));

const dir = fs.mkdtempSync('/tmp/xt-sync-fix-schema-');
for(const generation of ['line-only','copy-no','progress-seq']) {
  const db = new Database(path.join(dir,`${generation}.db`));
  const copy = generation !== 'line-only'; const seq = generation === 'progress-seq';
  db.exec(`CREATE TABLE orders(id TEXT PRIMARY KEY, customer_name TEXT);
    INSERT INTO orders VALUES ('old-sync','same-name'),('legacy-manual','same-name');
    CREATE TABLE sync_inbox(id TEXT PRIMARY KEY,source_order_no TEXT NOT NULL,line_no INTEGER NOT NULL,
      ${copy?'copy_no INTEGER NOT NULL DEFAULT 1,':''}sku_code TEXT,internal_order_id TEXT,note TEXT DEFAULT '',payload TEXT NOT NULL,
      ${seq?'progress_seq INTEGER NOT NULL DEFAULT 0,':''}received_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_order_no,line_no${copy?',copy_no':''}));
    INSERT INTO sync_inbox(id,source_order_no,line_no,internal_order_id,payload${seq?',progress_seq':''})
      VALUES ('old-inbox','OLD',1,'old-sync','{"fixture":true}'${seq?',7':''});
    CREATE TABLE sync_progress_outbox(id TEXT PRIMARY KEY,inbox_id TEXT,payload TEXT);
    INSERT INTO sync_progress_outbox VALUES ('pending','old-inbox','{"seq":7}');`);
  initializeSyncSchema(db); initializeSyncSchema(db);
  const inbox = db.prepare('SELECT * FROM sync_inbox WHERE id=?').get('old-inbox') as {copy_no:number;progress_seq:number;allocated_cents:number|null;payload:string};
  assert.equal(inbox.copy_no,1); assert.equal(inbox.progress_seq,seq?7:0); assert.equal(inbox.allocated_cents,null); assert.equal(inbox.payload,'{"fixture":true}');
  assert.deepEqual(db.prepare('SELECT source_system,source_customer_id FROM orders WHERE id=?').get('old-sync'),{source_system:'storefront',source_customer_id:null});
  assert.equal((db.prepare('SELECT source_system FROM orders WHERE id=?').get('legacy-manual') as {source_system:string}).source_system,'');
  assert.equal((db.prepare('SELECT count(*) AS n FROM sync_orders').get() as {n:number}).n,0);
  assert.equal((db.prepare('SELECT count(*) AS n FROM sync_progress_outbox WHERE inbox_id=?').get('old-inbox') as {n:number}).n,1);
  db.prepare('INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,payload) VALUES (?,?,?,?,?)').run('second-copy','OLD',1,2,'{}');
  db.close();
  console.log(JSON.stringify({test:`migration ${generation} twice`,preservesRows:true,preservesProgress:true,inferredIdentity:false,status:'PASS'}));
}
console.log(`SCHEMA_FIXTURES ${dir}`);
