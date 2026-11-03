/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 代理记账（2026-11-03）内部系统这一半：真的路由处理函数 + 真的令牌 + 临时目录合成库 + 假的业务系统（本机 http）。
 * 不连外部地址，不读项目 .env（INTERNAL_APP_ROOT 指到临时目录）。
 * Run (from this repo): env -u NODE_ENV -u DB_PATH node --import /Users/liuyujiang/湘泰业务网站/node_modules/tsx/dist/loader.mjs scripts/test-agent-rebates.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const repo = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xt-agent-rebates-'));
const SECRET = 'agent-rebates-sync-secret';
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const stubPort = await freePort();

// 假的业务系统：mode 决定它怎么回
type Account = { id: string; name: string; login: string; status: string; password: string };
const stub = { mode: 'ok' as 'ok' | 'down' | '500', accounts: new Map<string, Account>(), calls: [] as { method: string; url: string; auth: string; body: any }[], occupied: new Set(['taken-by-customer']) };
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
  stub.calls.push({ method: req.method || '', url: req.url || '', auth: String(req.headers.authorization || ''), body });
  if (stub.mode === 'down') { req.socket.destroy(); return; }
  const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (stub.mode === '500') return send(500, { error: 'boom' });
  const view = (a: Account) => ({ id: a.id, name: a.name, login: a.login, status: a.status });
  if (req.method === 'POST' && req.url === '/api/sync/agents') {
    const login = /^[\d\s-]+$/.test(body.login) ? String(body.login).replace(/[\s-]/g, '') : String(body.login);
    if (stub.occupied.has(login)) return send(409, { error: '这个登录名已被占用，换一个' });
    let account = [...stub.accounts.values()].find(a => a.login.toLowerCase() === login.toLowerCase());
    if (account) Object.assign(account, { name: body.name, password: body.password, status: 'active' });
    else { account = { id: `acct-${stub.accounts.size + 1}`, name: body.name, login, status: 'active', password: body.password }; stub.accounts.set(account.id, account); }
    return send(200, view(account));
  }
  const m = /^\/api\/sync\/agents\/([^/]+)$/.exec(req.url || '');
  if (req.method === 'PATCH' && m) {
    const account = stub.accounts.get(decodeURIComponent(m[1]));
    if (!account) return send(404, { error: '不是代理账号' });
    Object.assign(account, body);
    return send(200, view(account));
  }
  send(404, { error: 'not in fixture' });
});
await new Promise<void>(r => server.listen(stubPort, '127.0.0.1', () => r()));

Object.assign(process.env, { NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', INTERNAL_APP_ROOT: dir, DB_PATH: path.join(dir, 'internal.db'), SYNC_SECRET: SECRET, JWT_SECRET: 'agent-rebates-jwt', CUSTOMER_SYNC_URL: `http://127.0.0.1:${stubPort}` });
delete process.env.COMMERCE_PILOT;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  assert.equal(url.host, `127.0.0.1:${stubPort}`, `blocked network call to ${url.host}`);
  return realFetch(input, init);
}) as typeof fetch;

const { GET: agentOptionsGET } = await import('../src/app/api/agents/options/route');
const { GET: auditLogsGET } = await import('../src/app/api/audit-logs/route');
const { GET: workReportAutoGET } = await import('../src/app/api/work-reports/auto/route');
const [agentsRoute, agentRoute, rebatesRoute, orderRebateRoute, paidRoute, syncRoute, ordersRoute, orderRoute, lib, { getDb }, { signToken }, { renumberOrder }] = await Promise.all([
  import('../src/app/api/agents/route'), import('../src/app/api/agents/[id]/route'), import('../src/app/api/agent-rebates/route'),
  import('../src/app/api/orders/[id]/agent-rebate/route'), import('../src/app/api/orders/[id]/agent-rebate/paid/route'), import('../src/app/api/sync/agent-orders/route'),
  import('../src/app/api/orders/route'), import('../src/app/api/orders/[id]/route'), import('../src/lib/agents'),
  import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/order-renumber'),
]);
const db = getDb();
assert(db.name.startsWith(dir), `synthetic database only, got ${db.name}`);
db.prepare('UPDATE employees SET must_change_password=0').run();

const identity = async (name: string, role: string, email = `${name}@test.invalid`) => {
  const id = Number(db.prepare("INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES (?,?,?,?,0,0)").run(name, email, role, 'unused').lastInsertRowid);
  return signToken({ id, name, role, auth_version: 0, must_change_password: 0 });
};
const tokens = { admin: await identity('管理员甲', 'admin'), staff: await identity('员工甲', 'employee'), client: await identity('客户甲', 'client'), twin: await identity('管理员甲', 'employee', 'twin@test.invalid') };
type Who = keyof typeof tokens | null;

async function call(handler: (req: NextRequest, ctx: any) => Promise<Response>, who: Who, method: string, url: string, body?: unknown, id?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  const req = new NextRequest(`http://internal.invalid${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve({ id: id ?? '' }) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}
async function sync(agentId: string | null, secret: string | null = SECRET) {
  const headers: Record<string, string> = {};
  if (secret) headers.authorization = `Bearer ${secret}`;
  const url = agentId === null ? 'http://internal.invalid/api/sync/agent-orders' : `http://internal.invalid/api/sync/agent-orders?agent_id=${encodeURIComponent(agentId)}`;
  const res = await syncRoute.GET(new NextRequest(url, { headers }));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text), text };
}
const admin = {
  put: (id: string, body: unknown) => call(orderRebateRoute.PUT, 'admin', 'PUT', `/api/orders/${id}/agent-rebate`, body, id),
  del: (id: string) => call(orderRebateRoute.DELETE, 'admin', 'DELETE', `/api/orders/${id}/agent-rebate`, undefined, id),
  get: (id: string) => call(orderRebateRoute.GET, 'admin', 'GET', `/api/orders/${id}/agent-rebate`, undefined, id),
  paid: (id: string, paid: unknown) => call(paidRoute.POST, 'admin', 'POST', `/api/orders/${id}/agent-rebate/paid`, { paid }, id),
  newAgent: (body: unknown) => call(agentsRoute.POST, 'admin', 'POST', '/api/agents', body),
  patchAgent: (id: string, body: unknown) => call(agentRoute.PATCH, 'admin', 'PATCH', `/api/agents/${id}`, body, id),
  list: () => call(agentsRoute.GET, 'admin', 'GET', '/api/agents'),
  rows: (agentId: string) => call(rebatesRoute.GET, 'admin', 'GET', `/api/agent-rebates?agent_id=${encodeURIComponent(agentId)}`),
};

const BT = Object.fromEntries((db.prepare('SELECT id, name FROM business_types').all() as { id: number; name: string }[]).map(b => [b.name, b.id]));
assert(BT['待分类'] && BT['公司注册'] && BT['FDA认证'] && BT['清关'], 'seeded business types');
let seq = 0;
function makeOrder(over: Partial<{ id: string; status: string; customer: string; bt: number; sub: string; createdAt: string }> = {}) {
  const id = over.id ?? `ORD-TEST-${++seq}`;
  const at = over.createdAt ?? new Date(Date.UTC(2026, 10, 1, 0, seq)).toISOString();
  db.prepare(`INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, address_type, status, responsible_person, description, total_amount, currency, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'client', ?, 'RESPONSIBLE_SECRET', 'DESCRIPTION_SECRET', 88888.77, 'CNY', ?, ?)`).run(id, over.customer ?? '客户群一', over.bt ?? BT['公司注册'], over.sub ?? '', over.status ?? '进行中', at, at);
  return id;
}
const setStatus = (id: string, status: string) => db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
function inbox(source: string, line: number, copy: number, orderId: string) {
  db.prepare(`INSERT INTO sync_inbox (id, source_order_no, line_no, copy_no, sku_code, internal_order_id, note, payload) VALUES (?, ?, ?, ?, 'SKU', ?, '', '{}')`)
    .run(`IN-${source}-${line}-${copy}`, source, line, copy, orderId);
}
const results: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  results.push(name);
  console.log(`ok - ${name}`);
}

