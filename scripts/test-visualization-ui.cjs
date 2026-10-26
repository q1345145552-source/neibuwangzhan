/** Local isolated Next page + synthetic SQL-backed real GET only. No production services. */
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=process.argv[2];
if(!root||!path.resolve(root).startsWith('/private/tmp/'))throw Error('ISOLATION_REQUIRED');
const {chromium}=require('/Users/xiongliu/.local/share/rea/lib/node_modules/rea-agents/node_modules/playwright-core');
const app='http://127.0.0.1:43185',fixture='http://127.0.0.1:43184';
const evidence=path.join(root,'screenshots');fs.mkdirSync(evidence,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Bangkok',serviceWorkers:'block'});
 const token=await (await fetch(fixture+'/__token')).text();
 await context.addInitScript(token=>sessionStorage.setItem('authToken',token),token);
 context.setDefaultTimeout(15000);
 const network=[],errors=[],operations=[];
 const push = operations.push.bind(operations); operations.push = value => { console.log('PASS '+value); return push(value); };
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!req.url().startsWith(app+'/')) {network.push({blocked:true,url:req.url()});return route.abort();}
  if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/visualization/overview') {errors.push('Forbidden legacy API '+url.pathname);return route.abort();}
  if(url.pathname.startsWith('/api/')&&req.method()!=='GET'){errors.push('Write request');return route.abort();}
  network.push({method:req.method(),url:url.pathname+url.search});return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 async function mode(name){await fetch(fixture+'/__fixture?mode='+name);}
 async function ready(){await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).waitFor();}
 async function refresh(){await page.getByRole('button',{name:'重新读取总览',exact:true}).click();await ready();}
 async function applyDates(from,end){await page.getByLabel('内部创建开始日',{exact:true}).fill(from);await page.getByLabel('内部创建结束日',{exact:true}).fill(end);await page.getByRole('button',{name:'应用筛选',exact:true}).click();}
 async function close(){await page.getByRole('button',{name:'关闭明细'}).click();await page.locator('dialog').waitFor({state:'detached'});}
 async function overflow(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' page overflow');}
 await mode('rich');await page.goto(app+'/visualization');await ready();await applyDates('2026-10-01','2026-10-31');await ready();
 assert.match(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).innerText(),/138/);
 assert.match(await page.getByRole('button',{name:'查看期间内部新增办理份明细',exact:true}).innerText(),/137/);
 assert.match(await page.getByRole('button',{name:'查看可信父交易明细',exact:true}).innerText(),/2/);
 await overflow('desktop');await page.screenshot({path:path.join(evidence,'1440-overview.png'),fullPage:true});await page.screenshot({path:path.join(evidence,'1440-viewport.png')});operations.push('1440 current138/period137/parents2, inclusive Oct31, parent cross-period');
 await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).click();await page.getByText('全量匹配 138 份',{exact:false}).waitFor();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 7 页',{exact:false}).waitFor();await page.screenshot({path:path.join(evidence,'1440-paged-details.png'),fullPage:true});await close();operations.push('138-record exact details, page2/7, 20/page');
 await page.getByRole('button',{name:'查看收入待核对明细',exact:true}).click();await page.getByText('全量匹配 1 条',{exact:false}).waitFor();assert.equal(await page.locator('dialog tbody tr').count(),1);await close();
 await page.getByRole('button',{name:'查看内部已记录到账收入明细',exact:true}).click();await page.getByText('全量匹配 3 条',{exact:false}).waitFor();assert.equal(await page.locator('dialog tbody tr').count(),3);await close();operations.push('paid / waiting subset counts3/1 from real filtered GET');
 await page.getByRole('button',{name:'核对信息缺失 2笔 · 查看',exact:true}).click();await page.getByText('全量匹配 2 条',{exact:false}).waitFor();await close();
 await page.getByRole('button',{name:'查看可信父交易明细',exact:true}).click();await page.getByText('查看全部 2 份办理',{exact:true}).click();assert.equal(await page.locator('dialog a[href="/orders/O1"]').count(),1);assert.equal(await page.locator('dialog a[href="/orders/O2"]').count(),1);await page.screenshot({path:path.join(evidence,'1440-parent-children.png'),fullPage:true});await close();
 await page.getByRole('button',{name:'待处理工单 23',exact:true}).click();await page.getByText('全量匹配 23 条',{exact:false}).waitFor();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 2 页',{exact:false}).waitFor();assert.equal(await page.locator('dialog tbody tr').count(),3);await close();operations.push('pending category23 and original exact issue links; parent all children');
 await page.getByLabel('订单来源',{exact:true}).selectOption('commerce');await page.getByText('筛选已更改，尚未应用。',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).count(),0);await page.getByRole('button',{name:'应用筛选',exact:true}).click();await ready();assert.match(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).innerText(),/2/);assert.match(await page.getByRole('button',{name:'查看原清单待处理事项明细',exact:true}).innerText(),/24/);assert.equal(await page.getByRole('button',{name:'内部已保存来源 0笔',exact:true}).count(),0);
 await page.getByLabel('订单来源',{exact:true}).selectOption('all');await page.getByRole('button',{name:'应用筛选',exact:true}).click();await ready();
 await mode('race');await applyDates('2026-09-01','2026-09-30');await page.waitForTimeout(150);await applyDates('2026-10-01','2026-10-31');await ready();await page.waitForTimeout(1000);assert.match(await page.getByRole('button',{name:'查看期间内部新增办理份明细',exact:true}).innerText(),/137/);operations.push('source applied only after action; stale delayed request cannot replace newer October query');
 await mode('unknown');await refresh();await page.getByText('部分数据无法判断',{exact:false}).first().waitFor();await page.getByRole('button',{name:'查看内部已记录到账收入明细',exact:true}).click();await page.getByText('全量匹配 5 条',{exact:false}).waitFor();await page.getByText('币种未记录 / 无效',{exact:true}).waitFor();await page.locator('dialog td').filter({hasText:'金额无效'}).first().waitFor();await page.screenshot({path:path.join(evidence,'1440-unknown-finances.png'),fullPage:true});await close();
 await mode('partial');await refresh();await page.getByText('此模块加载失败，未显示替代数字。',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'查看内部已记录到账收入明细',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).count(),1);await page.screenshot({path:path.join(evidence,'1440-partial-failure.png'),fullPage:true});
 await mode('rich');await page.getByRole('button',{name:'重试模块',exact:true}).first().click();await ready();await page.getByRole('button',{name:'查看内部已记录到账收入明细',exact:true}).waitFor();
 await mode('failed');await page.getByRole('button',{name:'重新读取总览',exact:true}).click();await page.getByText('总览加载失败，没有将失败显示为0。',{exact:true}).waitFor();await mode('rich');await page.getByRole('button',{name:'重试加载',exact:true}).click();await ready();operations.push('unknown currency/invalid money; partial/overall failure and retry, no zero replacement');
 await mode('empty');await refresh();assert.match(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).innerText(),/0/);await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).click();await page.getByText('查询成功，本范围没有匹配记录。',{exact:true}).waitFor();await close();operations.push('successful empty state only uses zero');
 await mode('rich');await refresh();await page.setViewportSize({width:390,height:844});await overflow('mobile');await page.screenshot({path:path.join(evidence,'390-overview.png'),fullPage:true});await page.screenshot({path:path.join(evidence,'390-viewport.png')});
 await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).click();await page.getByText('全量匹配 138 份',{exact:false}).waitFor();await overflow('mobile modal');await page.getByRole('region',{name:'明细表，可局部横向滚动'}).evaluate(el=>el.scrollLeft=el.scrollWidth);await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 7 页',{exact:false}).waitFor();await page.screenshot({path:path.join(evidence,'390-details-page2.png'),fullPage:true});await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});operations.push('390 filters, modal local scroll/page2, escape-close, no document horizontal overflow');
 await mode('mismatch');await refresh();await page.getByRole('button',{name:'查看商城当前账面待收明细',exact:true}).click();await page.getByText('账本收款与已记录到账收入存在口径差异，未强制调整。',{exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'390-ledger-difference.png'),fullPage:true});await close();
 for(const role of ['employee','client']){await mode(role);await page.reload();await page.getByText('无权限。数据总览仅向管理员开放。',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).count(),0);await page.screenshot({path:path.join(evidence,'390-'+role+'-denied.png'),fullPage:true});}
 operations.push('employee/client direct page has no numbers; actual API403');
 assert.equal(errors.length,0,errors.join('\n'));
 for(const [name,href]of [['仪表盘','/'],['订单管理','/orders'],['费用管理','/finance'],['全局搜索','/search'],['我的文件夹','/my-folder']])assert.equal(await page.getByRole('navigation',{name:'系统导航'}).getByRole('link',{name,exact:true}).getAttribute('href'),href);
 await mode('rich');
 for(const [name,href]of [['仪表盘','/'],['订单管理','/orders'],['费用管理','/finance'],['全局搜索','/search'],['我的文件夹','/my-folder']]){await page.goto(app+'/visualization');await ready();await page.getByRole('navigation',{name:'系统导航'}).getByRole('link',{name,exact:true}).click();await page.getByText('隔离导航目标 '+href,{exact:true}).waitFor();}
 operations.push('original home/orders/finance and parallel search/folder links navigate to exact safe sentinel routes');
 fs.writeFileSync(path.join(root,'browser-evidence.json'),JSON.stringify({operations,errors,network,screenshots:fs.readdirSync(evidence),fixtureTrace:await(await fetch(fixture+'/__trace')).json(),limitations:['Navigation destinations are safe isolation sentinels, original DB-backed pages were not started.','Next isolation root uses system fonts and omits original instrumentation/service worker.']},null,2));
 console.log('PASS '+operations.length+' real-page operation groups; 1440/390 screenshots '+fs.readdirSync(evidence).length+'; no legacy API, write requests or page errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
