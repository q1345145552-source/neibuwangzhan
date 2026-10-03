/**
 * 员工专用接口挡住客户账号（2026-10-03）：聊天、问题跟踪、待办下面每个接口的每个操作，
 * 客户账号（role=client）一律 403；员工照常能用。临时库，不连任何外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-staffonly-<新目录>/x.db node --import <tsx loader> scripts/test-client-staff-only.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-staffonly-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-staffonly-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'staff-only-regression-jwt';
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const db = getDb();
db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('测试客户', 'client@example.invalid', 'client', 'x', 0, '在职')").run();
const client = db.prepare("SELECT id, name, auth_version FROM employees WHERE role='client' AND email='client@example.invalid'").get() as { id: number; name: string; auth_version: number };
const staff = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='employee' AND status='在职' LIMIT 1").get() as { id: number; name: string; role: string; auth_version: number };
db.prepare('UPDATE employees SET must_change_password=0 WHERE id IN (?, ?)').run(client.id, staff.id);
const clientToken = await signToken({ id: client.id, name: client.name, role: 'client', auth_version: client.auth_version, must_change_password: 0 });
const staffToken = await signToken({ id: staff.id, name: staff.name, role: staff.role, auth_version: staff.auth_version, must_change_password: 0 });

const root = path.resolve(import.meta.dirname, '../src/app/api');
const files = ['chat', 'problems', 'todos'].flatMap(dir =>
  (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[]).filter(f => f.endsWith('route.ts')).map(f => path.join(root, dir, f)));
const call = (handler: Function, token: string, method: string, url: string) => {
  const req = new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
  return handler(req, { params: Promise.resolve({ id: '1', stepId: '1' }) }) as Promise<Response>;
};

let blocked = 0;
const results: { name: string; result: string; error?: string }[] = [];
for (const file of files.sort()) {
  const mod = await import(pathToFileURL(file).href) as Record<string, unknown>;
  const url = '/api/' + path.relative(root, path.dirname(file)).replaceAll('[id]', '1');
  for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    if (typeof mod[method] !== 'function') continue;
    const name = `${method} ${url}`;
    try {
      const r = await call(mod[method] as Function, clientToken, method, url);
      assert.equal(r.status, 403, `${name} → ${r.status}`);
      blocked++;
      results.push({ name: `client blocked: ${name}`, result: 'PASS' });
    } catch (error) { results.push({ name: `client blocked: ${name}`, result: 'FAIL', error: String(error) }); }
  }
}
// 员工照常能用（抽查只读接口）
for (const [rel, url] of [['chat/contacts', '/api/chat/contacts'], ['chat/unread-count', '/api/chat/unread-count'], ['problems', '/api/problems'], ['problems/stats', '/api/problems/stats'], ['todos', '/api/todos'], ['todos/unseen', '/api/todos/unseen']]) {
  const mod = await import(pathToFileURL(path.join(root, rel, 'route.ts')).href) as { GET: Function };
  try {
    const r = await call(mod.GET, staffToken, 'GET', url);
    assert.equal(r.status, 200, `${url} → ${r.status} ${await r.clone().text()}`);
    results.push({ name: `staff still works: GET ${url}`, result: 'PASS' });
  } catch (error) { results.push({ name: `staff still works: GET ${url}`, result: 'FAIL', error: String(error) }); }
}
for (const r of results.filter(r => r.result === 'FAIL')) console.log(JSON.stringify(r));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`client blocked on ${blocked} handlers`);
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
db.close();
fs.rmSync(path.dirname(process.env.DB_PATH!), { recursive: true, force: true }); // 只会是上面校验过的 /tmp/xt-staffonly-* 目录
process.exit(failed ? 1 : 0);
