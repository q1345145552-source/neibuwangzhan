/** Actual isolated Next page + compiled real GET; no production API or SQLite. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.argv[2];if(root!=='/private/tmp/internal-vis-round6')throw Error('FIXED_ISOLATION_REQUIRED');
const {chromium}=require('/Users/xiongliu/.local/share/rea/lib/node_modules/rea-agents/node_modules/playwright-core');
const app='http://127.0.0.1:43185',fixture='http://127.0.0.1:43184';
(async()=>{
 const out=path.join(root,'screenshots');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Bangkok',serviceWorkers:'block'});
 const token=await(await fetch(fixture+'/__token')).text();await context.addInitScript(t=>sessionStorage.setItem('authToken',t),token);
 const network=[],errors=[],operations=[];context.setDefaultTimeout(15000);
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==app){errors.push('External request '+url.origin);return route.abort();}if(url.pathname.startsWith('/api/')&&(!['/api/visualization/delivery','/api/visualization/overview'].includes(url.pathname)||req.method()!=='GET')){errors.push('Forbidden API '+req.method()+' '+url.pathname);return route.abort();}network.push({method:req.method(),url:url.pathname+url.search});return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 async function mode(m){await fetch(fixture+'/__fixture?mode='+m);}
 async function ready(n){await page.getByTestId('delivery-total').waitFor();await assert.doesNotReject(async()=>{assert.equal(await page.getByTestId('delivery-total').innerText(),String(n));});}
 async function visit(m='rich',n=135){await mode(m);await page.goto(app+'/visualization/delivery');if(n!==null)await ready(n);}
 async function apply(){await page.getByRole('button',{name:'应用筛选',exact:true}).click();}
 async function reset(n=135){await page.getByRole('button',{name:'重置筛选',exact:true}).click();await ready(n);}
 async function screenshot(name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'global overflow '+name);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});await page.screenshot({path:path.join(out,name+'-viewport.png')});}
 function pass(s){operations.push(s);console.log('PASS '+s);}
 await visit();await screenshot('1440-delivery');assert.match(await page.locator('body').innerText(),/D-000/);assert.equal(await page.getByRole('link',{name:'订单交付',exact:true}).getAttribute('aria-current'),'page');
 await page.getByRole('button',{name:'下一页',exact:true}).click();await ready(135);assert.match(await page.locator('body').innerText(),/第2页/);await screenshot('1440-page2');
 await reset();await page.getByLabel('内部编号（精确匹配）').fill('O1');assert.equal(await page.getByTestId('delivery-total').count(),0);assert.match(await page.locator('body').innerText(),/筛选尚未应用/);await apply();await ready(1);assert.equal(await page.locator('ul').filter({hasText:'注册步骤甲'}).first().locator('li').count(),2);await screenshot('1440-parallel');
 await page.getByRole('button',{name:'补件待审核：1条',exact:true}).click();await page.locator('dialog').waitFor();assert.match(await page.locator('dialog').innerText(),/文档 #11/);assert.doesNotMatch(await page.locator('dialog').innerText(),/旧退回/);assert.equal(await page.locator('dialog a').getAttribute('href'),'/orders/O1');await screenshot('1440-material-review');await page.keyboard.press('Escape');await page.locator('dialog').waitFor({state:'detached'});
 pass('1440 default backlog, page2, dirty hide, parallel steps and exact latest-review dialog/deep link/ESC');
 await reset();await page.getByLabel('资料类别',{exact:true}).selectOption('review');await apply();await ready(2);assert.match(await page.locator('body').innerText(),/O1/);assert.match(await page.locator('body').innerText(),/O2/);await page.getByLabel('订单负责人（完整原文）').selectOption('v:历史离职姓名');await apply();await ready(1);assert.match(await page.locator('body').innerText(),/普通第一步/);assert.doesNotMatch(await page.locator('ul').filter({hasText:'普通第一步'}).first().innerText(),/普通第二步/);
 await reset();await page.getByLabel('开始日（曼谷）').fill('2026-10-01');await page.getByLabel('结束日（含当天）').fill('2026-10-31');await apply();await ready(134);assert.ok(network.some(r=>r.url.includes('to=2026-11-01')));
 pass('exact material/owner filters, ordinary first-open step and inclusive Bangkok end date');
 await visit('many-materials');await page.getByLabel('内部编号（精确匹配）').fill('O1');await apply();await ready(1);await page.getByRole('button',{name:'补件需求未提交：125条',exact:true}).click();await page.locator('dialog').waitFor();await page.getByRole('button',{name:'下一页资料',exact:true}).click();assert.match(await page.locator('dialog').innerText(),/第2页 \/ 7页 · 共125条/);await screenshot('1440-materials-page2');await page.getByRole('button',{name:'关闭资料明细'}).click();
 pass('125 material facts, stable local complete-detail pagination and close');
 await visit('partial');assert.match(await page.locator('body').innerText(),/资料读取失败/);assert.doesNotMatch(await page.locator('body').innerText(),/步骤需求未交：0条/);await screenshot('1440-partial');
 await visit('orders-failed',null);await page.getByText('订单模块读取失败，无法判断数量').waitFor();assert.equal(await page.getByTestId('delivery-total').count(),0);await mode('rich');await page.getByRole('button',{name:'重试读取',exact:true}).click();await ready(135);
 await visit('failed',null);await page.getByRole('button',{name:'重试读取',exact:true}).waitFor();await mode('empty');await page.getByRole('button',{name:'重试读取',exact:true}).click();await ready(0);await screenshot('1440-empty');
 await visit('conflict');await page.getByLabel('来源',{exact:true}).selectOption('conflict');await apply();await ready(1);await screenshot('1440-source-conflict');
 pass('module and overall failure have no fake zeros; retry/empty/conflict exact one row');
 await visit('race');await page.getByLabel('当前订单状态').selectOption('all');await apply();await page.waitForTimeout(100);await page.getByLabel('当前订单状态').selectOption('已完成');await apply();await ready(1);await page.waitForTimeout(1100);await ready(1);assert.match(await page.locator('body').innerText(),/D-002/);pass('old delayed all-state request cannot replace newer completed subset');
 await page.setViewportSize({width:390,height:844});await visit();await screenshot('390-delivery');await page.getByRole('button',{name:'下一页',exact:true}).click();await ready(135);await screenshot('390-page2');await reset();await page.getByLabel('内部编号（精确匹配）').fill('O1');await apply();await ready(1);await page.getByRole('button',{name:'补件退回待重交：1条',exact:true}).click();await page.locator('dialog').waitFor();await screenshot('390-material-returned');await page.getByRole('button',{name:'关闭资料明细'}).click();pass('390 filters/row pagination/material dialog/close, no global horizontal overflow');
 await visit('employee');assert.equal(await page.getByTestId('delivery-total').innerText(),'135');await screenshot('390-employee-delivery');
 const overview=await context.request.get(app+'/api/visualization/overview?from=2026-10-01&to=2026-11-01',{headers:{Authorization:'Bearer '+token}});assert.equal(overview.status(),403);
 await visit('client',null);await page.getByText('当前账号无权读取订单交付').first().waitFor();assert.equal(await page.getByTestId('delivery-total').count(),0);assert.equal(await page.getByRole('link',{name:'订单交付',exact:true}).count(),0);await screenshot('390-client-denied');pass('employee reads original all-order scope but not boss overview; client denied delivery data');
 await mode('rich');await page.setViewportSize({width:1440,height:1000});await page.goto(app+'/visualization');await page.getByRole('button',{name:'查看当前办理份数明细',exact:true}).waitFor();await page.getByTestId('trend-total').waitFor();await page.getByRole('link',{name:'订单交付',exact:true}).click();await ready(135);for(const [name,href]of [['仪表盘','/'],['订单管理','/orders'],['费用管理','/finance']]){assert.equal(await page.getByRole('link',{name,exact:true}).getAttribute('href'),href);}pass('overview cards/trends preserved, delivery navigation enters, original paths preserved (safe placeholders only)');
 assert.deepEqual(errors,[]);const trace=await(await fetch(fixture+'/__trace')).json();fs.writeFileSync(path.join(root,'delivery-browser-evidence.json'),JSON.stringify({operations,network,errors,trace,viewports:[1440,390],synthetic:true,limitations:'isolated target build; original navigation destinations are safe placeholders; no real data'},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
