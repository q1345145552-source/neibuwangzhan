#!/usr/bin/env node
// Actual handlers with mock queries only; no database, notices or real chat writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createAttendanceHarness } = require('./test-chat-attendance-card.cjs');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, URL, Response, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error('Unexpected dependency: ' + name); } });
  return exports;
}
function createNoticeHarness() {
  const base = createAttendanceHarness();
  let actor = { id: 2, role: 'employee', name: '员工甲' };
  base.setActor(actor);
  const notices = [101, 202, 303, 404].map((id, i) => ({ id, title: '模拟通知' + ['甲', '乙', '丙', '丁'][i], body: '通知正文 ' + id,
    type: i % 2 ? '规则' : '通知', publisher_name: '老板', published_at: '2024-06-16 02:00:00' }));
  const record = (id, notice_id, employee_id, review_status, submitted_at = '2024-06-16 03:00:00') => ({
    id, notice_id, employee_id, employee_name: employee_id === 3 ? '员工乙' : '员工甲', printed: 1, printed_at: '2024-06-16 02:30:00',
    photos: '["/api/files/mock-paper.png"]', statement: '私密落实说明 ' + id, boss_comment: review_status === '打回' ? '私密打回原因' : '',
    review_status, submitted_at, reviewed_at: review_status === '还没处理' ? null : '2024-06-17 02:00:00',
  });
  const implementations = [record(1001,101,2,'还没处理'),record(1002,101,3,'通过'),record(1003,101,4,'打回'),
    record(101,202,2,'通过'),record(2001,303,2,'打回'),record(2002,303,3,'还没处理'),
    { ...record(3001,404,2,'还没处理',null), printed:0,printed_at:null,photos:'[]',statement:'' },record(4001,9999,2,'通过')];
  function project(sql, row) {
    if (!row) return undefined;
    const fields = sql.match(/SELECT ([\s\S]+?)\s+FROM notice_rule_implementations/)[1].split(',').map(s => s.trim().replace(/^[rn]\./, ''));
    assert(!fields.includes('*'));
    return Object.fromEntries(fields.map(f => [f, row[f]]));
  }
  const db = { prepare(sql) {
    if (!sql.includes('FROM notice_rule_implementations') && !sql.includes('FROM notice_rules')) return base.db.prepare(sql);
    return {
      get(...args) {
        base.reads.push(sql);
        if (sql.includes('FROM notice_rules WHERE id=?')) return notices.find(n => n.id === args[0]);
        assert(sql.includes('WHERE r.id=?'));
        if (actor.role !== 'admin') assert(sql.includes('AND r.employee_id=?') && args[1] === actor.id);
        const row = implementations.find(r => r.id === args[0] && (!sql.includes('AND r.employee_id=?') || r.employee_id === args[1]));
        const parent = notices.find(n => n.id === row?.notice_id);
        return parent && project(sql, { ...row, title: parent.title });
      },
      all(...args) {
        base.reads.push(sql);
        if (sql.includes('FROM notice_rules n')) {
          if (actor.role !== 'admin') assert(sql.includes('mine.employee_id=?') && args[0] === actor.id);
          return notices.filter(n => actor.role === 'admin' || implementations.some(r => r.notice_id === n.id && r.employee_id === args[0]))
            .map(n => ({ ...n, recipient_count: implementations.filter(r => r.notice_id === n.id).length,
              implemented_count: implementations.filter(r => r.notice_id === n.id && r.submitted_at && r.review_status !== '打回').length }));
        }
        if (sql.includes('JOIN notice_rules n')) {
          assert(!/statement|photos|boss_comment|n\.body/.test(sql));
          if (actor.role !== 'admin') assert(sql.includes('WHERE r.employee_id=?') && args[0] === actor.id);
          return implementations.filter(r => (actor.role === 'admin' || r.employee_id === args[0]) && notices.some(n => n.id === r.notice_id))
            .map(r => project(sql, { ...r, title: notices.find(n => n.id === r.notice_id).title }));
        }
        if (sql.includes('WHERE employee_id=?')) {
          assert.equal(args[0], actor.id);
          return implementations.filter(r => r.employee_id === args[0]).map(r => project(sql, r));
        }
        assert(sql.includes('WHERE notice_id=?')); assert.equal(actor.role, 'admin');
        return implementations.filter(r => r.notice_id === args[0]).map(r => project(sql, r));
      },
      run() { throw Error('Unexpected notice/business write'); },
    };
  } };
  const helper = load('src/lib/chat-notice-card.ts');
  const review = load('src/lib/notice-rule-review.ts', { 'node:crypto': require('node:crypto') });
  const deps = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: auth => ['admin','employee'].includes(auth.role) },
    '@/lib/db': { getDb: () => db }, '@/lib/req': { readJson: req => req.json() },
    '@/lib/chat-notice-card': helper, '@/lib/chat-leave-card': load('src/lib/chat-leave-card.ts'), '@/lib/chat-attendance-card': load('src/lib/chat-attendance-card.ts'),
    '@/lib/notice-rule-review': review, '@/lib/submission-todos': { assignNoticeTodo() { throw Error('No assignment allowed'); }, syncNoticeTodo() { throw Error('No business changes allowed'); } } };
  const routes = Object.fromEntries(Object.entries({ candidates:'chat/share-items',direct:'chat',group:'chat/group-messages',groups:'chat/groups',
    lookup:'notice-rules/implementations/[recordId]',list:'notice-rules',reviews:'notice-rules/[id]/implementations',review:'notice-rules/[id]/implementations/[recordId]/review' })
    .map(([key, file]) => [key, load(`src/app/api/${file}/route.ts`, deps)]));
  return { ...base, notices, implementations, db, helper, routes,
    setActor(value) { actor = value; base.setActor(value); },
    async call(route, method='GET', body, id, query='', noticeId) {
      const req = new Request('http://mock/api/'+route+query,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
      const response = await routes[route][method](req,{params:Promise.resolve({id:String(noticeId??id),recordId:String(id)})});
      return { response,status:response.status,body:await response.json() };
    },
  };
}
async function run() {
  const h = createNoticeHarness();
  for (const actor of [null,{id:9,role:'client',name:'客户'}]) {
    h.setActor(actor);
    for (const [route,method,body,id,query] of [['candidates','GET',null,null,'?type=notice'],['lookup','GET',null,1001],['list','GET'],
      ['direct','POST',{other:'老板',card_type:'notice',card_id:'1001'}],['group','POST',{group_id:20,card_type:'notice',card_id:'1001'}]]) assert.equal((await h.call(route,method,body,id,query)).status,actor?403:401);
  }
  assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);
  h.setActor({id:2,role:'employee',name:'员工甲'});
  let r=await h.call('candidates','GET',null,null,'?type=notice&employee_id=4');
  assert.equal(r.status,200);assert.deepEqual(r.body.map(c=>c.id),['1001','101','2001','3001']);
  assert.deepEqual(r.body.map(c=>c.status),['已提交等验收','已通过','已打回','还没处理']);assert(!JSON.stringify(r.body).includes('私密'));
  assert.deepEqual(Object.keys(r.body[0]).sort(),['id','status','subtitle','title']);
  assert.deepEqual((await h.call('lookup','GET',null,101)).body,{id:101,notice_id:202});
  for(const id of [1002,1003,202,4001,99999])assert.equal((await h.call('lookup','GET',null,id)).status,404);
  for(const id of ['0','-1','NaN','9007199254740992'])assert.equal((await h.call('lookup','GET',null,id)).status,400);
  r=await h.call('list');assert.equal(r.body.length,4);assert.deepEqual(r.body.map(n=>n.implementation.id),[1001,101,2001,3001]);
  assert(!JSON.stringify(r.body).includes('私密落实说明 1002'));assert(!JSON.stringify(r.body).includes('私密落实说明 1003'));
  let before=h.reads.length;assert.equal((await h.call('reviews','GET',null,101)).status,403);assert.equal((await h.call('review','POST',{decision:'通过'},1001,'',101)).status,403);assert.equal(h.reads.length,before);assert.equal(h.writes.length,0);
  console.log('PASS personal implementation IDs, parent-ID collision 101->202, all four states, employee_id ownership including same-name different account, minimal candidates, own list IDs and admin-only review unchanged');
  for(const route of ['direct','group']){
    const scope=route==='direct'?{other:'老板'}:{group_id:20};before=h.writes.length;
    for(const id of ['1002','1003','202','4001','99999','01'])assert.equal((await h.call(route,'POST',{...scope,card_type:'notice',card_id:id,employee_id:4})).status,404);
    assert.equal(h.writes.length,before);
    for(const id of ['1001','101','2001','3001']){
      r=await h.call(route,'POST',{...scope,card_type:'notice',card_id:id,title:'伪造标题',content:'私密伪造说明'});assert.equal(r.status,201);assert.equal(r.body.message.order_id,'notice:'+id);
      const c=JSON.parse(r.body.message.content);assert.deepEqual(Object.keys(c).sort(),['subtitle','title']);assert(c.title.includes('#'+id));assert(!JSON.stringify(c).includes('私密')&&!JSON.stringify(c).includes('伪造'));
    }
    for(const type of ['order','todo','project','customer','vat','wht','problem','issue','leave','attendance'])assert.equal((await h.call(route,'POST',{...scope,card_type:type,card_id:type==='order'?'ORD-1':type==='leave'?'1001':type==='attendance'?'1101':'1'})).status,201,type);
  }
  assert(h.previews.includes('[通知落实]'));await h.call('group','POST',{group_id:20,card_type:'notice',card_id:'101'});assert.equal((await h.call('groups')).body[0].last_preview,'[通知落实]');
  before=h.writes.length;h.setMember(false);assert.equal((await h.call('group','POST',{group_id:20,card_type:'notice',card_id:'1001'})).status,403);h.setMember(true);
  h.setActive(false);for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'老板'}:{group_id:20}),card_type:'notice',card_id:'1001'})).status,403);h.setActive(true);assert.equal(h.writes.length,before);
  h.setActor({id:4,role:'employee',name:'员工甲'});assert.deepEqual((await h.call('candidates','GET',null,null,'?type=notice')).body.map(c=>c.id),['1003']);assert.equal((await h.call('lookup','GET',null,1001)).status,404);
  h.setActor({id:1,role:'admin',name:'老板'});assert.equal((await h.call('candidates','GET',null,null,'?type=notice')).body.length,7);
  assert.deepEqual((await h.call('lookup','GET',null,1003)).body,{id:1003,notice_id:101});assert.equal((await h.call('reviews','GET',null,101)).body.records.length,3);
  for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'员工甲'}:{group_id:20}),card_type:'notice',card_id:'1003'})).status,201);
  console.log('PASS real direct/group POST, canonical minimal server snapshot, forged content rejected, original ten cards preserved, both previews, admin lookup/review and same-name owner isolation; no notice/print/submission writes');
  const page=fs.readFileSync(path.join(root,'src/app/(app)/messages/page.tsx'),'utf8');const exports={};
  vm.runInNewContext(ts.transpileModule(page.slice(page.indexOf('// ── 分享卡片'),page.indexOf('// ── AI 总结'))+'\nObject.assign(exports,{CARD_META,SHARE_CATEGORIES,parseCard,quotePreview});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports});
  assert.equal(exports.SHARE_CATEGORIES.length,11);const m={order_id:'notice:101',content:JSON.stringify({title:'模拟通知乙 · 员工甲 #101',subtitle:'已通过'})};
  assert.equal(exports.parseCard(m).kind,'notice');assert.equal(exports.quotePreview(m),'[通知落实] 模拟通知乙 · 员工甲 #101');assert.equal(exports.CARD_META.notice.href('101'),'/notice-rules?implementation=101');
  console.log('PASS eleven frontend categories, parser, quote preview and personal-record URL. No database imported or opened.');
}
module.exports={createNoticeHarness};
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
