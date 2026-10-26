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
 const region=()=>page.getByRole('region',{name:'内部创建趋势',exact:true});
 const table=()=>page.getByRole('region',{name:'趋势完整数据表，可滚动'});
 async function total(expected){await page.getByTestId('trend-total').waitFor();assert.equal(await page.getByTestId('trend-total').innerText(),String(expected));}
 async function setMonth(){await page.getByLabel('时间粒度',{exact:true}).selectOption('month');}
 async function screenshot(name){await region().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,name),fullPage:true});await page.screenshot({path:path.join(evidence,name.replace('.png','-viewport.png'))});}
 await mode('rich');await page.goto(app+'/visualization');await ready();await applyDates('2025-12-20','2026-02-10');await ready();await total(136);
 assert.equal(await table().locator('tbody tr').count(),53);await overflow('desktop trend');await screenshot('1440-daily-trend.png');
 await setMonth();await total(136);assert.equal(await table().locator('tbody tr').count(),3);assert.equal(await table().getByText('部分月，仅所选日期',{exact:true}).count(),2);await screenshot('1440-month-partial.png');
 await page.getByRole('button',{name:'查看2025-12全部记录办理份明细',exact:true}).click();await page.getByText('全量匹配 1 份',{exact:false}).waitFor();await page.getByText('2025-12-20 至 2025-12-31 内部新增',{exact:false}).waitFor();await close();
 await page.getByRole('button',{name:'查看2026-01全部记录办理份明细',exact:true}).focus();await page.keyboard.press('Enter');await page.getByText('全量匹配 135 份',{exact:false}).waitFor();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 7 页',{exact:false}).waitFor();await page.screenshot({path:path.join(evidence,'1440-month-exact-page2.png'),fullPage:true});await close();operations.push('complete53 days/month3 totals136, partial-month clamp, keyboard point and135 records/page2');
 await page.getByLabel('分组方式',{exact:true}).selectOption('status');await page.getByLabel('趋势分类',{exact:true}).selectOption('客户取消');await total(19);await page.getByRole('button',{name:'查看2026-01客户取消办理份明细',exact:true}).click();await page.getByText('全量匹配 19 份',{exact:false}).waitFor();await close();
 await page.getByLabel('趋势单位',{exact:true}).selectOption('parents');await total(2);assert.equal(await page.getByLabel('分组方式',{exact:true}).locator('option[value=status]').count(),0);
 await page.locator('.recharts-bar-rectangle').first().click();await page.getByText('全量匹配 1 笔',{exact:false}).waitFor();await close();
 await page.getByLabel('分组方式',{exact:true}).selectOption('source');await page.getByLabel('趋势分类',{exact:true}).selectOption('saved_source');await total(1);await page.getByRole('button',{name:'查看2026-01内部已保存来源可信父交易明细',exact:true}).click();await page.getByText('全量匹配 1 笔',{exact:false}).waitFor();await close();await screenshot('1440-parent-source.png');operations.push('actual bar click, separate parent units, source/status exact subsets, no awaiting stacking');
 assert.match(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).innerText(),/138/);
 await mode('unknown');await refresh();await total(136);await region().getByText('另有 2 份创建日期无法判断',{exact:false}).waitFor();await page.getByRole('button',{name:'查看日期未知记录',exact:true}).click();await page.getByText('全量匹配 2 份',{exact:false}).waitFor();await close();await screenshot('1440-date-unknown.png');
 await mode('conflict');await refresh();await setMonth();await page.getByLabel('分组方式',{exact:true}).selectOption('source');await page.getByLabel('趋势分类',{exact:true}).selectOption('conflict');await total(1);await screenshot('1440-conflict-source.png');operations.push('unknown dates never assigned to selected period; conflict category remains distinct');
 await mode('partial');await refresh();await total(136);await page.getByText('此模块加载失败，未显示替代数字。',{exact:true}).first().waitFor();
 await mode('trend-failed');await page.getByRole('button',{name:'重新读取总览',exact:true}).click();await page.getByText('办理份趋势加载失败，未绘制零线。',{exact:true}).waitFor();assert.equal(await page.locator('.recharts-bar').count(),0);await screenshot('1440-trend-failed.png');await mode('rich');await page.getByRole('button',{name:'重试趋势',exact:true}).click();await ready();await total(136);
 await mode('failed');await page.getByRole('button',{name:'重新读取总览',exact:true}).click();await page.getByText('总览加载失败，没有将失败显示为0。',{exact:true}).waitFor();await mode('rich');await page.getByRole('button',{name:'重试加载',exact:true}).click();await ready();await total(136);operations.push('financial partial failure preserves trend; trend/overall failure has no zero line; retry restores known values');
 await mode('empty');await refresh();await total(0);assert.equal(await table().locator('tbody tr').count(),53);await setMonth();await page.getByRole('button',{name:'查看2025-12全部记录办理份明细',exact:true}).click();await page.getByText('查询成功，本范围没有匹配记录。',{exact:true}).waitFor();await close();operations.push('successful empty days/months zero-filled and zero point detail is accessible');
 await mode('race');await refresh();await applyDates('2025-12-20','2026-02-10');await page.waitForTimeout(120);await applyDates('2026-01-01','2026-01-31');await ready();await total(135);await page.waitForTimeout(1000);await total(135);assert.match(await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).innerText(),/138/);operations.push('late response cannot replace newer trend; current stock unaffected by creation date');
 await mode('rich');await page.setViewportSize({width:390,height:844});await applyDates('2025-12-20','2026-02-10');await ready();await total(136);await overflow('mobile daily');await screenshot('390-daily-trend.png');
 await page.getByRole('region',{name:'内部创建趋势图，可局部横向滚动'}).evaluate(el=>el.scrollLeft=el.scrollWidth);await overflow('mobile local chart scroll');await setMonth();await total(136);await page.waitForFunction(() => document.querySelector('[aria-label="内部创建趋势图，可局部横向滚动"]').scrollLeft === 0);await screenshot('390-month-trend.png');
 await page.getByRole('button',{name:'查看2026-01全部记录办理份明细',exact:true}).click();await page.getByText('全量匹配 135 份',{exact:false}).waitFor();await page.getByRole('button',{name:'下一页',exact:true}).click();await page.getByText('第 2 / 7 页',{exact:false}).waitFor();await overflow('mobile trend details');await page.screenshot({path:path.join(evidence,'390-month-details.png'),fullPage:true});await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
 await page.getByLabel('趋势单位',{exact:true}).selectOption('parents');await total(2);await screenshot('390-parent-trend.png');operations.push('390 daily scroll, monthly view, parent toggle, exact month135/page2 and Escape close; no full-page overflow');
 await applyDates('2025-03-01','2026-02-28');await ready();await total(138);assert.equal(await table().locator('tbody tr').count(),365);await overflow('365-day mobile');await screenshot('390-long-range.png');operations.push('365 complete server days retained beyond100, local chart/table scroll');
 for(const role of ['employee','client']){await mode(role);await page.reload();await page.getByText('无权限。数据总览仅向管理员开放。',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'内部创建趋势',exact:true}).count(),0);await page.screenshot({path:path.join(evidence,'390-'+role+'-denied.png'),fullPage:true});}
 operations.push('employee/client cannot see trend or retrieve global data');
 assert.equal(errors.length,0,errors.join('\n'));
 fs.writeFileSync(path.join(root,'trend-browser-evidence.json'),JSON.stringify({operations,errors,network,screenshots:fs.readdirSync(evidence),fixtureTrace:await(await fetch(fixture+'/__trace')).json(),limitations:['Target isolated Next page only, system-font root and navigation sentinels; no original DB-backed workflow executed.','Actual API GET/runtime/aggregation uses synthetic SQL interpreter, never a real SQLite file.']},null,2));
 console.log('PASS '+operations.length+' trend operation groups; screenshots '+fs.readdirSync(evidence).length+'; no legacy API/write request/page error');await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
