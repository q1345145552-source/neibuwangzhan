/**
 * 老单改编号脚本（scripts/migrate-order-id-to-source-no.py，2026-10-22 老板「单号必须要对上」「单号不要-」）。
 * 在临时目录里用真建表逻辑建库，手工放几张「上线前那种」内部编号的同步单，再跑脚本核对：
 * 正常改号（步骤、通知、积分原因一起换，旧编号一处不剩）；现货 SPOT-… 单号照用；演练不写入；
 * 一张办理单挂在两张客户单上、没给上传目录、上传文件名带旧编号时都停下且什么都不动。
 * Run (from this repo): node --import <tsx loader> scripts/test-migrate-order-id.mts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'migrate-order-id-to-source-no.py');
const root = fs.mkdtempSync('/tmp/xt-migrate-order-id-');
const results: { name: string; result: 'PASS' | 'FAIL'; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }

// 建一份真表结构的库（跟线上同一套建表代码），换一个文件放每个场景
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(root, 'template.db'), JWT_SECRET: 'migrate-test-jwt' });
const { getDb } = await import('../src/lib/db');
const template = getDb();
template.pragma('wal_checkpoint(TRUNCATE)');
const bt = (template.prepare('SELECT id FROM business_types ORDER BY id LIMIT 1').get() as { id: number }).id;

type Fixture = { source: string; internal: string }[];
function scenario(name: string, orders: Fixture, shareFirst = false) {
  const dir = path.join(root, name); fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
  const file = path.join(dir, 'data.db');
  template.prepare('VACUUM INTO ?').run(file);
  const run = (sql: string, ...params: unknown[]) => spawnSync('sqlite3', [file, sql.replace(/\?/g, () => `'${String(params.shift()).replace(/'/g, "''")}'`)], { encoding: 'utf8' });
  for (const [i, o] of orders.entries()) {
    run("INSERT INTO orders(id,customer_name,business_type_id,status,description,total_amount,currency,created_at,updated_at) VALUES (?,'客户',?,'进行中','客户站同步单',100,'CNY',datetime('now'),datetime('now'))", o.internal, bt);
    run("INSERT INTO order_steps(order_id,step_name,step_order,status) VALUES (?,'第一步',1,'已完成')", o.internal);
    run("INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,allocated_cents,allocated_amount,billing_revision) VALUES (?,?,1,1,'COM-001',?,'','{}',10000,100,1)", `inbox-${i}`, o.source, o.internal);
    run("INSERT INTO notifications(recipient,title,body,type,related_id,related_type) VALUES ('张三','轮到你了',?,'',?,?)", `订单 ${o.internal} 轮到你了`, o.internal, `/orders/${o.internal}`);
    run("INSERT INTO points_records(employee_name,points,reason,rule_key,ref_id) VALUES ('张三',3,?,'client_feedback',?)", `订单 ${o.internal} 客户满意`, o.internal);
  }
  if (shareFirst && orders.length > 1) run("UPDATE sync_inbox SET internal_order_id=? WHERE source_order_no=?", orders[0].internal, orders[1].source);
  const count = (needle: string) => Number(spawnSync('sqlite3', [file, `SELECT (SELECT COUNT(*) FROM orders WHERE id='${needle}')+(SELECT COUNT(*) FROM order_steps WHERE order_id='${needle}')+(SELECT COUNT(*) FROM sync_inbox WHERE internal_order_id='${needle}')+(SELECT COUNT(*) FROM notifications WHERE related_id='${needle}' AND instr(related_type,'${needle}')>0 AND instr(body,'${needle}')>0)+(SELECT COUNT(*) FROM points_records WHERE ref_id='${needle}' AND instr(reason,'${needle}')>0)`], { encoding: 'utf8' }).stdout.trim());
  const migrate = (...extra: string[]) => spawnSync('python3', [script, file, ...extra], { encoding: 'utf8' });
  return { dir, file, count, migrate };
}

await test('rehearsal changes nothing; apply moves every reference to the business-system number', async () => {
  const s = scenario('happy', [{ source: 'ORD20261001000000000001', internal: 'ORD-aaaaaaaa-1111-2222-3333-444444444444' }]);
  const dry = s.migrate('--uploads', path.join(s.dir, 'uploads'));
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /演练完成/);
  assert.equal(s.count('ORD-aaaaaaaa-1111-2222-3333-444444444444'), 5);
  const apply = s.migrate('--uploads', path.join(s.dir, 'uploads'), '--apply');
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  assert.equal(s.count('ORD-aaaaaaaa-1111-2222-3333-444444444444'), 0);
  assert.equal(s.count('ORD20261001000000000001'), 5, 'order, step, inbox, notification (id+link+text), points (ref+reason) all moved');
  const again = s.migrate('--uploads', path.join(s.dir, 'uploads'), '--apply');
  assert.match(again.stdout, /没有要改的老单/);
});

await test('spot orders (SPOT-…) keep their own business-system number', async () => {
  const s = scenario('spot', [{ source: 'SPOT-20261001-ABC', internal: 'ORD-bbbbbbbb-1111-2222-3333-444444444444' }]);
  const apply = s.migrate('--uploads', path.join(s.dir, 'uploads'), '--apply');
  assert.equal(apply.status, 0, apply.stdout + apply.stderr);
  assert.equal(s.count('SPOT-20261001-ABC'), 5);
});

await test('one internal order linked to two customer orders: stop and change nothing', async () => {
  const s = scenario('shared', [{ source: 'ORD20261001000000000002', internal: 'ORD-cccccccc-1111-2222-3333-444444444444' }, { source: 'ORD20261001000000000003', internal: 'ORD-dddddddd-1111-2222-3333-444444444444' }], true);
  const before = [s.count('ORD-cccccccc-1111-2222-3333-444444444444'), s.count('ORD-dddddddd-1111-2222-3333-444444444444')];
  const apply = s.migrate('--uploads', path.join(s.dir, 'uploads'), '--apply');
  assert.equal(apply.status, 1);
  assert.match(apply.stdout, /同时挂在几张客户单上/);
  assert.deepEqual([s.count('ORD-cccccccc-1111-2222-3333-444444444444'), s.count('ORD-dddddddd-1111-2222-3333-444444444444')], before, 'nothing renamed');
});

await test('without an uploads folder, or with a file named after an old number: stop and change nothing', async () => {
  const s = scenario('uploads', [{ source: 'ORD20261001000000000004', internal: 'ORD-eeeeeeee-1111-2222-3333-444444444444' }]);
  const none = s.migrate('--apply');
  assert.equal(none.status, 1);
  assert.match(none.stdout, /--uploads/);
  fs.writeFileSync(path.join(s.dir, 'uploads', 'x_ORD-eeeeeeee-1111-2222-3333-444444444444.pdf'), 'x');
  const named = s.migrate('--uploads', path.join(s.dir, 'uploads'), '--apply');
  assert.equal(named.status, 1);
  assert.match(named.stdout, /带旧编号的文件/);
  assert.equal(s.count('ORD-eeeeeeee-1111-2222-3333-444444444444'), 5);
});

for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
else fs.rmSync(root, { recursive: true, force: true });
process.exit();
