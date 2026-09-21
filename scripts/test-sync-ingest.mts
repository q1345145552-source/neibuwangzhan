/** Isolated regression suite: DB_PATH must point to a new /tmp/xt-sync-fix-* directory. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

async function main() {
  const dbPath = process.env.DB_PATH;
  assert(typeof dbPath === 'string' && dbPath.startsWith('/tmp/xt-sync-fix-'), 'Use a new /tmp/xt-sync-fix-* DB_PATH');
  assert(!fs.existsSync(dbPath), 'Refusing to reuse a database');
  delete process.env.CUSTOMER_SYNC_URL;
  process.env.SYNC_SECRET = 'local-regression-secret';
  process.env.JWT_SECRET = 'local-regression-jwt';
  globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };
  const [{ POST }, { getDb }, { GET: externalList }, { GET: externalDetail }, { signToken }] = await Promise.all([
    import('../src/app/api/sync/orders/route'), import('../src/lib/db'),
    import('../src/app/api/external/orders/route'), import('../src/app/api/external/orders/[id]/route'),
    import('../src/lib/auth'),
  ]);
  const db = getDb();
  const buyer = { id: 'buyer-A-stable-id', name: 'SYNTHETIC_SAME_NAME', email: 'buyer-a@example.invalid' };
  function body(no: string, amounts: number[], discount = 0, quantity = 1) {
    return { source: 'storefront', source_order_no: no, billing_revision: 1,
      ordered_at: '2026-09-12T00:00:00.000Z', currency: 'CNY',
      total_amount: Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100, discount, customer: buyer,
      lines: amounts.map((amount, i) => ({ line_no: i + 1, sku_code: 'COM-001', sku_name: 'Synthetic service', quantity, amount })) };
  }
  async function request(payload: unknown, status = 200) {
    const response = await POST(new NextRequest('http://fixture.invalid/api/sync/orders', { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer local-regression-secret',
    }, body: JSON.stringify(payload) }));
    const json = await response.json();
    assert.equal(response.status, status, JSON.stringify(json));
    return json;
  }
  function amounts(no: string) {
    return (db.prepare('SELECT o.total_amount FROM orders o JOIN sync_inbox si ON si.internal_order_id=o.id WHERE si.source_order_no=? ORDER BY si.line_no,si.copy_no').all(no) as {total_amount:number}[]).map(x => Math.round(x.total_amount * 100));
  }
  const results: { name: string; result: string; error?: string }[] = [];
  async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); results.push({ name, result: 'PASS' }); }
    catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); }
  }
  await test('cross-line discount conserves all cents', async () => {
    await request(body('CENT-LINES', [100, 100, 100], 2));
    assert.equal(amounts('CENT-LINES').reduce((a,b) => a+b, 0), 29800);
  });
  await test('tiny amount ten copies never creates money', async () => {
    await request(body('CENT-COPIES', [0.05], 0, 10));
    const copies = amounts('CENT-COPIES');
    assert.equal(copies.length, 10); assert.equal(copies.reduce((a,b) => a+b, 0), 5);
    assert(copies.every(x => x === 0 || x === 1));
  });
  await test('gross amount apportions by immutable weights including non-orders', async () => {
    const payload = body('CENT-FEES', [100, 100, 100], 2);
    payload.total_amount = 600;
    payload.lines[1].sku_code = 'OTH-007'; payload.lines[2].sku_code = 'CLASS-LIST';
    await request(payload);
    const rows = db.prepare('SELECT internal_order_id, allocated_cents FROM sync_inbox WHERE source_order_no=?').all(payload.source_order_no) as { internal_order_id: string|null; allocated_cents: number }[];
    assert.equal(rows.reduce((a,b) => a+b.allocated_cents, 0), 59800);
    assert.equal(rows.filter(x => x.internal_order_id === null).length, 2);
  });
  await test('account ownership retained; same-name and company-name mappings denied; legacy orders preserved', async () => {
    const result = await request(body('OWNER', [123])); const orderId = result.results[0].order_id;
    const parent = db.prepare('SELECT source_customer_id,payload FROM sync_orders WHERE source_order_no=?').get('OWNER') as {source_customer_id:string;payload:string};
    assert.equal(parent.source_customer_id, buyer.id); assert.equal(JSON.parse(parent.payload).customer.id, buyer.id);
    const employee = db.prepare("INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES (?,?,'client','fixture-password',0,0)").run(buyer.name, 'client-b@example.invalid');
    const employeeId = Number(employee.lastInsertRowid);
    const token = await signToken({id:employeeId,name:buyer.name,role:'client',auth_version:0,must_change_password:0});
    const headers = {authorization:`Bearer ${token}`};
    db.prepare("INSERT INTO orders(id,customer_name,business_type_id) VALUES ('LEGACY-OWNED',?,1)").run(buyer.name);
    for (const explicit of [false, true]) {
      if(explicit) db.prepare('INSERT INTO client_account_customers(employee_id,customer_name) VALUES (?,?)').run(employeeId,buyer.name);
      const listResponse = await externalList(new NextRequest('http://fixture.invalid/api/external/orders',{headers}));
      assert.equal(listResponse.status,200);
      const list = await listResponse.json(); assert(!list.some((x:{id:string})=>x.id===orderId)); assert(list.some((x:{id:string})=>x.id==='LEGACY-OWNED'));
      const detail = await externalDetail(new NextRequest(`http://fixture.invalid/api/external/orders/${orderId}`,{headers}),{params:Promise.resolve({id:orderId})});
      assert.equal(detail.status,404);
    }
  });
  await test('client tokens cannot bypass scope through internal routes, collections, uploads, or files', async () => {
    const owner = await request(body('BYPASS-OWNER',[77]));
    const orderId = owner.results[0].order_id;
    const step = db.prepare('SELECT id FROM order_steps WHERE order_id=? ORDER BY id LIMIT 1').get(orderId) as {id:number};
    const stepDoc = db.prepare('SELECT id FROM step_documents WHERE order_id=? LIMIT 1').get(orderId) as {id:number};
    db.prepare("INSERT INTO documents(order_id,name,file_url) VALUES (?,'PRIVATE_SYNC_DOC','/api/files/private-sync.pdf')").run(orderId);
    db.prepare("INSERT INTO finances(order_id,type,amount,description) VALUES (?,'expense',7,'PRIVATE_SYNC_COST')").run(orderId);
    db.prepare("INSERT INTO step_notes(order_id,step_id,content,created_by) VALUES (?,?,'PRIVATE_SYNC_NOTE','employee')").run(orderId,step.id);
    const employee = db.prepare("INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES (?,?,'client','fixture-password',0,0)").run(buyer.name,'bypass-client@example.invalid');
    const employeeId = Number(employee.lastInsertRowid);
    const token = await signToken({id:employeeId,name:buyer.name,role:'client',auth_version:0,must_change_password:0});
    const headers = {authorization:`Bearer ${token}`,'content-type':'application/json'};
    const context = {params:Promise.resolve({id:orderId,stepId:String(step.id)})};
    const orderRoutes = await Promise.all([
      import('../src/app/api/orders/[id]/route'), import('../src/app/api/orders/[id]/documents/route'),
      import('../src/app/api/orders/[id]/finances/route'), import('../src/app/api/orders/[id]/certificates/route'),
      import('../src/app/api/orders/[id]/steps/[stepId]/notes/route'), import('../src/app/api/orders/[id]/steps/[stepId]/documents/route'),
    ]);
    for(const route of orderRoutes) {
      const response = await route.GET(new NextRequest(`http://fixture.invalid/api/orders/${orderId}`,{headers}),context);
      assert([403,404].includes(response.status),`order endpoint status ${response.status}`);
    }
    const collectionRoutes = await Promise.all([import('../src/app/api/orders/route'),import('../src/app/api/documents/route'),import('../src/app/api/finances/route')]);
    for(const [index, route] of collectionRoutes.entries()) {
      const response = await route.GET(new NextRequest('http://fixture.invalid/api/orders',{headers}));
      // Finance is a staff capability; customer-facing orders/documents remain scoped collections.
      assert.equal(response.status, index === 2 ? 403 : 200);
      const text = await response.text();
      assert(!text.includes(orderId));
      assert(!text.includes('PRIVATE_SYNC_'));
      if (index === 0) assert(text.includes('LEGACY-OWNED'), 'Preserve the legitimate legacy customer order');
    }
    const staffRoutes = await Promise.all([import('../src/app/api/steps/assigned/route'),import('../src/app/api/dashboard/stats/route'),
      import('../src/app/api/internal/workload/route'),import('../src/app/api/internal/workload-details/route'),
      import('../src/app/api/internal/weekly-report/route'),import('../src/app/api/customers/route'),import('../src/app/api/customers/[id]/route'),
      import('../src/app/api/audit-logs/route'),import('../src/app/api/notifications/route'),import('../src/app/api/internal/points/route')]);
    for(const route of staffRoutes) {
      const response = await route.GET(new NextRequest('http://fixture.invalid/api/orders',{headers}),context);
      assert.equal(response.status,403);
    }
    const [{POST:addDocument},{POST:addNote},{POST:markUploaded}] = await Promise.all([
      import('../src/app/api/orders/[id]/documents/route'),import('../src/app/api/orders/[id]/steps/[stepId]/notes/route'),
      import('../src/app/api/orders/[id]/steps/[stepId]/documents/mark-uploaded/route'),
    ]);
    for(const post of [addDocument,addNote,markUploaded]) {
      const response = await post(new NextRequest('http://fixture.invalid/api/orders',{method:'POST',headers,body:JSON.stringify({name:'injected',content:'injected',document_id:stepDoc.id})}),context);
      assert.equal(response.status,403);
    }
    // Re-reading a mismatched doc_id must not reveal another order's document.
    const mismatch = await markUploaded(new NextRequest('http://fixture.invalid/api/orders',{method:'POST',headers,body:JSON.stringify({document_id:stepDoc.id})}),{params:Promise.resolve({id:'LEGACY-OWNED',stepId:String(step.id)})});
    assert.equal(mismatch.status,403); // Client is denied the staff action before any object lookup.
    assert(!(await mismatch.text()).includes(String(stepDoc.id)), 'Do not disclose the foreign document');
    const staff = db.prepare("INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES ('FIXTURE_STAFF','staff@example.invalid','employee','fixture-password',0,0)").run();
    const staffToken=await signToken({id:Number(staff.lastInsertRowid),name:'FIXTURE_STAFF',role:'employee',auth_version:0,must_change_password:0});
    const staffHeaders = {authorization:`Bearer ${staffToken}`,'content-type':'application/json'};
    const staffMismatch = await markUploaded(new NextRequest('http://fixture.invalid/api/orders',{method:'POST',headers:staffHeaders,body:JSON.stringify({document_id:stepDoc.id})}),{params:Promise.resolve({id:'LEGACY-OWNED',stepId:String(step.id)})});
    assert.equal(staffMismatch.status,404); // A real staff token still cannot cross-bind a step/document.
    const oldCwd=process.cwd(); const fixtureDir=dbPath.slice(0,dbPath.lastIndexOf('/'));
    fs.mkdirSync(`${fixtureDir}/uploads`,{recursive:true});
    fs.writeFileSync(`${fixtureDir}/uploads/legacy-owned.pdf`,'SYNTHETIC_LEGACY_FILE');
    process.chdir(fixtureDir);
    const {GET:download} = await import('../src/app/api/files/[filename]/route');
    process.chdir(oldCwd);
    const denied = await download(new NextRequest('http://fixture.invalid/api/files/private-sync.pdf',{headers}),{params:Promise.resolve({filename:'private-sync.pdf'})});
    assert.equal(denied.status,403);
    // Attaching the same URL to a visible legacy order must not claim the private sync file.
    db.prepare("INSERT INTO documents(order_id,name,file_url) VALUES ('LEGACY-OWNED','copied-url','/api/files/private-sync.pdf')").run();
    const stillDenied = await download(new NextRequest('http://fixture.invalid/api/files/private-sync.pdf',{headers}),{params:Promise.resolve({filename:'private-sync.pdf'})});
    assert.equal(stillDenied.status,403);
    const legacyDoc = db.prepare("INSERT INTO documents(order_id,name,file_url) VALUES ('LEGACY-OWNED','legacy-file','/api/files/legacy-owned.pdf')").run();
    const legacyFileContext = {params:Promise.resolve({filename:'legacy-owned.pdf'})};
    const unverified = await download(new NextRequest('http://fixture.invalid/api/files/legacy-owned.pdf',{headers}),legacyFileContext);
    assert.equal(unverified.status,403, 'A bare legacy URL is not evidence of customer publication');
    const {PATCH:reviewDocument} = await import('../src/app/api/orders/[id]/documents/route');
    const publicationBody = JSON.stringify({document_id:Number(legacyDoc.lastInsertRowid),status:'已审核',direction:'us_to_client'});
    const clientPublication = await reviewDocument(new NextRequest('http://fixture.invalid/api/orders/LEGACY-OWNED/documents',{method:'PATCH',headers,body:publicationBody}),{params:Promise.resolve({id:'LEGACY-OWNED'})});
    assert.equal(clientPublication.status,403, 'A client cannot certify publication');
    const wrongParentPublication = await reviewDocument(new NextRequest(`http://fixture.invalid/api/orders/${orderId}/documents`,{method:'PATCH',headers:staffHeaders,body:publicationBody}),{params:Promise.resolve({id:orderId})});
    assert.equal(wrongParentPublication.status,404);
    const published = await reviewDocument(new NextRequest('http://fixture.invalid/api/orders/LEGACY-OWNED/documents',{method:'PATCH',headers:staffHeaders,body:publicationBody}),{params:Promise.resolve({id:'LEGACY-OWNED'})});
    assert.equal(published.status,200);
    assert.equal((await published.json()).publication_verified,1);
    const visibleDocs = await collectionRoutes[1].GET(new NextRequest('http://fixture.invalid/api/documents',{headers}));
    assert.equal(visibleDocs.status,200);
    const visibleDocText = await visibleDocs.text();
    assert(visibleDocText.includes('legacy-file')); assert(!visibleDocText.includes('copied-url')); assert(!visibleDocText.includes('PRIVATE_SYNC_'));
    const allowed = await download(new NextRequest('http://fixture.invalid/api/files/legacy-owned.pdf',{headers}),{params:Promise.resolve({filename:'legacy-owned.pdf'})});
    assert.equal(allowed.status,200); assert.equal(await allowed.text(),'SYNTHETIC_LEGACY_FILE');
    assert.equal(allowed.headers.get('cache-control'),'private, no-store');
    const staffResponse=await orderRoutes[0].GET(new NextRequest(`http://fixture.invalid/api/orders/${orderId}`,{headers:{authorization:`Bearer ${staffToken}`}}),context);
    assert.equal(staffResponse.status,200); assert((await staffResponse.text()).includes(orderId));
  });
  await test('billing revisions ordered and idempotent, preserve internal work', async () => {
    const payload = body('REVISION', [100, 100], 0, 2);
    const created = await request(payload); const ids = created.results.map((r:{order_id:string})=>r.order_id);
    db.prepare("UPDATE orders SET status='已完成',description='STAFF_NOTE' WHERE id=?").run(ids[0]);
    db.prepare("UPDATE order_steps SET notes='STAFF_STEP_NOTE' WHERE order_id=?").run(ids[0]);
    const changed = {...payload,billing_revision:3,total_amount:500,discount:3};
    assert.equal((await request(changed)).billing_revision,3); assert.equal(amounts('REVISION').reduce((a,b)=>a+b,0),49700);
    assert.equal((await request(changed)).billing_revision,3); assert.equal((await request({...payload,billing_revision:2,total_amount:600})).billing_revision,3);
    assert.equal(amounts('REVISION').reduce((a,b)=>a+b,0),49700);
    assert.equal(amounts('REVISION').length,4);
    const order = db.prepare('SELECT status,description FROM orders WHERE id=?').get(ids[0]);
    assert.deepEqual(order,{status:'已完成',description:'STAFF_NOTE'});
    assert((db.prepare('SELECT notes FROM order_steps WHERE order_id=?').all(ids[0]) as {notes:string}[]).every(x=>x.notes==='STAFF_STEP_NOTE'));
    await request({...changed,total_amount:501},409);
    await request({...changed,billing_revision:4,customer:{...buyer,id:'buyer-B'}},409);
    await request({...changed,billing_revision:4,lines:changed.lines.map((line,i)=>i===0?{...line,quantity:3}:line)},409);
    await request({...changed,billing_revision:4,lines:changed.lines.map((line,i)=>i===0?{...line,amount:101}:line)},409);
    await request({...changed,billing_revision:4,lines:changed.lines.map((line,i)=>i===0?{...line,sku_code:'COM-002'}:line)},409);
  });
  await test('invalid input rejected without truncation, coercion, or writes', async () => {
    const valid = body('INVALID', [1]);
    for (const invalid of [
      {...valid,billing_revision:0}, {...valid,total_amount:-1}, {...valid,total_amount:0.001},
      {...valid,discount:2}, {...valid,customer:{...buyer,id:'x'.repeat(65)}},
      {...valid,source:'unexpected'}, {...valid,currency:'XYZ'},
      {...valid,lines:[{...valid.lines[0],quantity:1.5}]}, {...valid,lines:[{...valid.lines[0],quantity:1000}]},
      {...valid,lines:[{...valid.lines[0],line_no:'1'}]}, {...valid,lines:[valid.lines[0],valid.lines[0]]},
      {...valid,lines:[{...valid.lines[0],amount:0}]},
    ]) await request(invalid,400);
    assert.equal(amounts('INVALID').length,0);
  });
  await test('legacy inbox missing parent is fail-closed, no inferred account or duplicate order', async () => {
    db.prepare("INSERT INTO orders(id,customer_name,business_type_id) VALUES ('OLD-SYNC',?,1)").run(buyer.name);
    db.prepare("INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,payload) VALUES ('OLD-INBOX','LEGACY-SYNC',1,1,'COM-001','OLD-SYNC','{}')").run();
    await request(body('LEGACY-SYNC',[1]),409);
    assert.equal(amounts('LEGACY-SYNC').length,1);
    const { customerNameFilter } = await import('../src/lib/client-scope');
    const scope = customerNameFilter([buyer.name]);
    assert.equal((db.prepare(`SELECT count(*) AS n FROM orders o WHERE o.id='OLD-SYNC' AND ${scope.clause}`).get(...scope.params) as {n:number}).n,0);
  });
  await test('recurring rows retain full allocated amount but create no fulfillment orders', async () => {
    const payload = {...body('RECURRING',[0,0]),source:'recurring',total_amount:0};
    await request(payload);
    assert.equal(amounts('RECURRING').length,0);
    const stored = db.prepare('SELECT sum(allocated_cents) AS n FROM sync_inbox WHERE source_order_no=?').get('RECURRING') as {n:number};
    assert.equal(stored.n,0);
  });
  await test('initial progress and parent/inbox/order creation commit atomically', async () => {
    db.exec("CREATE TRIGGER fail_initial_progress BEFORE INSERT ON sync_progress_outbox BEGIN SELECT RAISE(FAIL,'fixture progress insert failure'); END");
    await request(body('ATOMIC-INITIAL',[100]),500);
    assert.equal(amounts('ATOMIC-INITIAL').length,0);
    assert.equal((db.prepare("SELECT count(*) AS n FROM sync_orders WHERE source_order_no='ATOMIC-INITIAL'").get() as {n:number}).n,0);
    db.exec('DROP TRIGGER fail_initial_progress');
    const created = await request(body('ATOMIC-INITIAL',[100]));
    const initial = db.prepare('SELECT o.payload FROM sync_progress_outbox o JOIN sync_inbox i ON o.inbox_id=i.id WHERE i.source_order_no=?').all('ATOMIC-INITIAL') as {payload:string}[];
    assert.equal(initial.length,1);
    assert.equal(JSON.parse(initial[0].payload).seq,1);
    assert.equal(JSON.parse(initial[0].payload).status,'待处理');
    assert.equal(created.billing_revision,1);
  });
  db.close();
  for(const result of results) console.log(JSON.stringify(result));
  const failed = results.filter(x=>x.result==='FAIL').length;
  console.log(`SUMMARY ${results.length-failed}/${results.length} passed`);
  if(failed) process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
