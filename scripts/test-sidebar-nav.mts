/**
 * 左边菜单重新分组（2026-11-03）：只挪位置，名字、地址、谁能看到都不能变。
 * 下面 OLD_* 是改之前 sidebar.tsx 里的清单和过滤规则，拿它逐个角色对照。
 * 只有「代理记账」是同一批新加的，所以写在 OLD_INTERNAL 和 OLD_ADMIN_ONLY 里：菜单和代理记账功能要一起上线。
 * Run (from this repo): node --import <tsx loader> scripts/test-sidebar-nav.mts
 */
import assert from 'node:assert/strict';
import { BOTTOM_NAV, NAV_GROUPS, TOP_NAV, groupKeyOf, groupsForRole, navForRole } from '../src/components/sidebar-nav';

const OLD_NAVIGATION: [string, string][] = [['全局搜索', '/search'], ['公司档案', '/company-archives'], ['我的文件夹', '/my-folder'], ['仪表盘', '/'], ['数据总览', '/visualization'], ['监督看板', '/boss-supervision'], ['我的待办', '/todos'], ['工单', '/issues'], ['我的项目', '/projects'], ['员工动态', '/activity'], ['消息', '/messages'], ['消息中心', '/notifications'], ['老板通知', '/announcements'], ['通知/规则', '/notice-rules'], ['规则库', '/rules'], ['工作记录', '/work-reports'], ['会议记录', '/meetings'], ['资产台账', '/assets'], ['想法记录', '/ideas']];
const OLD_BUSINESS: [string, string][] = [['订单管理', '/orders'], ['待分类（待领取）', '/orders/unclassified'], ['公司注册', '/company-registration'], ['工作签证', '/work-visa'], ['社保开户', '/social-security'], ['商标', '/trademark'], ['FDA认证', '/fda-certification'], ['TISI', '/tisi'], ['DLD', '/dld'], ['清关', '/customs-clearance'], ['地址认证', '/address-certification'], ['Mall开店', '/mall-store'], ['店铺管理', '/internal/shopee'], ['NBTC', '/nbtc']];
const OLD_CUSTOMER: [string, string][] = [['客户管理', '/customers'], ['问题跟踪', '/problems'], ['客户评价', '/customer-ratings']];
const OLD_VAT: [string, string][] = [['VAT申报', '/vat'], ['预扣税申报', '/wht']];
const OLD_AGENCY: [string, string][] = [['机构管理', '/agency'], ['达人发现', '/agency/influencers'], ['签约跟进', '/agency/contracts'], ['品牌孵化', '/agency/incubation']];
const OLD_LOGISTICS: [string, string][] = [['轨迹更新', '/logistics'], ['话术模板', '/logistics/scripts']];
const OLD_INTERNAL: [string, string][] = [['内部管理', '/internal'], ['员工档案', '/internal/employees'], ['请假', '/internal/leave'], ['奖惩制度', '/internal/rewards'], ['周报', '/internal/weekly-report'], ['模板库', '/internal/templates'], ['办理月报', '/internal/handling-report'], ['代理记账', '/agent-rebates']];
const OLD_UTILITY: [string, string][] = [['任务看板', '/tasks'], ['文档管理', '/documents'], ['费用管理', '/finance'], ['流程设置', '/workflows'], ['设置', '/settings']];
const OLD_ADMIN_ONLY = new Set(['办理月报', '流程设置', '代理记账']);

function oldVisible(role: string | undefined, agencyEnabled: boolean): string[] {
  const nav = role === 'admin' ? OLD_NAVIGATION : OLD_NAVIGATION.filter(([n]) => !(role === 'client' && ['全局搜索', '我的文件夹', '公司档案'].includes(n)) && n !== '数据总览' && n !== '监督看板' && n !== '员工动态' && n !== '我的项目' && !(role === 'client' && n === '通知/规则'));
  const customer = role === 'client' ? OLD_CUSTOMER.filter(([n]) => n !== '客户评价') : OLD_CUSTOMER;
  const forRole = (items: [string, string][]) => role === 'admin' ? items : items.filter(([n]) => !OLD_ADMIN_ONLY.has(n));
  return [...nav, ...OLD_VAT, ...customer, ...OLD_BUSINESS, ...(agencyEnabled ? OLD_AGENCY : []), ...OLD_LOGISTICS, ...forRole(OLD_INTERNAL), ...forRole(OLD_UTILITY)].map(([n, h]) => `${n} ${h}`).sort();
}
function newVisible(role: string | undefined, agencyEnabled: boolean): string[] {
  return [...navForRole(TOP_NAV, role), ...groupsForRole(role, agencyEnabled).flatMap(g => g.items), ...navForRole(BOTTOM_NAV, role)].map(i => `${i.name} ${i.href}`).sort();
}

for (const role of ['admin', 'employee', 'client', undefined]) for (const agency of [true, false]) {
  assert.deepEqual(newVisible(role, agency), oldVisible(role, agency), `${role} agency=${agency}`);
}
assert.equal(newVisible('admin', true).length, 57, '一项不多一项不少');
assert.equal(new Set(newVisible('admin', true)).size, 57, '没有重复');

const storefront = NAV_GROUPS.find(g => g.key === 'storefront');
assert.ok(storefront && storefront.defaultOpen && NAV_GROUPS[0] === storefront, '业务系统是第一组，默认展开');
assert.deepEqual(storefront.items.map(i => i.name), ['订单管理', '待分类（待领取）', '客户评价', '代理记账', '流程设置', '办理月报']);
assert.deepEqual(groupsForRole('employee', true).find(g => g.key === 'storefront')?.items.map(i => i.name), ['订单管理', '待分类（待领取）', '客户评价'], '员工看不到代理记账');
assert.deepEqual(groupsForRole('client', true).find(g => g.key === 'storefront')?.items.map(i => i.name), ['订单管理', '待分类（待领取）']);
assert.equal(NAV_GROUPS.filter(g => g.defaultOpen).length, 1, '其他分组默认收起');

for (const [path, key] of [['/orders', 'storefront'], ['/orders/ORD1', 'storefront'], ['/orders/unclassified', 'storefront'], ['/agent-rebates', 'storefront'], ['/internal/handling-report', 'storefront'], ['/company-registration', 'business'], ['/internal', 'internal'], ['/internal/leave', 'internal'], ['/internal/weekly-report', 'work'], ['/internal/payslips', 'internal'], ['/agency/factories', 'agency'], ['/agency/factories/3', 'agency'], ['/vat/3', 'finance'], ['/agency/contracts', 'agency'], ['/logistics/scripts', 'logistics'], ['/', null], ['/settings', null]] as const) {
  assert.equal(groupKeyOf(path), key, path);
}
console.log('ALL PASS');
