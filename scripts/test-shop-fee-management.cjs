#!/usr/bin/env node
// Actual API handlers with simulated queries/files only. Never opens SQLite or real uploads.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText,
    { exports, URL, Response, Buffer, File, Blob, Uint8Array, DataView, console: { error() {} }, require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw Error('Unexpected dependency: ' + name);
    } });
  return exports;
}
const policy = load('src/lib/shop-fees.ts');
const imageTypes = load('src/lib/heic-upload.ts');
const makeFee = (id, extra = {}) => ({ id, fee_type: '收入', business_type: '卖店铺', amount: 100, currency: 'CNY', note: '原说明', screenshot: '/api/files/original.png',
  status: '待核对', reviewed_by: '', reviewed_at: '', review_note: '', created_by: '员工甲', created_at: '2026-10-22 01:00:00', ...extra });
function createHarness() {
  let actor = { id: 2, role: 'employee', name: '员工甲' }, locks = 0, dbCalls = 0, expectLock = false, beforeTransaction = null;
  const fees = new Map([
    makeFee(1), makeFee(2, { fee_type: '支出', status: '待处理', amount: 40 }), makeFee(3, { created_by: '员工乙', amount: 200 }),
    makeFee(4, { status: '已到账', reviewed_by: '老板', reviewed_at: '2026-10-22 02:00:00', amount: 500 }),
    makeFee(5, { status: '未到账', reviewed_by: '老板', reviewed_at: '2026-10-22 02:00:00', review_note: '待跟进', amount: 50 }),
    makeFee(6, { fee_type: '支出', status: '待处理', created_by: '员工乙', currency: 'THB', amount: 80 }),
  ].map(row => [row.id, row]));
  const logs = [], fileBytes = new Map(), uploads = new Map(), writes = [];
  const db = {
    transaction(fn) {
      const run = () => {
        if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; hook(); }
        const old = JSON.stringify([...fees]), oldLogs = logs.length;
        locks++;
        try { return fn(); } catch (e) { fees.clear(); for (const [id, row] of JSON.parse(old)) fees.set(id, row); logs.length = oldLogs; throw e; }
        finally { locks--; }
      };
      run.immediate = run; return run;
    },
    prepare(sql) { return {
      get(...args) {
        if (sql === 'SELECT * FROM shop_fees WHERE id = ?') { if (expectLock) assert(locks > 0, 'Read authorization/status inside immediate transaction'); const row = fees.get(Number(args[0])); return row ? { ...row } : undefined; }
        throw Error('Unexpected lookup ' + sql);
      },
      all() { assert.equal(sql, 'SELECT * FROM shop_fees ORDER BY id DESC'); return [...fees.values()].sort((a, b) => b.id - a.id).map(row => ({ ...row })); },
      run(...args) {
        writes.push(sql);
        if (sql.startsWith('INSERT INTO shop_fees ')) {
          const id = Math.max(0, ...fees.keys()) + 1, [fee_type, business_type, amount, currency, note, screenshot, status, created_by] = args;
          fees.set(id, makeFee(id, { fee_type, business_type, amount, currency, note, screenshot, status, created_by })); return { lastInsertRowid: id, changes: 1 };
        }
        if (sql.startsWith('UPDATE shop_fees SET amount = ?')) {
          assert(locks > 0); const [amount, business_type, currency, note, screenshot, id] = args; Object.assign(fees.get(Number(id)), { amount, business_type, currency, note, screenshot }); return { changes: 1 };
        }
        if (sql.startsWith('UPDATE shop_fees SET status = ?')) {
          assert(locks > 0); const [status, reviewed_by, review_note, id] = args; Object.assign(fees.get(Number(id)), { status, reviewed_by, reviewed_at: 'mock-review-time', review_note }); return { changes: 1 };
        }
        if (sql === 'DELETE FROM shop_fees WHERE id = ?') { assert(locks > 0); return { changes: Number(fees.delete(Number(args[0]))) }; }
        if (sql.startsWith('INSERT INTO file_uploads')) { const [filename, uploaded_by_id, uploaded_by_role, mime_type, size] = args; uploads.set(filename, { uploaded_by_id, uploaded_by_role, mime_type, size }); return { changes: 1 }; }
        throw Error('Unexpected write ' + sql);
      },
    }; },
  };
  class NextResponse extends Response { static json(body, init) { return Response.json(body, init); } }
  const fakePath = filename => { assert(filename.startsWith('/mock/'), filename); return filename; };
  const deps = { 'next/server': { NextResponse }, '@/lib/auth': { verifyAuth: async () => actor, verifyToken: async () => actor, isStaff: a => ['admin', 'employee'].includes(a.role) },
    '@/lib/db': { getDb: () => { dbCalls++; return db; }, logOperation: (...args) => logs.push({ args, timestamp: 'mock-audit-time' }) },
    '@/lib/req': { readJson: req => req.json() }, '@/lib/shop-fees': policy, '@/lib/heic-upload': imageTypes,
    '@/lib/uploads': { uploadsDir: '/mock/uploads' }, 'node:crypto': require('node:crypto'), path: require('node:path'), os: { tmpdir: () => '/mock/tmp' },
    fs: { existsSync: filename => fileBytes.has(fakePath(filename)), mkdirSync: fakePath, writeFileSync: (filename, bytes) => fileBytes.set(fakePath(filename), Buffer.from(bytes)), unlinkSync: filename => fileBytes.delete(fakePath(filename)) },
    'fs/promises': { mkdir: async filename => fakePath(filename), writeFile: async (filename, bytes) => fileBytes.set(fakePath(filename), Buffer.from(bytes)), unlink: async filename => fileBytes.delete(fakePath(filename)), readFile: async filename => fileBytes.get(fakePath(filename)) },
    '@/lib/client-scope': { isClientFileVisible: (id, name, filename) => uploads.get(filename)?.uploaded_by_id === id },
  };
  const routes = { list: load('src/app/api/shop-fees/route.ts', deps), item: load('src/app/api/shop-fees/[id]/route.ts', deps), upload: load('src/app/api/upload/route.ts', deps), file: load('src/app/api/files/[filename]/route.ts', deps) };
  return { fees, logs, uploads, fileBytes, writes, policy, get actor() { return actor; }, setActor(a) { actor = a; }, get dbCalls() { return dbCalls; }, beforeTransaction(fn) { beforeTransaction = fn; },
    state() { return JSON.stringify({ fees: [...fees], logs, files: [...fileBytes.keys()], uploads: [...uploads], writes }); },
    async call(key, method = 'GET', body, id = 1) {
      expectLock = key === 'item';
      try {
        const response = await routes[key][method](new Request('http://mock/api/shop-fees/' + id, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ id: String(id) }) });
        return { response, status: response.status, body: await response.json() };
      } finally { expectLock = false; }
    },
    async upload(file) {
      const data = new FormData(); data.append('file', file);
      const response = await routes.upload.POST(new Request('http://mock/api/upload', { method: 'POST', body: data }));
      return { status: response.status, body: await response.json() };
    },
    async download(filename) {
      return routes.file.GET({ headers: new Headers(), nextUrl: new URL('http://mock/api/files/' + filename + '?token=mock') }, { params: Promise.resolve({ filename }) });
    },
  };
}
const edit = { action: 'edit', fee_type: '收入', business_type: '邮箱', amount: 125, currency: 'THB', note: ' 修改后 ', screenshot: '/api/files/replacement.png' };
async function run() {
  for (const actor of [null, { id: 9, role: 'client', name: '员工甲' }]) {
    const h = createHarness(); h.setActor(actor);
    for (const method of ['PATCH', 'DELETE']) assert.equal((await h.call('item', method, method === 'PATCH' ? edit : null)).status, actor ? 403 : 401);
    assert.equal(h.dbCalls, 0); assert.equal(h.logs.length, 0);
  }
  for (const method of ['PATCH', 'DELETE']) {
    const h = createHarness(), old = h.state();
    const r = await h.call('item', method, method === 'PATCH' ? { ...edit, created_by: '员工甲', role: 'admin', name: '老板' } : null, 3);
    assert.equal(r.status, 403); assert.equal(h.state(), old);
  }
  for (const actor of [{ role: 'employee', name: '员工甲' }, { role: 'admin', name: '老板' }]) for (const id of [4, 5]) for (const method of ['PATCH', 'DELETE']) {
    const h = createHarness(); h.setActor(actor); const old = h.state();
    assert.equal((await h.call('item', method, method === 'PATCH' ? edit : null, id)).status, 409); assert.equal(h.state(), old);
    assert.equal(h.policy.canEditShopFee(actor, h.fees.get(id)), false); assert.equal(h.policy.canDeleteShopFee(actor, h.fees.get(id)), false);
  }
  console.log('PASS actual edit/delete handlers: anonymous/client denied before DB; employees cannot spoof another creator; paid/not-received incomes blocked for everyone with zero writes/audits and UI policy matches.');
  const h = createHarness(), original = { ...h.fees.get(1) };
  let r = await h.call('item', 'PATCH', { ...edit, status: '已到账', created_by: '老板', reviewed_by: '伪造', created_at: '伪造时间' }); assert.equal(r.status, 200);
  assert.equal(r.body.amount, 125); assert.equal(r.body.currency, 'THB'); assert.equal(r.body.note, '修改后'); assert.equal(r.body.screenshot, edit.screenshot);
  for (const field of ['fee_type', 'status', 'created_by', 'created_at', 'reviewed_by', 'reviewed_at', 'review_note']) assert.equal(r.body[field], original[field]);
  assert.equal(h.logs.length, 1); assert.deepEqual(h.logs[0].args.slice(0, 4), ['员工甲', '修改店铺收付款', 'shop_fee', '1']);
  for (const bad of [{ fee_type: '支出' }, { amount: 0 }, { amount: -1 }, { amount: 'bad' }, { business_type: '不存在' }, { currency: 'USD' }, { screenshot: '' }]) {
    const old = h.state(); assert.equal((await h.call('item', 'PATCH', { ...edit, ...bad })).status, 400); assert.equal(h.state(), old);
  }
  h.setActor({ role: 'admin', name: '老板' }); assert.equal((await h.call('item', 'PATCH', edit, 3)).status, 200);
  assert.equal(h.fees.get(3).created_by, '员工乙'); assert.equal(h.logs.length, 2);
  console.log('PASS five editable fields only, type immutable server-side, status/reviewer/creator/time untouched, allowed fields validated, admin can edit another creator and each success audits once.');
  for (const actor of [{ role: 'employee', name: '员工甲' }, { role: 'admin', name: '老板' }]) for (const id of [1, 2, ...(actor.role === 'admin' ? [3, 6] : [])]) {
    const h = createHarness(); h.setActor(actor); const files = [...h.fileBytes];
    assert.equal((await h.call('item', 'DELETE', null, id)).status, 200); assert(!h.fees.has(id)); assert.equal(h.logs.length, 1);
    assert.deepEqual(h.logs[0].args.slice(0, 4), [actor.name, '删除店铺收付款', 'shop_fee', String(id)]); assert.deepEqual([...h.fileBytes], files);
    assert.equal((await h.call('item', 'DELETE', null, id)).status, 404); assert.equal(h.logs.length, 1);
  }
  for (const method of ['PATCH', 'DELETE']) {
    const h = createHarness(); h.beforeTransaction(() => { h.fees.get(1).status = '已到账'; });
    assert.equal((await h.call('item', method, method === 'PATCH' ? edit : null)).status, 409); assert.equal(h.fees.get(1).amount, 100); assert.equal(h.logs.length, 0);
  }
  const review = createHarness(); assert.equal((await review.call('item', 'PATCH', { action: 'review', result: '已到账' })).status, 403);
  review.setActor({ role: 'admin', name: '老板' }); assert.equal((await review.call('item', 'PATCH', { action: 'review', result: '未到账' })).status, 400);
  assert.equal((await review.call('item', 'PATCH', { action: 'review', result: '未到账', note: '原因' })).status, 200);
  assert.equal((await review.call('item', 'PATCH', { action: 'review', result: '已到账' })).status, 200);
  console.log('PASS pending income/expense deletion and one audit, missing/repeated deletion is safe; status reread inside immediate write transaction rejects stale forms; original admin review/re-review and required reason retained.');
  const upload = createHarness();
  const heic = Buffer.alloc(24); heic.writeUInt32BE(24, 0); heic.write('ftypheic', 4); heic.write('mif1heic', 16);
  const formats = [['image/jpeg', 'test.jpg', Buffer.from([255,216,255,224])], ['image/png', 'test.png', Buffer.from([137,80,78,71,13,10,26,10])], ['image/webp', 'test.webp', Buffer.from('RIFF0000WEBP')], ['image/gif', 'test.gif', Buffer.from('GIF89a')], ['image/heic', 'test.heic', heic], ['image/heif', 'test.heif', heic]];
  for (const [type, name, bytes] of formats) {
    const r = await upload.upload(new File([bytes], name, { type })); assert.equal(r.status, 200, type);
    const filename = r.body.url.split('/').pop(), response = await upload.download(filename);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), type); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(upload.uploads.get(filename).mime_type, type);
  }
  const old = [...upload.uploads]; assert.equal((await upload.upload(new File(['plain text'], 'fake.heic', { type: 'image/heic' }))).status, 400);
  assert.equal((await upload.upload(new File(['plain text'], 'test.txt', { type: 'text/plain' }))).status, 400);
  assert.deepEqual([...upload.uploads], old);
  assert.equal((await upload.upload(new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'large.heic', { type: 'image/heic' }))).body.error, '文件不能超过 10MB');
  const png = new File([formats[1][2]], 'test.png', { type: 'image/png' }); assert.equal(await imageTypes.prepareShopScreenshot(png), png);
  const renamed = await imageTypes.prepareShopScreenshot(new File([formats[0][2]], 'PHONE.HEIC', { type: 'image/jpeg' })); assert.equal(renamed.name, 'PHONE.jpg');
  console.log('PASS actual upload/download handlers with simulated files/metadata: original four formats and HEIC/HEIF accepted, MIME and bytes preserved, forged/oversized files rejected; regular screenshots bypass conversion, phone auto-converted JPEG gets correct extension. Actual HEIC decoding is separately checked in browser.');
  for (const [type, name, bytes] of [
    ['application/pdf', 'test.pdf', Buffer.from('%PDF-1.7\nmock')],
    ['application/msword', 'test.doc', Buffer.from('mock doc')],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'test.docx', Buffer.from('PK mock docx')],
    ['application/vnd.ms-excel', 'test.xls', Buffer.from('mock xls')],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'test.xlsx', Buffer.from('PK mock xlsx')],
  ]) {
    const r = await upload.upload(new File([bytes], name, { type })); assert.equal(r.status, 200);
    const response = await upload.download(r.body.url.split('/').pop()); assert.equal(response.status, 200); assert.equal(response.headers.get('Content-Type'), type); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  }
  upload.setActor({ id: 9, role: 'client', name: '客户' });
  const clientUpload = await upload.upload(new File([formats[1][2]], 'own.png', { type: 'image/png' })); assert.equal(clientUpload.status, 200);
  assert.equal((await upload.download(clientUpload.body.url.split('/').pop())).status, 200);
  assert.equal((await upload.download([...upload.uploads.keys()][0])).status, 403);
  console.log('PASS existing document MIME/byte handling and customer upload/file-visibility checks unchanged (simulated files only; document fixtures exercise routing, not document rendering).');
}
module.exports = { createHarness, makeFee };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
