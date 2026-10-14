// Run: node scripts/test-ideas.cjs (isolated SQLite databases; no application data).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ideas-test-'));
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(fixture, 'test.db'), INTERNAL_APP_ROOT: fixture, JWT_SECRET: 'ideas-test-only-secret' });
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, ...args);
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const Database = require('better-sqlite3');
if (!process.argv.includes('--fresh')) {
  require('../src/lib/db.ts').getDb().close();
  delete require.cache[require.resolve('../src/lib/db.ts')];
  const old = new Database(process.env.DB_PATH);
  old.exec('DROP TABLE ideas');
  const source = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
  const schema = source.match(/CREATE TABLE IF NOT EXISTS ideas \([\s\S]*?\n    \);/)[0]
    .split('\n').filter(line => !/implementation_bonus_amount|implementation_bonus_currency|rejection_reason/.test(line)).join('\n');
  old.exec(schema);
  old.prepare("INSERT INTO ideas(title) VALUES ('existing')").run();
  old.close();
}
const { getDb } = require('../src/lib/db.ts');
const db = getDb();
const { signToken } = require('../src/lib/auth.ts');
const { PATCH } = require('../src/app/api/ideas/[id]/route.ts');
const { NextRequest } = require('next/server');
let failures = 0;
async function test(name, fn) { try { await fn(); console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e.message); } }
(async () => {
  const tokens = {};
  for (const role of ['admin', 'employee']) {
    const id = Number(db.prepare('INSERT INTO employees(name,email,role,password,must_change_password) VALUES (?,?,?,?,0)').run(role, role+'@ideas.invalid',role,'unused').lastInsertRowid);
    tokens[role] = await signToken({id,name:role,role,auth_version:0,must_change_password:0});
  }
  const create = (status='待评估') => Number(db.prepare('INSERT INTO ideas(title,status) VALUES (?,?)').run('test',status).lastInsertRowid);
  const read = id => db.prepare('SELECT * FROM ideas WHERE id=?').get(id);
  async function call(id, body, status=200, role='admin') {
    const res = await PATCH(new NextRequest('http://localhost/api/ideas/'+id,{method:'PATCH',headers:{'content-type':'application/json',...(role?{authorization:'Bearer '+tokens[role]}:{})},body:JSON.stringify(body)}),{params:Promise.resolve({id:String(id)})});
    assert.equal(res.status,status,JSON.stringify(await res.clone().json())); return res.json();
  }
  await test('schema fields and existing rows', async()=>{const row=read(create()); for(const field of ['implementation_bonus_amount','implementation_bonus_currency','rejection_reason']) assert(field in row,field); assert.equal(row.implementation_bonus_amount,null); if(!process.argv.includes('--fresh')) assert.equal(read(1).title,'existing');});
  await test('reject reason required and reopen clears it',async()=>{const id=create();for(const rejection_reason of [undefined,'','  ',12,{}]) await call(id,{action:'reject',rejection_reason},400);await call(id,{action:'reject',rejection_reason:'  暂不适合  '});assert.equal(read(id).rejection_reason,'暂不适合');assert.equal(read(id).status,'已拒绝');await call(id,{action:'reopen'});assert.equal(read(id).status,'待评估');assert.equal(read(id).rejection_reason,'');});
  await test('complete requires feature but reward can be deferred',async()=>{const id=create('进行中');for(const related_feature of [undefined,' ',{}]) await call(id,{action:'complete',related_feature},400);await call(id,{action:'complete',related_feature:' 功能A '});assert.equal(read(id).related_feature,'功能A');assert.equal(read(id).implementation_bonus_amount,null);assert.equal(read(id).status,'已实现');});
  await test('complete and supplement accept both currencies including zero',async()=>{for(const currency of ['THB','CNY']){const id=create('进行中');await call(id,{action:'complete',related_feature:'功能',implementation_bonus_amount:12.5,implementation_bonus_currency:currency});assert.equal(read(id).implementation_bonus_amount,12.5);assert.equal(read(id).implementation_bonus_currency,currency);await call(id,{action:'set_implementation_bonus',implementation_bonus_amount:0,implementation_bonus_currency:currency});assert.equal(read(id).implementation_bonus_amount,0);assert.equal(read(id).bonus_amount,0);assert.equal(read(id).related_feature,'功能');}});
  await test('deferred reward persists',async()=>{const id=create('已实现');await call(id,{action:'set_implementation_bonus',implementation_bonus_amount:'100',implementation_bonus_currency:'THB'});assert.equal(read(id).implementation_bonus_amount,100);});
  await test('invalid rewards do not mutate rows',async()=>{for(const action of ['complete','set_implementation_bonus'])for(const reward of [{implementation_bonus_amount:-1,implementation_bonus_currency:'THB'},{implementation_bonus_amount:true,implementation_bonus_currency:'THB'},{implementation_bonus_amount:'abc',implementation_bonus_currency:'THB'},{implementation_bonus_amount:1,implementation_bonus_currency:'USD'},{implementation_bonus_amount:1},{implementation_bonus_currency:'CNY'}]){const id=create(action==='complete'?'进行中':'已实现');const before=read(id);await call(id,{action,related_feature:'功能',...reward},400);assert.deepEqual(read(id),before);}await call(create('已实现'),{action:'set_implementation_bonus'},400);});
  await test('state and permission guards',async()=>{for(const [action,allowed] of [['reject','待评估'],['reopen','已拒绝'],['complete','进行中'],['set_implementation_bonus','已实现']])for(const state of ['待评估','已拒绝','已采纳','进行中','已实现'])if(state!==allowed)await call(create(state),{action,rejection_reason:'原因',related_feature:'功能',implementation_bonus_amount:10,implementation_bonus_currency:'THB'},400);await call(create(),{action:'reject',rejection_reason:'原因'},401,null);await call(create(),{action:'reject',rejection_reason:'原因'},403,'employee');await call(999999,{action:'reopen'},404);});
  await test('adopt and start unchanged',async()=>{const id=create();await call(id,{action:'adopt',bonus_amount:20,currency:'CNY'});await call(id,{action:'start'});assert.equal(read(id).status,'进行中');assert.equal(read(id).bonus_amount,20);});
})().catch(e=>{failures++;console.error(e)}).finally(()=>{db.close();fs.rmSync(fixture,{recursive:true,force:true});process.exitCode=failures?1:0;});
