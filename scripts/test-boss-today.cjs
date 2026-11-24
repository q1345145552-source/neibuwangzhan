#!/usr/bin/env node
// 老板今日：真实路由 + 隔离 SQLite fixture；不碰生产库、不联网。
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync('/tmp/xt-boss-today-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'boss-today-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const resolve = Module._resolveFilename; Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
const { signToken } = require('../src/lib/auth.ts'), { NextRequest } = require('next/server');
const { bossToday, hasRealProblem, recentWorkdays } = require('../src/lib/boss-today.ts');
const route = require('../src/app/api/boss-today/route.ts');

(async () => {
  // 只保留本测试的人
  db.prepare("UPDATE employees SET status='离职'").run();
  const add = (name, role, status = '在职') => db.prepare('INSERT INTO employees(name,role,status,must_change_password) VALUES (?,?,?,0)').run(name, role, status).lastInsertRowid;
  const bossId = add('测老板', 'admin'); add('在岗甲', 'employee'); add('在岗乙', 'employee'); add('请假丙', 'employee'); add('已走丁', 'employee', '离职'); add('Ing', 'employee');
  const boss = db.prepare('SELECT * FROM employees WHERE id=?').get(bossId);
  const empTok = await signToken(db.prepare("SELECT * FROM employees WHERE name='在岗甲'").get());

  const today = '2026-11-25';                      // 周三
  assert.deepEqual(recentWorkdays(db, today, 3), ['2026-11-24', '2026-11-23', '2026-11-21'], '跳过周日');
  // 线上实际出现的“没有问题”写法 + 加前缀/语气词的变体
  for (const t of ['没有', 'ไม่มี', ' - ', '无。', 'none', '', null, 'ไม่พบปัญหา', 'ไม่พบ', 'ไม่มีปัญหา', 'ไม่มีปัญหาค่ะ', 'ไม่มีค่ะ', 'วันนี้ไม่มีปัญหาครับ', '暂时没有', '目前没有问题', '没有。', '一切正常', 'No problem.', 'ปัญหาที่พบ', 'ไม่มีปัญหาใดๆ'])
    assert.equal(hasRealProblem(t), false, String(t));
  for (const t of ['-มีหลายออเดอร์ที่ไม่มีครีเอเตอร์กดรับงาน', '客户一直不回消息', 'ไม่พบลูกค้า', '没有收到货款', 'bitbrower ใกล้หมดอายุ', 'Moxh回复很慢'])
    assert.equal(hasRealProblem(t), true, t);

  // 订单：A 负责人已离职、很久没动；B 刚动过；C 卡住（阻塞）；D 负责人大小写不同但在职
  const bt = db.prepare('SELECT id FROM business_types LIMIT 1').get().id;
  const order = (id, updated, steps) => {
    db.prepare("INSERT INTO orders(id,customer_name,business_type_id,status,created_at,updated_at) VALUES (?,?,?,'进行中',?,?)").run(id, '客户' + id, bt, updated, updated);
    steps.forEach(([name, status, assignee, started], i) => db.prepare('INSERT INTO order_steps(order_id,step_name,step_order,status,assignee,started_at,created_at) VALUES (?,?,?,?,?,?,?)').run(id, name, i + 1, status, assignee, started, updated));
  };
  const old = "datetime('now','-40 days')", d = s => db.prepare(`SELECT ${s} t`).get().t;
  order('T-A', d(old), [['第一步', '已完成', '在岗甲', d(old)], ['等材料', '进行中', '已走丁', d(old)]]);
  order('T-B', d("datetime('now','-1 days')"), [['正在办', '进行中', '在岗乙', d("datetime('now','-1 days')")]]);
  order('T-C', d("datetime('now','-2 days')"), [['被卡', '阻塞', '在岗乙', d("datetime('now','-2 days')")]]);
  order('T-D', d("datetime('now','-10 days')"), [['慢', '进行中', 'ing', d("datetime('now','-10 days')")]]);
  // E：步骤全办完 5 天还没结单；F：步骤全办完 1 天（还不算）；G：没有任何步骤、10 天没动
  order('T-E', d("datetime('now','-20 days')"), [['唯一一步', '已完成', '在岗乙', d("datetime('now','-20 days')")]]);
  db.prepare("UPDATE order_steps SET completed_at=datetime('now','-5 days') WHERE order_id='T-E'").run();
  db.prepare("UPDATE orders SET updated_at=datetime('now','-5 days') WHERE id='T-E'").run();
  order('T-F', d("datetime('now','-1 days')"), [['唯一一步', '已完成', '在岗乙', d("datetime('now','-1 days')")]]);
  db.prepare("UPDATE order_steps SET completed_at=datetime('now','-1 days') WHERE order_id='T-F'").run();
  order('T-G', d("datetime('now','-10 days')"), []);
  db.prepare("INSERT INTO issue_tickets(ticket_number,description,status,assignee,created_by,created_at) VALUES ('W1','老工单','待处理','在岗乙','测老板',datetime('now','-5 days')),('W2','新工单','待处理','在岗乙','测老板',datetime('now'))").run();

  // 日报：甲写了真问题（泰文），乙写“ไม่มี”，还有一份一周前的旧日报
  const report = (name, date, problems) => db.prepare("INSERT INTO work_reports(employee_name,report_date,completed_items,summary,problems,status,submitted_at,created_at) VALUES (?,?,'[\"x\"]','做了事',?,'已提交',?,?)").run(name, date, problems, date + 'T10:00:00Z', date + 'T10:00:00Z').lastInsertRowid;
  const realId = report('在岗甲', '2026-11-24', 'ลูกค้าไม่ตอบ');
  report('在岗乙', '2026-11-24', 'ไม่มี');
  report('在岗乙', '2026-11-10', '旧问题，超过一周不再提');
  // 考勤：甲打了卡，乙没打卡；丙当天请假
  db.prepare("INSERT INTO attendance(employee_name,date,check_in,type) VALUES ('在岗甲','2026-11-24','2026-11-24 01:00:00','正常'),('Ing','2026-11-24','2026-11-24 01:00:00','正常')").run();
  report('Ing', '2026-11-24', '没有');
  db.prepare("INSERT INTO leave_requests(employee_name,leave_type,start_date,end_date,status) VALUES ('请假丙','事假','2026-11-24','2026-11-24','已通过')").run();
  // 员工完成的待办：老板派的（未确认/已确认/太久以前）、系统派的、员工自己建的
  const todo = (content, by, completedAgo) => db.prepare(`INSERT INTO todos(content,assignee,status,created_by,created_at,completed_at) VALUES (?,'在岗甲','已完成',?,datetime('now','-20 days'),datetime('now',?))`).run(content, by, completedAgo).lastInsertRowid;
  const tNew = todo('老板派的-刚完成', '测老板', '-1 days'), tConfirmed = todo('老板派的-已确认', '测老板', '-1 days');
  todo('老板派的-太久', '测老板', '-10 days'); todo('系统派的', '系统', '-1 days'); todo('自己建的', '在岗甲', '-1 days');
  require('../src/lib/boss-submissions.ts').acknowledgeBossSubmission(db, 'todo', Number(tConfirmed), '测老板');
  // 待办：老板自己一条很旧的
  db.prepare("INSERT INTO todos(content,assignee,status,created_by,created_at) VALUES ('老板旧事','测老板','未完成','测老板',datetime('now','-30 days'))").run();

  const before = db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n + ':' + db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
  const r = bossToday(db, boss.name, today);
  assert.equal(r.last_workday, '2026-11-24');
  const ids = r.stuck_orders.map(o => o.order_id);
  assert.deepEqual(ids.slice(0, 2), ['T-C', 'T-A'], '阻塞优先，其次负责人离职');
  assert(ids.includes('T-D') && !ids.includes('T-B'), '10 天没动算卡住，1 天前的不算');
  assert.equal(r.stuck_orders.find(o => o.order_id === 'T-A').assignee_left, true);
  assert.equal(r.stuck_orders.find(o => o.order_id === 'T-A').step_name, '等材料', '取第一个未完成步骤');
  assert.equal(r.stuck_orders.find(o => o.order_id === 'T-D').assignee_left, false, '名字大小写不同仍算在职');
  const e = r.stuck_orders.find(o => o.order_id === 'T-E');
  assert(e && e.step_status === '待结单' && e.idle_days === 5 && e.assignee === '在岗乙', '办完 5 天没结单要出现，按最后完成时间算');
  assert(!ids.includes('T-F'), '办完 1 天还不算');
  assert.equal(r.stuck_orders.find(o => o.order_id === 'T-G')?.step_status, '无步骤', '没有步骤的老订单也要出现');
  assert.deepEqual(r.completed_todos.map(t => t.id), [Number(tNew)], '只列老板派的、近 7 天完成、还没确认的');
  assert.deepEqual(r.stuck_issues.map(i => i.ticket_number), ['W1'], '只列 3 天以上的工单');
  assert.deepEqual(r.raised_problems.map(p => p.report_id), [Number(realId)], '只列近 7 天写了实际问题的');
  assert.equal(r.reports_to_clear.length, 4); assert.equal(r.reports_to_clear.filter(x => x.old).length, 1);
  assert.deepEqual(r.misses.map(m => [m.name, m.no_attendance, m.no_report]), [['在岗乙', true, false]], '请假的不算，交了日报的不算没交');
  assert.deepEqual(r.my_todos, { total: 1, stale: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n + ':' + db.prepare('SELECT COUNT(*) n FROM notifications').get().n, before, '只读');

  const call = async token => { const res = await route.GET(new NextRequest('http://fixture/api/boss-today', { headers: token ? { Authorization: 'Bearer ' + token } : {} })); return { status: res.status, body: await res.json() }; };
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(empTok)).status, 403);
  const bossTok = await signToken(boss);
  const ok = await call(bossTok); assert.equal(ok.status, 200); assert(Array.isArray(ok.body.stuck_orders)); assert.equal(ok.body.completed_todos.length, 1);
  // 页面上的“确认”走现有待办接口；确认后从老板今日消失
  const todoRoute = require('../src/app/api/todos/[id]/route.ts');
  const confirm = await todoRoute.PATCH(new NextRequest('http://fixture/api/todos/' + tNew, { method: 'PATCH', headers: { Authorization: 'Bearer ' + bossTok, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }) }), { params: Promise.resolve({ id: String(tNew) }) });
  assert.equal(confirm.status, 200);
  assert.equal((await call(bossTok)).body.completed_todos.length, 0);
  console.log('BOSS TODAY: ALL PASS; isolated fixture ' + fixture);
})().catch(e => { console.error(e); process.exit(1); });
