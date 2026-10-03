/** Actual task handlers + JWT + fresh /tmp SQLite. No production server or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(process.env.INTERNAL_SOURCE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const dir = fs.mkdtempSync('/tmp/xt-internal-task-boundary-');
process.env.DB_PATH = path.join(dir, 'internal.db');
process.env.JWT_SECRET = 'local-task-boundary-jwt';
Object.assign(process.env, { NODE_ENV: 'test' });
delete process.env.CUSTOMER_SYNC_URL;
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };
const load = (relative: string) => import(pathToFileURL(path.join(root, relative)).href);
const [{ getDb }, { signToken }, handlers, { NextRequest }] = await Promise.all([
  load('src/lib/db.ts'), load('src/lib/auth.ts'), load('src/app/api/tasks/route.ts'), load('node_modules/next/server.js'),
]);
const db = getDb();
const tokens: Record<string,string> = {};
for (const role of ['employee', 'client']) {
  const result = db.prepare('INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES (?,?,?,?,0,0)')
    .run(`TASK_FIXTURE_${role}`, `${role}@example.invalid`, role, 'unused-fixture-password');
  tokens[role] = await signToken({id:Number(result.lastInsertRowid),name:`TASK_FIXTURE_${role}`,role,auth_version:0,must_change_password:0});
}
function req(role: string | null, method: string, body?: unknown) {
  return new NextRequest('http://fixture.invalid/api/tasks', {
    method, headers: { ...(role ? {authorization:`Bearer ${tokens[role]}`} : {}), 'content-type':'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function state() {
  return { tasks:db.prepare('SELECT * FROM tasks ORDER BY id').all(), audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all() };
}
const results: Record<string,unknown>[] = [];
try {
  const created = await handlers.POST(req('employee','POST',{
    title:'办理来源单 NO-FIXTURE-A', description:'PRIVATE_BUYER_A_NEGOTIATION_AND_COST', business_line:'公司注册',
  }));
  assert.equal(created.status,201); const task = await created.json();
  const baseline = state();
  for (const role of ['client', null]) {
    const expectedHTTP = role ? 403 : 401;
    const attempts = [
      ['GET', undefined], ['POST', {title:'UNAUTHORIZED_TASK'}],
      ['PATCH', {id:task.id,status:'completed'}], ['DELETE', {id:task.id}],
    ] as const;
    for (const [method,body] of attempts) {
      const response = await handlers[method](req(role,method,body));
      assert.equal(response.status,expectedHTTP,`${role || 'anonymous'} ${method}`);
      assert.deepEqual(state(),baseline,`${role || 'anonymous'} ${method} changed storage`);
      const output = await response.text();
      assert(!output.includes('PRIVATE_BUYER_A_NEGOTIATION_AND_COST'));
      results.push({role:role || 'anonymous',method,http:response.status,storageUnchanged:true,status:'PASS'});
    }
  }
  const listed = await handlers.GET(req('employee','GET'));
  assert.equal(listed.status,200);
  assert((await listed.json()).some((row:{id:string})=>row.id===task.id));
  const updated = await handlers.PATCH(req('employee','PATCH',{id:task.id,status:'in_progress'}));
  assert.equal(updated.status,200);assert.equal((await updated.json()).status,'in_progress');
  const deleted = await handlers.DELETE(req('employee','DELETE',{id:task.id}));
  assert.equal(deleted.status,200);assert.equal(db.prepare('SELECT id FROM tasks WHERE id=?').get(task.id),undefined);
  results.push({role:'employee',post:201,get:200,patch:200,delete:200,status:'PASS'});
  for (const result of results) console.log(JSON.stringify(result));
  console.log(`PASS ${results.length} task-boundary groups; fixtures=${dir}`);
} finally {
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));
  db.close();
}
