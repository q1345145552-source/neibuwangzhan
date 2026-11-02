// Start an isolated production build first; this test intercepts APIs with actual handlers and in-memory SQLite.
// PLAYWRIGHT_MODULE can name a local Playwright installation. Never point TEST_APP_ORIGIN at production.
const{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const{createReviewHarness}=require('./test-work-report-review-todos.cjs');
const origin=process.env.TEST_APP_ORIGIN||'http://127.0.0.1:3196';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local test app only');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of[1440,390]){
  const h=createReviewHarness();let context,failPost=false,postCalls=0;const errors=[];
  h.setActor({id:4,name:'老板',role:'admin'});
  assert.equal((await h.call('item','PATCH',{action:'review',rating:4,comment:'自动点评待办',submission_revision:'version-1'})).status,200);
  const automatic=()=>JSON.stringify(h.native.prepare("SELECT * FROM todos WHERE source_type='work_report_review'").all());
  const report=()=>JSON.stringify(h.native.prepare('SELECT * FROM work_reports WHERE id=1').get());
  const autoBefore=automatic(),reportBefore=report();
  const manual=()=>h.native.prepare("SELECT * FROM todos WHERE source_type='' ORDER BY id").all();
  async function open(user){
   h.setActor(user);const c=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});c.setDefaultTimeout(15000);
   await c.addInitScript(()=>localStorage.setItem('authToken','fixture'));
   await c.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
    if(!url.pathname.startsWith('/api/'))return route.continue();
    const send=(body,status=200)=>route.fulfill({status,json:body});
    const p=url.pathname,method=request.method(),body=method==='GET'?undefined:request.postDataJSON();
    if(p==='/api/auth/me')return send(user);
    if(p==='/api/todos'){
     if(method==='POST'){postCalls++;await new Promise(resolve=>setTimeout(resolve,250));if(failPost)return send({error:'模拟创建失败，请重试'},422);}
     const r=await h.callRoute(h.listRoute,method,body);return send(r.body,r.status);
    }
    if(p==='/api/boss-supervision/pending'){const r=await h.callRoute(h.pendingRoute);return send(r.body,r.status);}
    if(p==='/api/work-reports/board'){const r=await h.call('board');return send(r.body,r.status);}
    if(p==='/api/work-reports'){const r=await h.call('list','GET',undefined,1,url.search);return send(r.body,r.status);}
    if(/^\/api\/work-reports\/\d+$/.test(p)){const r=await h.call('item',method,body,Number(p.split('/').at(-1)));return send(r.body,r.status);}
    if(/^\/api\/todos\/\d+\/seen$/.test(p)){h.native.prepare("UPDATE todos SET seen_at=datetime('now') WHERE id=?").run(Number(p.split('/').at(-2)));return send({success:true});}
    if(p==='/api/todos/unseen')return send({count:0,items:[]});
    if(p==='/api/employees')return send(h.native.prepare('SELECT * FROM employees').all());
    if(['/api/todo-categories','/api/business-types'].includes(p))return send([]);
    if(p.includes('count'))return send({count:0});
    if(method!=='GET')throw Error('Unexpected write '+p);return send({});
   });return c;
  }
  try{
   context=await open({id:4,name:'老板',role:'admin'});let page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/work-reports?report=1');await page.getByRole('button',{name:'查看 Bam 的日报详情',exact:true}).click();
   await page.getByRole('button',{name:'转待办',exact:true}).click();let dialog=page.getByRole('dialog',{name:'工作记录转待办',exact:true});
   assert.equal(await dialog.getByLabel('待办内容',{exact:true}).inputValue(),'10月29日 工作记录相关事项');
   assert.equal(await dialog.getByLabel('负责人',{exact:true}).inputValue(),'Bam');assert.equal(await dialog.getByLabel('优先级',{exact:true}).inputValue(),'普通');
   await dialog.getByRole('button',{name:'确认创建待办',exact:true}).waitFor({state:'visible'});
   await dialog.getByLabel('待办内容',{exact:true}).fill(' ');await dialog.getByRole('button',{name:'确认创建待办',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'请填写待办内容'}).waitFor();assert.equal(postCalls,0);
   await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(manual().length,0);
   await page.getByRole('button',{name:'转待办',exact:true}).click();dialog=page.getByRole('dialog',{name:'工作记录转待办',exact:true});
   await dialog.getByLabel('待办内容',{exact:true}).fill('核对工作记录中的客户资料');await dialog.getByLabel('负责人',{exact:true}).selectOption('Ing');await dialog.getByLabel('优先级',{exact:true}).selectOption('紧急');
   failPost=true;await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await dialog.getByRole('alert').filter({hasText:'模拟创建失败，请重试'}).waitFor();assert.equal(postCalls,1);assert.equal(manual().length,0);assert.equal(await dialog.getByLabel('负责人',{exact:true}).inputValue(),'Ing');
   if(width===390){await page.setViewportSize({width,height:450});await dialog.getByRole('button',{name:'确认创建待办',exact:true}).scrollIntoViewIfNeeded();}
   await page.screenshot({path:`manual-dialog-${width}.png`});
   failPost=false;await dialog.getByRole('button',{name:'确认创建待办',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(manual().length,1);const urgent=manual()[0];assert.equal(urgent.assignee,'Ing');assert.equal(urgent.priority,'紧急');assert.equal(urgent.source_id,'');assert.equal(urgent.source_revision,'');assert.equal(urgent.content,'核对工作记录中的客户资料');
   assert(h.native.prepare("SELECT 1 FROM notifications WHERE type='待办指派' AND related_id=? AND recipient='Ing'").get(String(urgent.id)));
   await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'关闭日报详情',exact:true}).click();await page.getByRole('button',{name:'批量批阅',exact:true}).click();
   for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'将 Bam 的工作记录转待办',exact:true}).click();dialog=page.getByRole('dialog',{name:'工作记录转待办',exact:true});assert.equal(await dialog.getByLabel('负责人',{exact:true}).inputValue(),'Bam');assert.equal(await dialog.getByLabel('优先级',{exact:true}).inputValue(),'普通');assert.equal(await dialog.getByLabel('待办内容',{exact:true}).inputValue(),'10月29日 工作记录相关事项');
    await dialog.getByRole('button',{name:'确认创建待办',exact:true}).click();await dialog.waitFor({state:'hidden'});
   }
   assert.equal(manual().length,3);assert.equal(manual()[1].priority,'普通');assert.equal(manual()[2].priority,'普通');assert.equal(automatic(),autoBefore);assert.equal(report(),reportBefore);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`manual-batch-${width}.png`});await context.close();
   context=await open({id:2,name:'Ing',role:'employee'});page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/todos?todo='+urgent.id);await page.getByText('核对工作记录中的客户资料',{exact:true}).filter({visible:true}).first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`manual-assigned-${width}.png`});await context.close();
   context=await open({id:1,name:'Bam',role:'employee'});page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/work-reports?report=1');await page.locator('[data-report-id="1"]').first().waitFor();assert.equal(await page.getByRole('button',{name:'批量批阅',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/转待办/}).count(),0);
   // Own report details must also have no manual conversion entry.
   await page.locator('[data-report-id="1"]').first().click();await page.getByRole('dialog',{name:/日报详情：Bam/}).waitFor();assert.equal(await page.getByRole('button',{name:/转待办/}).count(),0);
   assert.deepEqual(errors,[]);console.log(`PASS ${width}: detail+batch shared defaults, blank/cancel/real errors/double-submit lock, reassignment+urgent/default ordinary, real POST/notification/employee list, manual duplicates independent of auto task/review, employee entries hidden, responsive viewport.`);
  }finally{await context?.close();h.native.close();}
 }
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
