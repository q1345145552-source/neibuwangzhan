#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local Chromium regression CLI. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(process.env.INTERNAL_SOURCE_ROOT||process.cwd()),home=os.homedir(),localRequire=createRequire(path.join(root,'package.json'));
const base=new URL(process.env.MERGE_URL);assert(['127.0.0.1','localhost','[::1]'].includes(base.hostname));const url=base.origin;
const snapshot=JSON.parse(fs.readFileSync(process.env.MERGE_CATALOG_SNAPSHOT,'utf8')),password=process.env.MERGE_PASSWORD,out=process.env.MERGE_BROWSER_OUT;
assert(password&&out);fs.mkdirSync(out,{recursive:true});
function directories(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

function loadPlaywright() {
  const npx = path.join(home, '.npm', '_npx');
  for (const name of [
    'playwright', 'playwright-core',
    ...directories(npx).map(entry => path.join(npx, entry, 'node_modules', 'playwright')),
  ]) {
    try { return localRequire(name); } catch { /* Try an existing local installation. */ }
  }
  throw new Error('An existing Playwright installation is required; this test does not install dependencies');
}

function chromiumExecutable(playwright) {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) {
    assert(fs.existsSync(override), 'Configured Chromium executable does not exist');
    return override;
  }
  const bundled = playwright.chromium.executablePath();
  if (fs.existsSync(bundled)) return bundled;
  const caches = [path.join(home, 'Library', 'Caches', 'ms-playwright'), path.join(home, '.cache', 'ms-playwright')];
  const tails = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome', 'chrome-linux64/chrome',
  ];
  for (const cache of caches) {
    for (const folder of directories(cache).filter(entry => /^chromium-\d+$/.test(entry)).sort().reverse()) {
      for (const tail of tails) {
        const candidate = path.join(cache, folder, tail);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('An existing Chromium executable is required; this test does not download browsers');
}

(async()=>{
 const pw=loadPlaywright(),browser=await pw.chromium.launch({headless:true,executablePath:chromiumExecutable(pw)}),checks=[],errors=[],http=[],dialogs=[];
 const internal=process.env.MERGE_INTERNAL_URL,record=s=>{checks.push(s);console.log('PASS '+s);};
 const capture=page=>{page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});page.on('response',r=>{if(r.url().includes('/api/'))http.push({url:r.url(),status:r.status(),method:r.request().method()});});};
 async function api(context,route,token,body,method='GET',base=url){const r=await context.request.fetch(base+route,{method,headers:token?{Authorization:'Bearer '+token}:{},data:body});const v=await r.json();assert(r.ok(),JSON.stringify({route,status:r.status(),body:v}));return v;}
 try{
  const ctx=await browser.newContext({viewport:{width:1366,height:950}}),page=await ctx.newPage();capture(page);
  await page.goto(url+'/login');await page.screenshot({path:path.join(out,'original-customer-login.png')});await page.getByPlaceholder('请输入邮箱或手机号').fill('customer@example.test');await page.getByPlaceholder('请输入密码').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/dashboard');await page.getByRole('heading',{name:/你好/}).waitFor();record('Original customer login page authenticates directly against internal account; original dashboard loads');
  const token=await page.evaluate(()=>localStorage.getItem('token'));const catalog=await api(ctx,'/api/products',token);assert.equal(catalog.products.length,80);assert(catalog.grouped['company-services']);const product=code=>catalog.products.find(x=>x.sku_code===code);for(const code of ['COM-001','TRA-006']){const row=product(code),source=snapshot.tables.products.find(x=>x.sku_code===code);assert.equal(row.price,source.price);assert.equal(row.name,source.name);}record('Original catalog JSON grouping and active80 live products preserved');
  const spot=await api(ctx,'/api/spot',token);assert.equal(spot.length,36);assert(spot.every(s=>s.currency==='THB'));record('Original spot catalog retains36 active raw prices/currencies');
  async function add(code){const p=product(code);await page.goto(url+'/dashboard/services/'+p.category_id);const row=page.getByText(p.name,{exact:true}).locator('xpath=ancestor::div[contains(@class,"px-5")][1]');await row.getByRole('button',{name:'加入购物车',exact:true}).click();await row.getByRole('button',{name:'已加入',exact:true}).waitFor();}
  await add('COM-001');await add('TRA-006');await page.getByRole('link',{name:/购物车/}).first().click();await page.getByRole('heading',{name:'购物车',exact:true}).waitFor();
  const trademark=page.locator('div.bg-white.rounded-xl').filter({hasText:product('TRA-006').name});const changed=page.waitForResponse(r=>r.url().includes('/api/cart/')&&r.request().method()==='PATCH');await trademark.getByRole('button',{name:'增加数量',exact:true}).click();assert((await changed).ok());await page.reload();await page.getByRole('heading',{name:'购物车',exact:true}).waitFor();const cart=await api(ctx,'/api/cart',token);assert.equal(cart.length,2);assert.equal(cart.find(x=>x.sku_code==='TRA-006').quantity,2);await page.screenshot({path:path.join(out,'original-cart.png'),fullPage:true});record('Original navigation, add-to-cart, quantity controls and saved cart survive reload');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/cart/checkout')&&r.request().method()==='POST');await page.getByRole('button',{name:'一键下单',exact:true}).click();const checkoutResponse=await response;assert(checkoutResponse.ok(),await checkoutResponse.text());const purchase=await checkoutResponse.json();assert.equal(purchase.totalAmount,25050);assert.equal(purchase.itemCount,3);await page.getByRole('heading',{name:'下单成功！',exact:true}).waitFor();record('Original cart checkout creates a single CNY25050 sale for three service copies');
  await page.getByRole('link',{name:'查看我的订单',exact:true}).click();await page.getByRole('heading',{name:'我的订单',exact:true}).waitFor();await page.getByText(purchase.id,{exact:true}).waitFor();await page.goto(url+'/dashboard/order/'+purchase.id);await page.getByRole('heading',{name:'办理进度',exact:true}).waitFor();const detail=await api(ctx,'/api/orders/'+purchase.id,token);assert.equal(detail.internal_progress.length,3);assert.equal(detail.invoice.amount,25050);assert.equal(detail.invoice.status,'unpaid');record('Original customer order detail reads the same invoice and three internal workflows');
  const staff=await browser.newContext({viewport:{width:1440,height:1000}}),ap=await staff.newPage();capture(ap);await ap.goto(internal+'/login');await ap.locator('#email').fill('admin@example.test');await ap.locator('#password').fill(password);await ap.locator('form button[type=submit]').click();await ap.waitForURL(internal+'/');const adminToken=await ap.evaluate(()=>sessionStorage.getItem('authToken')||localStorage.getItem('authToken'));assert(adminToken);
  const native=await api(staff,'/api/commerce/orders/'+purchase.id,adminToken,undefined,'GET',internal);const fulfillment=native.lines.flatMap(l=>l.fulfillments)[0];await ap.goto(internal+'/orders/'+fulfillment.order_id);await ap.getByRole('heading',{name:fulfillment.order_id,exact:true}).waitFor();const progressChanged=ap.waitForResponse(r=>r.url().includes('/steps')&&r.request().method()==='PATCH');await ap.getByRole('button',{name:'开始任务',exact:true}).click();assert((await progressChanged).ok());await ap.screenshot({path:path.join(out,'original-internal-workflow.png'),fullPage:true});
  await page.getByRole('button',{name:'刷新进度',exact:true}).click();await page.getByRole('region',{name:'公开办理进度'}).getByText('进行中',{exact:true}).first().waitFor();record('Original internal order page receives customer purchase; native Start Task returns live progress to original customer page');
  await api(staff,'/api/orders/'+fulfillment.order_id+'/steps',adminToken,{step_id:fulfillment.steps[0].id,notes:'PRIVATE-COST-AND-STAFF-NOTES-DO-NOT-PUBLISH'},'PATCH',internal);const safe=await api(ctx,'/api/orders/'+purchase.id,token);assert(!JSON.stringify(safe).includes('PRIVATE-COST'));assert(!JSON.stringify(safe).includes('assignee'));record('Internal private notes/costs do not leak through original customer order contract');
  const text=page.getByPlaceholder('输入文字资料（如公司英文名称、营业范围等），也可留空只上传文件...');await text.fill('ORIGINAL-UI-CUSTOMER-MATERIAL');const docResponse=page.waitForResponse(r=>r.url().includes('/documents/unified')&&r.request().method()==='POST');await text.locator('..').getByRole('button',{name:'提交资料',exact:true}).click();assert((await docResponse).ok());await page.getByText('ORIGINAL-UI-CUSTOMER-MATERIAL',{exact:true}).waitFor();const nativeDocs=await api(staff,'/api/orders/'+fulfillment.order_id+'/documents',adminToken,undefined,'GET',internal);assert(nativeDocs.some(d=>d.name==='文字资料.txt'));record('Original customer material form attaches to the corresponding internal original order');
  const pdf=await ctx.request.get(url+'/api/download-invoice/'+purchase.id,{headers:{Authorization:'Bearer '+token}});assert(pdf.ok(),await pdf.text());const bytes=await pdf.body();assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert(bytes.length>10000);fs.writeFileSync(path.join(out,'original-invoice-template.pdf'),bytes);record('Existing branded invoice template renders the internal shared bill without a new page/template design');
  await page.goto(url+'/dashboard/invoices');await page.getByRole('heading',{name:'账单管理',exact:true}).waitFor();await page.getByText(detail.invoice.invoice_no,{exact:true}).waitFor();await page.screenshot({path:path.join(out,'original-invoices.png'),fullPage:true});record('Original invoice list is connected');
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,http,errors,dialogs,saleId:purchase.id,fulfillmentId:fulfillment.order_id},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,saleId:purchase.id}));
 }finally{if(errors.length||dialogs.length)console.log(JSON.stringify({errors,dialogs,http},null,2));await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
