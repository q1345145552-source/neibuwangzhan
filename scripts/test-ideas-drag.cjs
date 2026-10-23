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
let role = 'admin', state = [], cursor = 0, calls = [];
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react') return { ...React, useEffect() {}, useRef(value) { return { current: value }; }, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = Array.isArray(initial) ? ideas : initial === true ? false : initial; return [state[i], value => { state[i] = value; }]; } };
  if (name === '@/components/auth-provider') return { useAuth: () => ({ user: { role, name: role } }) };
  if (name === 'next/navigation') return { useSearchParams: () => ({ get: () => null }) };
  if (name === '@/lib/api') return { fetchWithAuth() {} };
  if (name === '@/lib/api-call') return { async apiCall(url, options) { calls.push({ url, ...options }); return false; } };
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

const event = () => ({ prevented: false, preventDefault() { this.prevented = true; }, dataTransfer: { setData() {}, effectAllowed: '', dropEffect: '' } });
function board() { state = []; calls = []; find(render(), n => n.props?.children === '看板').props.onClick(); return render(); }
function column(tree, status) { return find(tree, n => n.props?.['data-idea-column'] === status); }
function card(tree, status) { return find(column(tree, status), n => n.type === 'article'); }
function button(tree, label) { return find(tree, n => n.props?.children === label); }
function drop(from, to) {
  let tree = board(); const source = card(tree, from);
  assert.equal(source.props.draggable, from !== '已实现');
  source.props.onDragStart(event()); tree = render();
  const target = column(tree, to), e = event(); target.props.onDragOver(e);
  target.props.onDrop(event()); return e.prevented;
}
(async () => {
  const allowed = { '待评估': ['已采纳', '已拒绝'], '已采纳': ['进行中'], '进行中': ['已实现'], '已拒绝': ['待评估'], '已实现': [] };
  for (const from of statuses.filter(s => s !== '已实现')) for (const to of statuses) {
    const valid = allowed[from].includes(to);
    assert.equal(drop(from, to), valid, from + ' → ' + to);
    if (!valid) { assert.equal(calls.length, 0); assert(!button(render(), '确认')); }
  }
  drop('待评估', '已采纳'); assert.equal(calls.length, 0);
  await button(render(), '确认').props.onClick(); assert.equal(calls.length, 0, 'empty amount rejected');
  find(render(), n => n.type === 'input' && n.props.type === 'number').props.onChange({ target: { value: '25' } });
  await button(render(), '确认').props.onClick(); assert.deepEqual(calls[0].body, { action: 'adopt', bonus_amount: 25, currency: 'THB' });
  drop('待评估', '已拒绝'); await button(render(), '确认').props.onClick(); assert.equal(calls.length, 0);
  find(render(), n => n.type === 'textarea').props.onChange({ target: { value: '原因' } });
  await button(render(), '确认').props.onClick(); assert.equal(calls[0].body.rejection_reason, '原因');
  drop('进行中', '已实现'); await button(render(), '确认').props.onClick(); assert.equal(calls.length, 0);
  find(render(), n => n.type === 'input' && n.props.placeholder === '做成了哪个功能').props.onChange({ target: { value: '功能A' } });
  await button(render(), '确认').props.onClick(); assert.equal(calls[0].body.related_feature, '功能A');
  assert.equal(calls[0].body.implementation_bonus_amount, undefined);
  drop('已采纳', '进行中'); assert.equal(calls[0].body.action, 'start');
  drop('已拒绝', '待评估'); assert.equal(calls[0].body.action, 'reopen');
  drop('待评估', '已采纳'); button(render(), '取消').props.onClick(); assert.equal(calls.length, 0); assert(!button(render(), '确认'));
  let tree = board(); for (const label of ['采纳', '拒绝', '进行中', '已实现', '重新评估']) assert(button(tree, label), label + ' button fallback');
  button(tree, '拒绝').props.onClick(); assert(button(render(), '确认'));
  role = 'employee'; tree = board(); assert.equal(card(tree, '待评估').props.draggable, false); assert(!button(tree, '采纳'));
  console.log('PASS drag transition matrix, modal validation, cancellation, direct moves, button fallback and permissions');
})().catch(e => { console.error(e); process.exitCode = 1; });
