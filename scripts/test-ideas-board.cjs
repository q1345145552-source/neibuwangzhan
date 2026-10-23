// Render the real page with fixture data; exercise its view controls without touching app data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const statuses = ['待评估', '已采纳', '进行中', '已实现', '已拒绝'];
const ideas = [0, 1].flatMap(is_boss => statuses.map((status, n) => ({ id: is_boss * 10 + n, title: `${is_boss ? '老板' : '同事'}${status}`, status, is_boss, category: '业务改进', source: is_boss ? '老板' : '同事', created_at: '2026-10-15 10:00:00', bonus_amount: 0, currency: 'CNY', related_feature: '关联功能A', rejection_reason: '拒绝原因A' })));
let role = 'employee', state = [], cursor = 0;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react') return { ...React, useEffect() {}, useRef(value) { return { current: value }; }, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = Array.isArray(initial) ? ideas : initial === true ? false : initial; return [state[i], value => { state[i] = value; }]; } };
  if (name === '@/components/auth-provider') return { useAuth: () => ({ user: { role, name: role } }) };
  if (name === 'next/navigation') return { useSearchParams: () => ({ get: () => null }) };
  if (name === '@/lib/api') return { fetchWithAuth() {} };
  if (name === '@/lib/api-call') return { apiCall() {} };
  if (name === '@/lib/utils') return { cn: (...s) => s.join(' '), toThaiTime: s => s };
  if (name === '@/components/ui/button') return { Button: ({ children, size, variant, ...props }) => React.createElement('button', props, children) };
  return originalLoad.call(this, name, ...args);
};
const file = path.join(root, 'src/app/(app)/ideas/page.tsx');
const mod = new Module(file, module); mod.filename = file; mod.paths = module.paths;
mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const Page = mod.exports.default;
function render() { cursor = 0; return Page(); }
function find(node, predicate) { if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of React.Children.toArray(node.props?.children)) { const match = find(child, predicate); if (match) return match; } }
for (role of ['employee', 'admin']) {
  state = [];
  let tree = render();
  const toggle = find(tree, n => n.props?.children === '看板');
  assert(toggle, '看板切换按钮存在'); toggle.props.onClick(); tree = render();
  let html = renderToStaticMarkup(tree);
  assert.equal((html.match(/data-idea-column=/g) || []).length, role === 'admin' ? 5 : 4);
  for (const status of statuses) {
    const stat = find(tree, n => n.props?.['data-idea-stat'] === status);
    assert(stat, status + '统计存在');
    assert.equal(stat.props['data-count'], role === 'admin' ? 2 : 1);
  }
  for (const status of role === 'admin' ? statuses : statuses.slice(0, 4)) {
    const column = find(tree, n => n.props?.['data-idea-column'] === status);
    const columnHtml = renderToStaticMarkup(column);
    assert(columnHtml.includes('同事' + status));
    assert(columnHtml.includes((role === 'admin' ? '2' : '1') + ' 条'));
    for (const other of statuses.filter(value => value !== status)) assert(!columnHtml.includes('同事' + other));
  }
  assert(html.includes('奖金')); assert(html.includes('本次采纳无奖金（0 CNY）')); assert(html.includes('关联功能A'));
  assert(html.includes('业务改进')); assert(html.includes('来源：')); assert(html.includes('2026-10-15'));
  assert.equal(html.includes('老板待评估'), role === 'admin');
  assert.equal(html.includes('拒绝原因A'), role === 'admin');
  find(tree, n => n.props?.children === '列表').props.onClick();
  html = renderToStaticMarkup(render()); assert(!html.includes('data-idea-column'));
  assert(html.includes('同事待评估')); assert.equal(html.includes('老板待评估'), role === 'admin');
  state[0] = []; find(render(), n => n.props?.children === '看板').props.onClick();
  tree = render(); html = renderToStaticMarkup(tree);
  assert.equal((html.match(/data-idea-column=/g) || []).length, role === 'admin' ? 5 : 4);
  for (const status of statuses) assert.equal(find(tree, n => n.props?.['data-idea-stat'] === status).props['data-count'], 0);
  console.log('PASS', role, 'view switching, columns, counts, card fields, visibility and empty board');
}
