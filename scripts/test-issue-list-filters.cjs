#!/usr/bin/env node
// Real GET SQL on isolated :memory: SQLite + actual frontend filter expression.
// No application database, config, credentials, network, notifications or writes.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
function load(source, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, Response, Date, ...globals, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error('Forbidden dependency: ' + name); } });
  return exports;
}
const owners = load(fs.readFileSync(path.join(root, 'src/lib/chat-todo-issue-card.ts'), 'utf8'));
const page = ts.createSourceFile('page.tsx', fs.readFileSync(path.join(root, 'src/app/(app)/issues/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function filterRows(issues, options = {}) {
  const names = ['keyword', 'now', 'today', 'filteredIssues'], expressions = {};
  const visit = node => { if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(page))) expressions[node.name.getText(page)] = node.initializer.getText(page); ts.forEachChild(node, visit); };
  visit(page); for (const name of names) assert(expressions[name], name);
  const source = names.map(name => `const ${name} = ${expressions[name]};`).join('\n') + '\nexports.result = filteredIssues;';
  return Array.from(load(source, {}, { issues, parseIssueAssignees: owners.parseIssueAssignees, issueSearch: '', issueAssigneeFilter: '', issueCreatorFilter: '', issueStatusFilter: '', issueDateFilter: 'all', issueCustomFrom: '', issueCustomTo: '', ...options }).result);
}
function createIssueFilterHarness() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE issue_tickets (id INTEGER PRIMARY KEY, ticket_number TEXT, description TEXT, assignee TEXT, created_by TEXT, status TEXT, created_at TEXT, priority TEXT, ref_id TEXT, ref_type TEXT, images TEXT)');
  const fixtures = [
    [1, 'GD-MULTI-001', '客户资料补件 ตรวจสอบเอกสาร ALPHA', 'Bam,Ing', '老板', '待处理'],
    [2, 'GD-BAM-002', '客户资料核对', 'Bam', 'Bam', '处理中'],
    [3, 'GD-ING-003', 'ติดตามลูกค้า', 'Ing', '老板', '待处理'],
    [4, 'GD-OTHER-004', '客户资料 ALPHA', 'Bambi,King', 'Ing', '待处理'],
    [5, 'GD-SPACES-005', '客户资料整理', ' Ing , Bam ,,Bam ', 'Ing', '处理中'],
    [6, 'GD-DONE-006', '客户资料归档', 'Bam,Ing', '老板', '已解决'],
    [7, '', '无负责人', null, '老板', '待处理'],
    [8, 'GD-SPECIAL-008', '转义符测试', "A%_,O'Neil", '老板', '待处理'],
  ];
  for (const row of fixtures) db.prepare("INSERT INTO issue_tickets (id, ticket_number, description, assignee, created_by, status, created_at, priority, ref_id, ref_type, images) VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', '', '', '[]')").run(...row, new Date().toISOString());
  let actor = { name: '老板', role: 'admin' }, dbCalls = 0;
  const route = load(fs.readFileSync(path.join(root, 'src/app/api/issues/route.ts'), 'utf8'), {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor && { ...actor }, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': { getDb: () => { dbCalls++; return db; }, logOperation() { throw Error('GET must not log or mutate'); } },
    '@/lib/req': {}, '@/lib/chat-todo-issue-card': owners,
  });
  return { db, get dbCalls() { return dbCalls; }, setActor(value) { actor = value; },
    async call(params = {}) { const r = await route.GET(new Request('http://fixture/api/issues?' + new URLSearchParams(params))); return { status: r.status, body: await r.json() }; },
    rows() { return db.prepare('SELECT * FROM issue_tickets ORDER BY id').all(); }, close() { db.close(); } };
}
async function run() {
  const h = createIssueFilterHarness(); const ids = rows => Array.from(rows, row => row.id).sort((a, b) => a - b);
  try {
    for (const actor of [null, { name: '客户', role: 'client' }]) { h.setActor(actor); assert.equal((await h.call({ assignee: 'Bam' })).status, actor ? 403 : 401); }
    assert.equal(h.dbCalls, 0); h.setActor({ name: '老板', role: 'admin' });
    const rows = h.rows(), before = h.db.prepare('SELECT total_changes() AS n').get().n;
    for (const [assignee, expected] of [['Bam', [1, 2, 5, 6]], ['Ing', [1, 3, 5, 6]], ['Bambi', [4]], ['King', [4]], ['A%_', [8]], ["O'Neil", [8]], ['B', []], ['ing', []], ["' OR 1=1 --", []]]) {
      assert.deepEqual(ids((await h.call({ assignee })).body), expected, 'backend ' + assignee);
      assert.deepEqual(ids(filterRows(rows, { issueAssigneeFilter: assignee })), expected, 'frontend ' + assignee);
    }
    assert.deepEqual(ids((await h.call()).body), ids(rows)); assert.deepEqual(ids(filterRows(rows)), ids(rows));
    assert.deepEqual(ids((await h.call({ assignee: 'Bam', status: '待处理', created_by: '老板' })).body), [1]);
    console.log('PASS actual SQL/frontend exact comma-list membership: Bam and Ing both find multi-owner, single and padded/duplicate names work, Bambi/King do not falsely match Bam/Ing, wildcard/quote inputs literal, no-filter unchanged; backend status/creator compose.');
    for (const [keyword, expected] of [['客户资料', [1, 2, 4, 5, 6]], ['เอกสาร', [1]], ['ลูกค้า', [3]], ['alpha', [1, 4]], ['gd-multi', [1]], ['#7', [7]], ['', [1, 2, 3, 4, 5, 6, 7, 8]], ['   ', [1, 2, 3, 4, 5, 6, 7, 8]], ['不存在', []]]) assert.deepEqual(ids(filterRows(rows, { issueSearch: keyword })), expected, keyword);
    assert.deepEqual(ids(filterRows(rows, { issueSearch: '客户资料', issueAssigneeFilter: 'Bam', issueCreatorFilter: '老板', issueStatusFilter: '待处理' })), [1]);
    assert.deepEqual(ids(filterRows(rows, { issueSearch: '客户资料', issueAssigneeFilter: 'Bam', issueStatusFilter: '已解决' })), [6]);
    assert.deepEqual(ids(filterRows(rows, { issueSearch: '客户资料', issueDateFilter: 'custom', issueCustomFrom: '2099-01-01' })), []);
    console.log('PASS actual shared page filter: Chinese/Thai/English substring, ticket number and fallback #id, empty/space reset, no-result, keyword+owner+creator+status and date all AND together; header/table/cards share filteredIssues.');
    assert.match(page.text, /问题工单 \(\{filteredIssues\.length\}\)/); assert.match(page.text, /const filtered = filteredIssues/);
    assert(!page.text.includes('t.assignee !== issueAssigneeFilter'));
    h.setActor({ name: 'Bam', role: 'employee' }); assert.deepEqual(ids((await h.call({ assignee: 'Bambi', role: 'admin' })).body), [1, 2, 5, 6]);
    h.setActor({ name: 'Ba', role: 'employee' }); assert.deepEqual((await h.call()).body, []);
    assert.equal(h.db.prepare('SELECT total_changes() AS n').get().n, before);
    console.log('PASS existing employee visibility/creator access and auth guards preserved; filtering is read-only, no schema/data changes; isolated in-memory SQLite and VM source only.');
  } finally { h.close(); }
}
module.exports = { createIssueFilterHarness, filterRows };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