// 三个代理
const agentA = (await admin.newAgent({ name: '代理甲', login: 'daili-a', password: 'secret-a1' })).json.agent;
const agentB = (await admin.newAgent({ name: '代理乙', login: '081-234 5678', password: 'secret-b1' })).json.agent;
const agentC = (await admin.newAgent({ name: '代理丙', login: 'daili-c', password: 'secret-c1' })).json.agent;
assert(agentA?.account_id && agentB?.account_id && agentC?.account_id, 'three agents created');

try {
  await test('只给管理员的接口：没登录 401、员工 403、客户 403、管理员放行', async () => {
    const orderId = makeOrder();
    const routes: [string, (who: Who) => Promise<{ status: number }>, number][] = [
      ['GET agents', w => call(agentsRoute.GET, w, 'GET', '/api/agents'), 200],
      ['POST agents', w => call(agentsRoute.POST, w, 'POST', '/api/agents', { name: '权限测试', login: `perm-${w}`, password: 'secret-1' }), 200],
      ['PATCH agents/:id', w => call(agentRoute.PATCH, w, 'PATCH', `/api/agents/${agentC.account_id}`, { name: '代理丙' }, agentC.account_id), 200],
      ['GET agent-rebates', w => call(rebatesRoute.GET, w, 'GET', `/api/agent-rebates?agent_id=${agentA.account_id}`), 200],
      ['PUT orders/:id/agent-rebate', w => call(orderRebateRoute.PUT, w, 'PUT', `/api/orders/${orderId}/agent-rebate`, { agent_account_id: agentC.account_id, rebate: 1 }, orderId), 200],
      ['POST .../paid', w => call(paidRoute.POST, w, 'POST', `/api/orders/${orderId}/agent-rebate/paid`, { paid: false }, orderId), 200],
      ['DELETE orders/:id/agent-rebate', w => call(orderRebateRoute.DELETE, w, 'DELETE', `/api/orders/${orderId}/agent-rebate`, undefined, orderId), 200],
    ];
    for (const [name, run, ok] of routes) {
      assert.equal((await run(null)).status, 401, `${name} anonymous`);
      assert.equal((await run('staff')).status, 403, `${name} employee`);
      assert.equal((await run('client')).status, 403, `${name} client`);
      assert.equal((await run('admin')).status, ok, `${name} admin`);
    }
    const before = db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number };
    assert.equal((await call(agentsRoute.POST, 'staff', 'POST', '/api/agents', { name: 'x', login: 'staff-try', password: 'secret-1' })).status, 403);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n, before.n, 'employee creates nothing');
  });

  await test('同步接口：没密钥 401、错密钥 401、缺 agent_id 400、超长 400、不认识的代理空列表 200', async () => {
    assert.equal((await sync(agentA.account_id, null)).status, 401);
    assert.equal((await sync(agentA.account_id, 'x'.repeat(SECRET.length))).status, 401);
    assert.equal((await sync(null)).status, 400);
    assert.equal((await sync('x'.repeat(65))).status, 400);
    const none = await sync('nobody');
    assert.equal(none.status, 200);
    assert.deepEqual(none.json, { agent_id: 'nobody', orders: [], totals: { waiting_cents: 0, earned_cents: 0, paid_cents: 0 } });
  });

  await test('金额：只收大于 0、最多两位小数、不超过上限；按整数分算', () => {
    for (const [input, cents] of [[0.01, 1], ['0.01', 1], [1.1, 110], ['1.10', 110], [100, 10000], ['99999999.99', 9999999999], [19.99, 1999], [1.15, 115], [' 8.5 ', 850]] as [unknown, number][]) {
      assert.equal(lib.parseRebateCents(input), cents, `accepts ${input}`);
    }
    for (const bad of [0, '0', '0.00', -1, '-1', '-0.01', '1.234', 1.234, '100000000', 100000000, '99999999.999', 'abc', '', ' ', '1e3', '1,000', '+5', NaN, Infinity, null, undefined, true, {}, []]) {
      assert.equal(lib.parseRebateCents(bad), null, `rejects ${String(bad)}`);
    }
  });

  await test('订单状态对照：待确认、已确认、办理中、已完成、已取消、其它', async () => {
    assert.equal(lib.agentStatusLabel('待处理', true), '待确认');
    assert.equal(lib.agentStatusLabel('待处理', false), '已确认');
    assert.equal(lib.agentStatusLabel('进行中', false), '办理中');
    assert.equal(lib.agentStatusLabel('已完成', false), '已完成');
    assert.equal(lib.agentStatusLabel('客户取消', false), '已取消');
    assert.equal(lib.agentStatusLabel('阻塞', false), '办理中');
    // 走真接口：客户站来的单没确认是待确认，确认后是已确认
    const id = makeOrder({ status: '待处理' });
    inbox('SRC-CONFIRM', 1, 1, id);
    db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status) VALUES (?, '第一步', 1, '待处理')").run(id);
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '10' })).status, 200);
    const label = async () => (await sync(agentC.account_id)).json.orders.find((o: any) => o.key === id).status_label;
    assert.equal(await label(), '待确认');
    db.prepare("INSERT INTO sync_order_confirmations (source_order_no, confirmed_by) VALUES ('SRC-CONFIRM', '管理员甲')").run();
    assert.equal(await label(), '已确认');
    const inner = makeOrder({ status: '待处理' });
    assert.equal((await admin.put(inner, { agent_account_id: agentC.account_id, rebate: '10' })).status, 200);
    assert.equal((await sync(agentC.account_id)).json.orders.find((o: any) => o.key === inner).status_label, '已确认', 'order created internally is not awaiting');
    for (const o of [id, inner]) assert.equal((await admin.del(o)).status, 200);
  });

  await test('状态变化：等办完 → 可拿 → 已付 → 撤回或取消标红 → 重新办完恢复已付', async () => {
    const id = makeOrder({ status: '进行中' });
    const put = await admin.put(id, { agent_account_id: agentC.account_id, rebate: '100.50' });
    assert.equal(put.status, 200);
    assert.equal(put.json.rebate.rebate_cents, 10050);
    const agentView = async () => { const s = (await sync(agentC.account_id)).json; return { state: s.orders.find((o: any) => o.key === id)?.rebate_state, totals: s.totals }; };
    const adminRow = async () => (await admin.rows(agentC.account_id)).json.rows.find((r: any) => r.order_id === id);
    const adminSum = async () => (await admin.list()).json.agents.find((a: any) => a.account_id === agentC.account_id);

    assert.equal((await agentView()).state, 'waiting');
    assert.equal((await agentView()).totals.waiting_cents, 10050);
    assert.equal((await admin.paid(id, true)).status, 409, 'paid only when completed');
    assert.equal((await admin.paid(id, 'yes')).status, 400, 'paid must be boolean');
    assert.equal((await adminRow()).paid_at, null);

    setStatus(id, '已完成');
    assert.equal((await agentView()).state, 'earned');
    assert.equal((await agentView()).totals.earned_cents, 10050);
    assert.equal((await adminSum()).earned_cents, 10050);

    assert.equal((await admin.paid(id, true)).status, 200);
    const paidAt = (await adminRow()).paid_at;
    assert(paidAt);
    assert.equal((await agentView()).state, 'paid');
    assert.deepEqual((await agentView()).totals, { waiting_cents: 0, earned_cents: 0, paid_cents: 10050 });
    assert.equal((await adminSum()).paid_cents, 10050);
    assert.equal((await admin.paid(id, true)).status, 200, 'clicking twice is harmless');
    assert.equal((await adminRow()).paid_at, paidAt, 'second click keeps the first time');

    setStatus(id, '进行中');
    assert.equal((await agentView()).state, 'waiting');
    assert.deepEqual((await agentView()).totals, { waiting_cents: 10050, earned_cents: 0, paid_cents: 0 }, 'agent: not in paid total');
    let row = await adminRow();
    assert.equal(row.paid_anomaly, true);
    assert.equal(row.rebate_state, 'waiting');
    assert.equal((await adminSum()).anomaly_cents, 10050);
    assert.equal((await adminSum()).paid_cents, 0);
    assert.equal((await adminSum()).waiting_cents, 0, 'admin: flagged money is listed once');
    assert.equal((await admin.get(id)).json.rebate.paid_anomaly, true);

    setStatus(id, '客户取消');
    assert.equal((await agentView()).state, 'void');
    assert.deepEqual((await agentView()).totals, { waiting_cents: 0, earned_cents: 0, paid_cents: 0 });
    row = await adminRow();
    assert.equal(row.rebate_state, 'void');
    assert.equal(row.paid_anomaly, true);
    assert.equal((await adminSum()).anomaly_cents, 10050);

    setStatus(id, '已完成');
    assert.equal((await agentView()).state, 'paid', 'back to paid after re-completion');
    row = await adminRow();
    assert.equal(row.paid_anomaly, false);
    assert.equal((await adminSum()).anomaly_cents, 0);
    assert.equal((await adminSum()).paid_cents, 10050);

    assert.equal((await admin.paid(id, false)).status, 200);
    assert.equal((await agentView()).state, 'earned', 'revoking goes back to earned');
    // 没付的单取消：不算，也不标红
    setStatus(id, '客户取消');
    assert.equal((await agentView()).state, 'void');
    assert.equal((await adminRow()).paid_anomaly, false);
    assert.equal((await admin.paid(id, false)).status, 200);
    assert.equal((await admin.del(id)).status, 200);
    const empty = makeOrder({ status: '已完成' });
    assert.equal((await admin.paid(empty, true)).status, 409, 'paid needs a rebate');
    assert.equal((await admin.paid(empty, false)).status, 200, 'revoking nothing is a no-op');
  });

  await test('已付的单：改金额、换代理、解除、删单都要先撤销；撤销后删单连返点一起删', async () => {
    const id = makeOrder({ status: '已完成' });
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '20' })).status, 200);
    assert.equal((await admin.paid(id, true)).status, 200);
    for (const [name, r] of [
      ['edit', await admin.put(id, { agent_account_id: agentC.account_id, rebate: '30' })],
      ['change agent', await admin.put(id, { agent_account_id: agentB.account_id, rebate: '20' })],
      ['detach', await admin.del(id)],
    ] as [string, { status: number; json: any }][]) {
      assert.equal(r.status, 409, name);
      assert.equal(r.json.error, '请先撤销已付', name);
    }
    const del = await call(orderRoute.DELETE, 'admin', 'DELETE', `/api/orders/${id}`, undefined, id);
    assert.equal(del.status, 409);
    assert(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(id), 'paid order not deleted');
    const row = db.prepare('SELECT agent_account_id, rebate_cents FROM agent_rebates WHERE order_id = ?').get(id) as any;
    assert.deepEqual({ ...row }, { agent_account_id: agentC.account_id, rebate_cents: 2000 }, 'nothing changed');
    // 标红的单同样锁着
    setStatus(id, '进行中');
    assert.equal((await admin.del(id)).status, 409, 'anomaly still locked');
    setStatus(id, '已完成');
    assert.equal((await admin.paid(id, false)).status, 200);
    assert.equal((await call(orderRoute.DELETE, 'admin', 'DELETE', `/api/orders/${id}`, undefined, id)).status, 200);
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(id), undefined, 'unpaid rebate deleted with the order');
    // 没付的单直接删
    const other = makeOrder();
    assert.equal((await admin.put(other, { agent_account_id: agentC.account_id, rebate: '5' })).status, 200);
    assert.equal((await call(orderRoute.DELETE, 'admin', 'DELETE', `/api/orders/${other}`, undefined, other)).status, 200);
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(other), undefined);
  });

  await test('挂、换、改：订单没了 409，金额不对 400，代理不存在 409', async () => {
    assert.equal((await admin.put('NOPE', { agent_account_id: agentC.account_id, rebate: '5' })).status, 409);
    assert.equal((await admin.put('NOPE', { agent_account_id: agentC.account_id, rebate: '5' })).json.error, '这张单编号变了，请刷新');
    assert.equal((await admin.del('NOPE')).status, 409);
    assert.equal((await admin.paid('NOPE', true)).status, 409);
    const id = makeOrder();
    for (const rebate of [0, -1, '1.234', '100000000', 'abc', null]) assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate })).status, 400, `rebate ${rebate}`);
    assert.equal((await admin.put(id, { rebate: '5' })).status, 400);
    assert.equal((await admin.put(id, { agent_account_id: 'nobody', rebate: '5' })).status, 409);
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(id), undefined);
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '5' })).status, 200);
    assert.equal((await admin.put(id, { agent_account_id: agentB.account_id, rebate: '6' })).status, 200);
    assert.equal((await sync(agentC.account_id)).json.orders.some((o: any) => o.key === id), false, 'old agent loses it at once');
    assert.equal((await sync(agentB.account_id)).json.orders.find((o: any) => o.key === id).rebate_cents, 600);
    assert.equal((await admin.del(id)).status, 200);
    assert.equal((await sync(agentB.account_id)).json.orders.some((o: any) => o.key === id), false);
    assert.equal((await admin.del(id)).status, 200, 'detaching twice is a no-op');
    assert.equal((await call(orderRebateRoute.GET, 'admin', 'GET', '/api/orders/NOPE/agent-rebate', undefined, 'NOPE')).status, 404);
  });

  await test('停用的代理：不能新挂、不在可选列表；已挂的还能改金额、点已付', async () => {
    const id = makeOrder({ status: '已完成' });
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '7' })).status, 200);
    const stop = await admin.patchAgent(agentC.account_id, { status: 'disabled' });
    assert.equal(stop.status, 200);
    assert.equal(stop.json.agent.status, 'disabled');
    assert.equal(stub.accounts.get(agentC.account_id)!.status, 'disabled');
    const fresh = makeOrder();
    assert.equal((await admin.put(fresh, { agent_account_id: agentC.account_id, rebate: '7' })).status, 409, 'disabled cannot be newly attached');
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(fresh), undefined);
    assert.equal((await admin.put(id, { agent_account_id: agentB.account_id, rebate: '8' })).status, 200, 'moving away from a disabled agent is allowed');
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '8' })).status, 409, 'cannot move onto a disabled agent');
    await admin.patchAgent(agentC.account_id, { status: 'active' });
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '8' })).status, 200);
    await admin.patchAgent(agentC.account_id, { status: 'disabled' });
    const offered = (await admin.get(fresh)).json.agents.map((a: any) => a.account_id);
    assert(!offered.includes(agentC.account_id), 'disabled not in the active list');
    assert(offered.includes(agentA.account_id));
    assert.deepEqual(Object.keys((await admin.get(fresh)).json.agents[0]).sort(), ['account_id', 'name']);
    assert.equal((await admin.put(id, { agent_account_id: agentC.account_id, rebate: '9' })).status, 200, 'same agent amount edit allowed while disabled');
    assert.equal((await admin.get(id)).json.rebate.rebate_cents, 900);
    assert.equal((await admin.paid(id, true)).status, 200, 'records stay payable');
    assert.equal((await admin.paid(id, false)).status, 200);
    assert.equal((await admin.rows(agentC.account_id)).json.rows.some((r: any) => r.order_id === id), true, 'rows stay visible');
    await admin.patchAgent(agentC.account_id, { status: 'active' });
    assert.equal((await admin.del(id)).status, 200);
  });

  await test('PATCH 代理：业务系统失败内部一点不变；校验不过不去调业务系统', async () => {
    const row = () => ({ ...(db.prepare('SELECT * FROM agents WHERE account_id = ?').get(agentA.account_id) as object) });
    const before = row();
    for (const mode of ['down', '500'] as const) {
      stub.mode = mode;
      for (const body of [{ status: 'disabled' }, { password: 'newsecret1' }, { name: '新名字' }]) {
        const r = await admin.patchAgent(agentA.account_id, body);
        assert.equal(r.status, 502, `${mode} ${JSON.stringify(body)}`);
        assert.equal(r.json.error, '没成功，再点一次');
        assert.deepEqual(row(), before, 'internal unchanged');
      }
    }
    stub.mode = 'ok';
    // 业务系统说这不是代理账号（404）：同样不改
    db.prepare("INSERT INTO agents (account_id, name, login, status) VALUES ('ghost', '幽灵', 'ghost', 'active')").run();
    const ghost = await admin.patchAgent('ghost', { status: 'disabled' });
    assert.equal(ghost.status, 404);
    assert.equal((db.prepare("SELECT status FROM agents WHERE account_id='ghost'").get() as any).status, 'active');
    db.prepare("DELETE FROM agents WHERE account_id='ghost'").run();

    const calls = stub.calls.length;
    for (const body of [{}, { status: 'frozen' }, { password: '12345' }, { password: 'x'.repeat(73) }, { name: '' }, { name: 'x'.repeat(51) }]) {
      assert.equal((await admin.patchAgent(agentA.account_id, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await admin.patchAgent('nobody', { status: 'disabled' })).status, 404);
    assert.equal(stub.calls.length, calls, 'invalid input never reaches the customer site');

    const reset = await admin.patchAgent(agentA.account_id, { password: 'newsecret2' });
    assert.equal(reset.status, 200);
    assert.equal(stub.accounts.get(agentA.account_id)!.password, 'newsecret2');
    assert.equal(JSON.stringify(reset.json).includes('newsecret2'), false, 'password not echoed');
    const renamed = await admin.patchAgent(agentA.account_id, { name: '代理甲改' });
    assert.equal((db.prepare('SELECT name FROM agents WHERE account_id = ?').get(agentA.account_id) as any).name, '代理甲改');
    assert.equal(renamed.json.agent.name, '代理甲改');
    await admin.patchAgent(agentA.account_id, { name: '代理甲' });
    assert(stub.calls.every(c => c.auth === `Bearer ${SECRET}`), 'always with the sync secret');
  });

  await test('POST 代理：内部查重 409、业务系统占用 409、连不上 502 且没记、重试认回、不存密码', async () => {
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n;
    const n = count();
    const calls = stub.calls.length;
    for (const login of ['daili-a', 'DAILI-A', ' Daili-A ', '0812345678', '081 234 5678', '081-234-5678']) {
      const r = await admin.newAgent({ name: '重复', login, password: 'secret-1' });
      assert.equal(r.status, 409, login);
      assert.equal(r.json.error, '这个登录名已被占用，换一个');
    }
    assert.equal(stub.calls.length, calls, 'duplicates stop before the customer site');
    const occupied = await admin.newAgent({ name: '撞号', login: 'taken-by-customer', password: 'secret-1' });
    assert.equal(occupied.status, 409);
    assert.equal(occupied.json.error, '这个登录名已被占用，换一个');
    for (const mode of ['down', '500'] as const) {
      stub.mode = mode;
      const r = await admin.newAgent({ name: '连不上', login: `retry-login`, password: 'secret-1' });
      assert.equal(r.status, 502, mode);
      assert.equal(r.json.error, '业务系统连不上，没开成，再点一次');
      assert.equal(count(), n, 'no row');
    }
    stub.mode = 'ok';
    for (const body of [{ login: 'x', password: 'secret-1' }, { name: 'x'.repeat(51), login: 'x', password: 'secret-1' }, { name: 'x', password: 'secret-1' }, { name: 'x', login: 'x', password: '12345' }, { name: 'x', login: 'x', password: 'y'.repeat(73) }]) {
      assert.equal((await admin.newAgent(body)).status, 400, JSON.stringify(body));
    }
    // 上次超时：业务系统那边建好了，内部没记。再点一次认回同一个账号
    stub.accounts.set('acct-timeout', { id: 'acct-timeout', name: '旧名字', login: 'timed-out', status: 'disabled', password: 'old' });
    const retry = await admin.newAgent({ name: '超时代理', login: 'timed-out', password: 'secret-new' });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.json.agent, { account_id: 'acct-timeout', name: '超时代理', login: 'timed-out', status: 'active' });
    assert.equal(stub.accounts.get('acct-timeout')!.password, 'secret-new');
    const stored = db.prepare("SELECT * FROM agents WHERE account_id='acct-timeout'").get() as Record<string, unknown>;
    assert.equal(stored.created_by, '管理员甲');
    assert.deepEqual(Object.keys(stored).sort(), ['account_id', 'created_at', 'created_by', 'login', 'name', 'status'], 'no password column');
    assert(!JSON.stringify(db.prepare("SELECT * FROM audit_logs WHERE target_type='agent'").all()).includes('secret-'), 'password not in the audit log');
    const list = (await admin.list()).json.agents;
    assert.deepEqual(Object.keys(list[0]).sort(), ['account_id', 'anomaly_cents', 'created_at', 'earned_cents', 'login', 'name', 'order_count', 'paid_cents', 'status', 'unfilled_count', 'waiting_cents']);
    assert(list.some((a: any) => a.account_id === 'acct-timeout'));
    assert.equal(JSON.stringify(list).includes('password'), false);
  });

  await test('同步返回：字段不多不少，金额、负责人、经办人、内部步骤名、备注都不出去', async () => {
    const id = makeOrder({ status: '进行中', customer: '群名ABC' });
    const step = db.prepare('INSERT INTO order_steps (order_id, step_name, step_order, status, assignee, notes, public_name) VALUES (?, ?, ?, ?, ?, ?, ?)');
    step.run(id, 'INTERNAL_STEP_ONE', 1, '已完成', 'ASSIGNEE_SECRET', 'NOTE_SECRET', '对外第一步');
    step.run(id, 'INTERNAL_STEP_TWO', 2, '进行中', 'ASSIGNEE_SECRET', 'NOTE_SECRET', '对外第二步');
    assert.equal((await admin.put(id, { agent_account_id: agentA.account_id, rebate: '321.45' })).status, 200);
    const r = await sync(agentA.account_id);
    assert.deepEqual(Object.keys(r.json).sort(), ['agent_id', 'orders', 'totals']);
    assert.deepEqual(Object.keys(r.json.totals).sort(), ['earned_cents', 'paid_cents', 'waiting_cents']);
    const order = r.json.orders.find((o: any) => o.key === id);
    assert.deepEqual(Object.keys(order).sort(), ['business_name', 'created_at', 'customer_name', 'key', 'order_no', 'part', 'parts', 'rebate_cents', 'rebate_state', 'status_label', 'steps'].sort());
    assert.equal(order.customer_name, '群名ABC');
    assert.equal(order.order_no, id);
    assert.equal(order.rebate_cents, 32145);
    assert.equal(order.part, null);
    assert.equal(order.parts, null);
    assert.deepEqual(order.steps, [
      { step_order: 1, step_name: '对外第一步', status: '已完成' },
      { step_order: 2, step_name: '对外第二步', status: '进行中' },
    ]);
    for (const secret of ['total_amount', '88888', 'responsible_person', 'RESPONSIBLE_SECRET', 'assignee', 'ASSIGNEE_SECRET', 'INTERNAL_STEP', 'notes', 'NOTE_SECRET', 'DESCRIPTION_SECRET', 'description', 'paid_at', 'paid_by', 'created_by', 'agent_account_id']) {
      assert.equal(r.text.includes(secret), false, `leaks ${secret}`);
    }
    // 有统一文案的步骤带说明（跟回传给客户的同一份）
    const copied = makeOrder({ bt: BT['公司注册'], sub: 'company-reg' });
    step.run(copied, '方案确认', 1, '待处理', 'ASSIGNEE_SECRET', 'NOTE_SECRET', null);
    const expected = (await import('../src/lib/step-public-copy')).customerStepView({ business_type_id: BT['公司注册'], sub_service_type: 'company-reg', address_type: 'client' }, [{ step_name: '方案确认', public_name: null }])[0];
    assert.equal((await admin.put(copied, { agent_account_id: agentA.account_id, rebate: '1' })).status, 200);
    const copiedStep = (await sync(agentA.account_id)).json.orders.find((o: any) => o.key === copied).steps[0];
    assert.equal(copiedStep.step_name, expected.name);
    if (expected.description) assert.equal(copiedStep.description, expected.description);
    else assert.equal('description' in copiedStep, false);
    for (const o of [id, copied]) assert.equal((await admin.del(o)).status, 200);
  });

  await test('待分类显示业务确认中；分好后显示真实业务；有具体服务显示具体服务名', async () => {
    const id = makeOrder({ bt: BT['待分类'], sub: 'storefront-unclassified' });
    assert.equal((await admin.put(id, { agent_account_id: agentA.account_id, rebate: '3' })).status, 200);
    const name = async () => (await sync(agentA.account_id)).json.orders.find((o: any) => o.key === id).business_name;
    assert.equal(await name(), '业务确认中');
    assert.equal((await admin.rows(agentA.account_id)).json.rows.find((r: any) => r.order_id === id).business_name, '业务确认中');
    assert.equal((await sync(agentA.account_id)).text.includes('待分类'), false);
    db.prepare("UPDATE orders SET business_type_id = ?, sub_service_type = '' WHERE id = ?").run(BT['清关'], id);
    assert.equal(await name(), '清关');
    const { subServices } = await import('../src/lib/constants');
    const option = subServices[BT['FDA认证']][0];
    db.prepare('UPDATE orders SET business_type_id = ?, sub_service_type = ? WHERE id = ?').run(BT['FDA认证'], option.key, id);
    assert.equal(await name(), option.label);
    assert.equal((await admin.del(id)).status, 200);
  });

  await test('拆单：同来源同业务才标第几份，只数自己名下的；各算各的，合计不重复；A 看不到 B', async () => {
    const [one, two, three, otherBiz, others, solo] = [makeOrder(), makeOrder(), makeOrder(), makeOrder({ bt: BT['清关'] }), makeOrder(), makeOrder()];
    inbox('SRC-SPLIT', 1, 1, one);
    inbox('SRC-SPLIT', 1, 2, two);
    inbox('SRC-SPLIT', 2, 1, otherBiz);
    inbox('SRC-SPLIT', 3, 1, others);
    inbox('SRC-SPLIT', 4, 1, three);
    inbox('SRC-SPLIT', 5, 1, three); // 一张内部单对两行商品：不能算两次
    inbox('SRC-SOLO', 1, 1, solo);
    const cleanA = (await sync(agentA.account_id)).json;
    assert.deepEqual(cleanA.orders, [], 'agent A starts empty');
    for (const [order, cents] of [[one, 100], [two, 200], [otherBiz, 400]] as [string, number][]) assert.equal((await admin.put(order, { agent_account_id: agentA.account_id, rebate: cents / 100 })).status, 200);
    assert.equal((await admin.put(others, { agent_account_id: agentB.account_id, rebate: 8 })).status, 200);
    assert.equal((await admin.put(solo, { agent_account_id: agentA.account_id, rebate: 16 })).status, 200);
    const r = (await sync(agentA.account_id)).json;
    const of = (id: string) => r.orders.find((o: any) => o.key === id);
    assert.deepEqual([of(one).part, of(one).parts], [1, 2]);
    assert.deepEqual([of(two).part, of(two).parts], [2, 2], 'other agent\'s copy is not counted');
    assert.deepEqual([of(otherBiz).part, of(otherBiz).parts], [null, null], 'only copy of its business');
    assert.deepEqual([of(solo).part, of(solo).parts], [null, null]);
    assert.equal(of(one).order_no, 'SRC-SPLIT');
    assert.equal(of(two).order_no, 'SRC-SPLIT');
    assert.equal(r.totals.waiting_cents, 100 + 200 + 400 + 1600, 'each counted once');
    assert.equal(r.orders.length, 4);
    // 名下那张单对两行商品：还是一行、一笔
    assert.equal((await admin.put(three, { agent_account_id: agentA.account_id, rebate: 32 })).status, 200);
    const again = (await sync(agentA.account_id)).json;
    assert.equal(again.orders.filter((o: any) => o.key === three).length, 1);
    assert.equal(again.totals.waiting_cents, 100 + 200 + 400 + 1600 + 3200);
    assert.deepEqual(again.orders.filter((o: any) => [one, two, three].includes(o.key)).map((o: any) => o.parts), [3, 3, 3]);
    const sum = (await admin.list()).json.agents.find((a: any) => a.account_id === agentA.account_id);
    assert.equal(sum.order_count, 5);
    assert.equal(sum.waiting_cents, 100 + 200 + 400 + 1600 + 3200);
    const adminRows = (await admin.rows(agentA.account_id)).json.rows;
    assert.equal(adminRows.length, 5);
    assert.deepEqual(Object.keys(adminRows[0]).sort(), ['business_name', 'customer_name', 'order_id', 'order_no', 'paid_anomaly', 'paid_at', 'part', 'parts', 'rebate_cents', 'rebate_state', 'status_label']);
    // A、B 互相看不到
    const b = await sync(agentB.account_id);
    assert.deepEqual(b.json.orders.map((o: any) => o.key), [others]);
    assert.equal(b.json.totals.waiting_cents, 800);
    for (const order of [one, two, three, otherBiz, solo]) assert.equal(b.text.includes(order), false);
    assert.equal((await sync(agentA.account_id)).text.includes(others), false);
    assert.equal(JSON.stringify((await admin.rows(agentB.account_id)).json).includes(one), false);
    assert.equal(JSON.stringify((await admin.rows(agentA.account_id)).json).includes(others), false);
    for (const order of [one, two, three, otherBiz, others, solo]) assert.equal((await admin.del(order)).status, 200);
  });

  await test('推单改号：返点跟着新编号走，已付记录不丢', async () => {
    const oldId = makeOrder({ status: '已完成' });
    assert.equal((await admin.put(oldId, { agent_account_id: agentA.account_id, rebate: '11.11' })).status, 200);
    assert.equal((await admin.paid(oldId, true)).status, 200);
    const newId = 'ORD20261103NEW1';
    db.transaction(() => renumberOrder(db, oldId, newId))();
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(oldId), undefined);
    const moved = db.prepare('SELECT agent_account_id, rebate_cents, paid_at FROM agent_rebates WHERE order_id = ?').get(newId) as any;
    assert.equal(moved.agent_account_id, agentA.account_id);
    assert.equal(moved.rebate_cents, 1111);
    assert(moved.paid_at);
    assert.equal((await sync(agentA.account_id)).json.orders.find((o: any) => o.key === newId).rebate_state, 'paid');
    assert.equal((await admin.put(oldId, { agent_account_id: agentA.account_id, rebate: '1' })).json.error, '这张单编号变了，请刷新');
    assert.equal((await admin.paid(newId, false)).status, 200);
    assert.equal((await admin.del(newId)).status, 200);
  });

  await test('建单：员工带返点 403；管理员两个一起带才记；不挂和现在一样；订单接口不带代理和返点', async () => {
    const order = (over: object) => ({ customer_name: '建单客户', new_customer: true, business_type_id: BT['清关'], total_amount: 100, currency: 'CNY', ...over });
    const post = (who: Who, body: object) => call(ordersRoute.POST, who, 'POST', '/api/orders', body);
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
    const n = count();
    for (const fields of [{ agent_account_id: agentA.account_id, agent_rebate: '5' }, { agent_rebate: '5' }, { agent_rebate: '' }, { agent_rebate: null }]) {
      assert.equal((await post('staff', order(fields))).status, 403, JSON.stringify(fields));
    }
    for (const fields of [{ agent_account_id: agentA.account_id }, { agent_rebate: '5' }, { agent_account_id: '', agent_rebate: '5' }, { agent_account_id: agentA.account_id, agent_rebate: '' }, { agent_account_id: agentA.account_id, agent_rebate: '0' }, { agent_account_id: agentA.account_id, agent_rebate: '-1' }, { agent_account_id: agentA.account_id, agent_rebate: '1.234' }]) {
      assert.equal((await post('admin', order(fields))).status, 400, JSON.stringify(fields));
    }
    assert.equal((await post('admin', order({ agent_account_id: 'nobody', agent_rebate: '5' }))).status, 409);
    await admin.patchAgent(agentC.account_id, { status: 'disabled' });
    assert.equal((await post('admin', order({ agent_account_id: agentC.account_id, agent_rebate: '5' }))).status, 409, 'disabled agent on new order');
    await admin.patchAgent(agentC.account_id, { status: 'active' });
    assert.equal(count(), n, 'nothing created by rejected requests');

    const created = await post('admin', order({ agent_account_id: agentA.account_id, agent_rebate: '66.60' }));
    assert.equal(created.status, 201);
    const row = db.prepare('SELECT agent_account_id, rebate_cents, created_by, paid_at FROM agent_rebates WHERE order_id = ?').get(created.json.id) as any;
    assert.deepEqual({ ...row }, { agent_account_id: agentA.account_id, rebate_cents: 6660, created_by: '管理员甲', paid_at: null });
    assert.equal(/agent|rebate/i.test(created.text), false, 'POST response has no agent fields');

    const plain = await post('staff', order({ customer_name: '建单客户', new_customer: undefined }));
    assert.equal(plain.status, 201, 'employee without the fields works as before');
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(plain.json.id), undefined);
    const plainAdmin = await post('admin', order({ customer_name: '建单客户', new_customer: undefined, agent_account_id: '', agent_rebate: '' }));
    assert.equal(plainAdmin.status, 201, 'admin leaving both blank creates a plain order');
    assert.equal(db.prepare('SELECT 1 FROM agent_rebates WHERE order_id = ?').get(plainAdmin.json.id), undefined);

    // 操作日志不写金额
    const logs = JSON.stringify(db.prepare("SELECT action, detail, old_value, new_value FROM audit_logs WHERE target_type='agent_rebate'").all());
    assert(logs.includes('挂代理'));
    for (const money of ['66.6', '6660', '321.45', '32145']) assert.equal(logs.includes(money), false, `audit log has amount ${money}`);

    for (const who of ['admin', 'staff'] as const) {
      const list = await call(ordersRoute.GET, who, 'GET', '/api/orders');
      assert.equal(list.status, 200);
      assert(list.json.some((o: any) => o.id === created.json.id));
      assert.equal(/agent|rebate/i.test(list.text), false, `${who} list`);
      const detail = await call(orderRoute.GET, who, 'GET', `/api/orders/${created.json.id}`, undefined, created.json.id);
      assert.equal(detail.status, 200);
      assert.equal(/agent|rebate/i.test(detail.text), false, `${who} detail`);
    }
  });

  await test('员工挂代理：只选人，看不到钱，代理要等管理员填了返点才看得到', async () => {
    const staff = {
      get: (id: string, who: Who = 'staff') => call(orderRebateRoute.GET, who, 'GET', `/api/orders/${id}/agent-rebate`, undefined, id),
      attach: (id: string, body: unknown, who: Who = 'staff') => call(orderRebateRoute.POST, who, 'POST', `/api/orders/${id}/agent-rebate`, body, id),
    };
    const rowOf = (id: string) => db.prepare('SELECT agent_account_id, rebate_cents, paid_at, created_by FROM agent_rebates WHERE order_id = ?').get(id) as any;
    const moneyWords = /rebate|cents|paid|login|waiting|earned|anomaly|state/i;
    const fresh = (await admin.newAgent({ name: '代理丁', login: 'daili-d', password: 'secret-d1' })).json.agent;

    // 可选代理：谁能取、取到什么
    assert.equal((await agentOptionsGET(new NextRequest('http://internal.invalid/api/agents/options'))).status, 401);
    const options = (who: Who) => call(agentOptionsGET, who, 'GET', '/api/agents/options');
    assert.equal((await options('client')).status, 403);
    const opts = await options('staff');
    assert.equal(opts.status, 200);
    assert(opts.json.agents.length > 0);
    for (const a of opts.json.agents) assert.deepEqual(Object.keys(a).sort(), ['account_id', 'name']);
    assert.equal(moneyWords.test(opts.text), false, 'options only has ids and names');
    await admin.patchAgent(agentC.account_id, { status: 'disabled' });
    assert.equal((await options('staff')).json.agents.some((a: any) => a.account_id === agentC.account_id), false, 'disabled agent not offered');

    // 看单：没登录 401，客户 403，没这张单 404
    const id = makeOrder();
    assert.equal((await staff.get(id, null)).status, 401);
    assert.equal((await staff.get(id, 'client')).status, 403);
    assert.equal((await staff.get('NO-SUCH')).status, 404);
    const before = await staff.get(id);
    assert.equal(before.status, 200);
    assert.equal(before.json.attached, null);
    assert.equal(moneyWords.test(before.text), false, before.text);

    // 挂：不合规的都不留记录
    assert.equal((await staff.attach(id, { agent_account_id: fresh.account_id }, null)).status, 401);
    assert.equal((await staff.attach(id, { agent_account_id: fresh.account_id }, 'client')).status, 403);
    assert.equal((await staff.attach(id, {})).status, 400);
    assert.equal((await staff.attach(id, { agent_account_id: 'x'.repeat(65) })).status, 400);
    assert.equal((await staff.attach(id, { agent_account_id: 123 })).status, 400);
    assert.equal((await staff.attach(id, { agent_account_id: 'nobody' })).status, 409);
    assert.equal((await staff.attach(id, { agent_account_id: agentC.account_id })).status, 409, 'disabled agent');
    assert.equal((await staff.attach('NO-SUCH', { agent_account_id: fresh.account_id })).status, 409);
    assert.equal(rowOf(id), undefined);

    // 带了金额也不理：返点只有管理员填
    const done = await staff.attach(id, { agent_account_id: fresh.account_id, rebate: '999', rebate_cents: 99900, agent_rebate: '999' });
    assert.equal(done.status, 200, done.text);
    assert.deepEqual(done.json, { attached: { agent_name: '代理丁' } });
    assert.deepEqual({ ...rowOf(id) }, { agent_account_id: fresh.account_id, rebate_cents: null, paid_at: null, created_by: '员工甲' });

    // 员工只看得到名字
    const after = await staff.get(id);
    assert.deepEqual(after.json.attached, { agent_name: '代理丁' });
    assert.equal(moneyWords.test(after.text), false, after.text);

    // 挂上后员工动不了：再挂 409，改、解除、已付 403；一个字没变
    assert.equal((await staff.attach(id, { agent_account_id: agentA.account_id })).status, 409);
    assert.equal((await staff.attach(id, { agent_account_id: fresh.account_id })).status, 409);
    assert.equal((await call(orderRebateRoute.PUT, 'staff', 'PUT', `/api/orders/${id}/agent-rebate`, { agent_account_id: fresh.account_id, rebate: '5' }, id)).status, 403);
    assert.equal((await call(orderRebateRoute.DELETE, 'staff', 'DELETE', `/api/orders/${id}/agent-rebate`, undefined, id)).status, 403);
    assert.equal((await call(paidRoute.POST, 'staff', 'POST', `/api/orders/${id}/agent-rebate/paid`, { paid: true }, id)).status, 403);
    assert.equal((await call(agentsRoute.GET, 'staff', 'GET', '/api/agents')).status, 403);
    assert.equal((await call(rebatesRoute.GET, 'staff', 'GET', `/api/agent-rebates?agent_id=${fresh.account_id}`)).status, 403);
    assert.deepEqual({ ...rowOf(id) }, { agent_account_id: fresh.account_id, rebate_cents: null, paid_at: null, created_by: '员工甲' });

    // 代理：没填返点看不到，合计也不算；办完了也一样
    setStatus(id, '已完成');
    let portal = (await sync(fresh.account_id)).json;
    assert.deepEqual(portal.orders, []);
    assert.deepEqual(portal.totals, { waiting_cents: 0, earned_cents: 0, paid_cents: 0 });

    // 管理员：单数算上、合计不算、标「待填」，没填不能点已付
    const summary = () => admin.list().then(r => r.json.agents.find((a: any) => a.account_id === fresh.account_id));
    const s1 = await summary();
    assert.deepEqual([s1.order_count, s1.unfilled_count, s1.waiting_cents, s1.earned_cents, s1.paid_cents, s1.anomaly_cents], [1, 1, 0, 0, 0, 0]);
    const rows = (await admin.rows(fresh.account_id)).json.rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rebate_cents, null);
    assert.equal((await admin.get(id)).json.rebate.rebate_cents, null);
    const notYet = await admin.paid(id, true);
    assert.equal(notYet.status, 409);
    assert.equal(notYet.json.error, '先填返点');
    assert.equal(rowOf(id).paid_at, null);

    // 管理员填了：代理看得到，日志记「填返点」且没有金额；员工还是看不到钱
    assert.equal((await admin.put(id, { agent_account_id: fresh.account_id, rebate: '12.34' })).status, 200);
    portal = (await sync(fresh.account_id)).json;
    assert.equal(portal.orders.length, 1);
    assert.equal(portal.orders[0].rebate_cents, 1234);
    assert.equal(portal.orders[0].rebate_state, 'earned');
    assert.equal(portal.totals.earned_cents, 1234);
    assert.equal(rowOf(id).created_by, '员工甲');
    const s2 = await summary();
    assert.deepEqual([s2.order_count, s2.unfilled_count, s2.earned_cents], [1, 0, 1234]);
    const logs = db.prepare("SELECT action, detail FROM audit_logs WHERE target_type='agent_rebate' AND target_id=? ORDER BY id").all(id) as { action: string; detail: string }[];
    assert.deepEqual(logs.map(l => l.action), ['挂代理', '填返点']);
    assert.equal(JSON.stringify(logs).includes('12.34') || JSON.stringify(logs).includes('1234'), false);
    const filledView = await staff.get(id);
    assert.deepEqual(filledView.json.attached, { agent_name: '代理丁' });
    assert.equal(moneyWords.test(filledView.text) || filledView.text.includes('1234') || filledView.text.includes('12.34'), false, filledView.text);
    assert.equal((await staff.attach(id, { agent_account_id: agentA.account_id })).status, 409, 'staff cannot take over a filled order');
    assert.equal((await admin.paid(id, true)).status, 200);
    assert.equal((await staff.get(id)).text.includes('paid'), false);
    assert.equal((await admin.paid(id, false)).status, 200);

    // 管理员解除后员工能重新挂；没填返点的单管理员能解除、能换人、能删单
    assert.equal((await admin.del(id)).status, 200);
    assert.equal((await staff.get(id)).json.attached, null);
    assert.equal((await staff.attach(id, { agent_account_id: agentA.account_id })).status, 200);
    assert.equal((await admin.del(id)).status, 200);
    assert.equal(rowOf(id), undefined);
    assert.equal((await staff.attach(id, { agent_account_id: fresh.account_id })).status, 200);
    assert.equal((await admin.put(id, { agent_account_id: agentA.account_id, rebate: '1' })).status, 200, 'admin moves it to another agent while filling');
    assert.equal(rowOf(id).agent_account_id, agentA.account_id);
    assert.equal((await admin.del(id)).status, 200);
    const gone = makeOrder();
    assert.equal((await staff.attach(gone, { agent_account_id: fresh.account_id })).status, 200);
    assert.equal((await call(orderRoute.DELETE, 'admin', 'DELETE', `/api/orders/${gone}`, undefined, gone)).status, 200);
    assert.equal(rowOf(gone), undefined);

    // 拆单：待填的也算份数，另一份没填时代理只看到一份，份数和管理员页一样，填了也不变号
    const source = 'ORD-STAFF-SPLIT';
    const [one, two] = [makeOrder(), makeOrder()];
    inbox(source, 1, 1, one);
    inbox(source, 1, 2, two);
    for (const o of [one, two]) assert.equal((await staff.attach(o, { agent_account_id: fresh.account_id })).status, 200);
    assert.equal((await admin.put(one, { agent_account_id: fresh.account_id, rebate: '10' })).status, 200);
    portal = (await sync(fresh.account_id)).json;
    assert.deepEqual(portal.orders.map((o: any) => [o.key, o.part, o.parts]), [[one, 1, 2]]);
    assert.deepEqual((await admin.rows(fresh.account_id)).json.rows.filter((r: any) => r.order_id === one).map((r: any) => [r.part, r.parts]), [[1, 2]]);
    assert.equal(portal.totals.waiting_cents, 1000);
    assert.equal((await admin.put(two, { agent_account_id: fresh.account_id, rebate: '20' })).status, 200);
    portal = (await sync(fresh.account_id)).json;
    assert.deepEqual(portal.orders.map((o: any) => [o.key, o.part, o.parts]).sort(), [[one, 1, 2], [two, 2, 2]].sort());
    assert.equal(portal.totals.waiting_cents, 3000);
    for (const o of [one, two]) assert.equal((await admin.del(o)).status, 200);

    // 已取消：员工挂不上；挂了以后取消不催填、恢复了再催；取消后还能解除
    const cancelled = makeOrder({ status: '客户取消' });
    const refused = await staff.attach(cancelled, { agent_account_id: fresh.account_id });
    assert.equal(refused.status, 409);
    assert.equal(refused.json.error, '这张单已取消，不用挂代理');
    assert.equal(rowOf(cancelled), undefined);
    const later = makeOrder();
    assert.equal((await staff.attach(later, { agent_account_id: fresh.account_id })).status, 200);
    assert.equal((await summary()).unfilled_count, 1);
    setStatus(later, '客户取消');
    const s3 = await summary();
    assert.deepEqual([s3.order_count, s3.unfilled_count, s3.waiting_cents, s3.earned_cents, s3.paid_cents, s3.anomaly_cents], [1, 0, 0, 0, 0, 0]);
    assert.equal((await admin.rows(fresh.account_id)).json.rows[0].rebate_state, 'void');
    assert.deepEqual((await sync(fresh.account_id)).json.orders, []);
    setStatus(later, '进行中');
    assert.equal((await summary()).unfilled_count, 1);
    setStatus(later, '客户取消');
    assert.equal((await admin.del(later)).status, 200);

    // 操作记录：员工（包括和管理员同名的员工）的日志接口和日报都看不到代理记账这两类
    const canary = makeOrder({ status: '已完成' });
    assert.equal((await admin.put(canary, { agent_account_id: fresh.account_id, rebate: '7' })).status, 200);
    assert.equal((await admin.paid(canary, true)).status, 200);
    assert.equal((await admin.paid(canary, false)).status, 200);
    assert.equal((await staff.attach(makeOrder(), { agent_account_id: fresh.account_id })).status, 200);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    for (const who of ['staff', 'twin'] as const) {
      const logs = await call(auditLogsGET, who, 'GET', '/api/audit-logs?limit=500');
      assert.equal(logs.status, 200);
      assert.equal(/agent_rebate|代理|返点/.test(logs.text), false, `${who} audit logs`);
      const typed = await call(auditLogsGET, who, 'GET', '/api/audit-logs?target_type=agent_rebate');
      assert.deepEqual(typed.json, [], `${who} typed audit logs`);
      const report = await call(workReportAutoGET, who, 'GET', `/api/work-reports/auto?date=${today}`);
      assert.equal(report.status, 200, report.text);
      assert.equal(/代理|返点/.test(report.text), false, `${who} work report`);
    }
    const adminLogs = await call(auditLogsGET, 'admin', 'GET', '/api/audit-logs?target_type=agent_rebate&limit=500');
    assert(adminLogs.json.some((l: any) => l.action === '返点已付'), 'admin still sees them');
    const adminReport = await call(workReportAutoGET, 'admin', 'GET', `/api/work-reports/auto?date=${today}`);
    assert.equal(/返点|挂代理/.test(adminReport.text), false, 'daily report never carries rebate lines');
    assert.equal((await admin.del(canary)).status, 200);
    db.prepare("DELETE FROM agent_rebates WHERE agent_account_id = ?").run(fresh.account_id);

    // 建单时挂：员工只带代理 → 待填；订单接口和响应都没有代理和返点
    const order = (over: object) => ({ customer_name: '员工挂单客户', new_customer: true, business_type_id: BT['清关'], total_amount: 100, currency: 'CNY', ...over });
    const post = (who: Who, body: object) => call(ordersRoute.POST, who, 'POST', '/api/orders', body);
    const made = await post('staff', order({ agent_account_id: fresh.account_id }));
    assert.equal(made.status, 201, made.text);
    assert.equal(/agent|rebate/i.test(made.text), false);
    assert.deepEqual({ ...rowOf(made.json.id) }, { agent_account_id: fresh.account_id, rebate_cents: null, paid_at: null, created_by: '员工甲' });
    assert.deepEqual((await sync(fresh.account_id)).json.orders, []);
    const blankAgent = await post('staff', order({ customer_name: '员工挂单客户', new_customer: undefined, agent_account_id: '' }));
    assert.equal(blankAgent.status, 201, 'blank agent means no agent');
    assert.equal(rowOf(blankAgent.json.id), undefined);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n;
    assert.equal((await post('staff', order({ customer_name: '员工挂单客户', new_customer: undefined, agent_account_id: agentC.account_id }))).status, 409, 'disabled agent');
    assert.equal((await post('staff', order({ customer_name: '员工挂单客户', new_customer: undefined, agent_account_id: 'nobody' }))).status, 409);
    assert.equal((await post('staff', order({ customer_name: '员工挂单客户', new_customer: undefined, agent_account_id: 5 }))).status, 400);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number }).n, n, 'rejected requests create nothing');
    for (const who of ['admin', 'staff'] as const) {
      const list = await call(ordersRoute.GET, who, 'GET', '/api/orders');
      assert.equal(/agent|rebate/i.test(list.text), false, `${who} list`);
      const detail = await call(orderRoute.GET, who, 'GET', `/api/orders/${made.json.id}`, undefined, made.json.id);
      assert.equal(/agent|rebate/i.test(detail.text), false, `${who} detail`);
    }
    assert.equal((await admin.del(made.json.id)).status, 200);
    await admin.patchAgent(agentC.account_id, { status: 'active' });
  });

  await test('开号登录名：占位邮箱 400 不去调业务系统；控制字符写法算同一个登录名', async () => {
    const calls = stub.calls.length;
    for (const login of ['phone_0812345678@user.xiangtai', 'PHONE_0812345678@USER.XIANGTAI']) {
      const r = await admin.newAgent({ name: '想认回', login, password: 'secret-1' });
      assert.equal(r.status, 400, login);
    }
    const first = await admin.newAgent({ name: '带空格', login: 'tab name', password: 'secret-1' });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const after = stub.calls.length;
    const again = await admin.newAgent({ name: '制表符', login: 'tab\tname', password: 'secret-2' });
    assert.equal(again.status, 409, JSON.stringify(again.json));
    assert.equal(stub.calls.length, after, 'duplicates stop before the customer site');
    assert.equal(calls + 1, after, 'placeholder logins never reached the customer site');
  });

  await test('推单响应不带改号明细：员工看不出这张单有没有返点', () => {
    assert.equal(fs.readFileSync(path.join(repo, 'src/lib/storefront-push.ts'), 'utf8').includes('renumbered'), false);
  });

  await test('页面和菜单：代理记账只有管理员看得到；员工建单页和订单页只给选代理，没有返点', () => {
    const read = (p: string) => fs.readFileSync(path.join(repo, p), 'utf8');
    const sidebar = read('src/components/sidebar-nav.ts');
    assert.match(sidebar, /const ADMIN_ONLY_NAV = new Set\(\[[^\]]*"代理记账"[^\]]*\]\)/);
    const page = read('src/app/(app)/agent-rebates/page.tsx');
    assert.match(page, /if \(!isAdmin\) return;\s+let ignore/);
    assert.match(page, /if \(!isAdmin\) \{\s+\/?\/?\s*return user \? <p[^>]*>代理记账只有管理员能看<\/p> : null;/);
    const newOrder = read('src/app/(app)/orders/new/page.tsx');
    assert.equal(newOrder.includes('fetchAgents('), false, 'new order page must not use the admin list');
    assert.match(newOrder, /if \(!canPickAgent\) return;\s+fetchAgentOptions\(\)/);
    assert.match(newOrder, /\{canPickAgent && \(\s+<div[^>]*>\s+<Label htmlFor="agent_account_id"/);
    assert.match(newOrder, /\{isAdmin && agents\.length > 0 && <Input aria-label="返点/);
    assert.match(newOrder, /\.\.\.\(isAdmin \? \{ agent_rebate:/);
    const detail = read('src/app/(app)/orders/[id]/page.tsx');
    assert(detail.includes('user?.role === "admin" && <OrderAgentCard'));
    assert(detail.includes('user?.role === "employee" && <OrderAgentAttachCard'));
    const staffCard = read('src/components/order-agent-card.tsx').split('export function OrderAgentAttachCard')[1];
    assert(staffCard && !/rebate_|formatRebate|setOrderAgentRebatePaid|saveOrderAgentRebate|removeOrderAgentRebate/.test(staffCard), 'staff card has no money path');
  });

  console.log(`\nALL PASS (${results.length} groups)`);
} finally {
  server.close();
  server.closeAllConnections?.();
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
