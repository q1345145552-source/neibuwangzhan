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
 const pw=loadPlaywright(),browser=await pw.chromium.launch({headless:true,executablePath:chromiumExecutable(pw)}),checks=[],errors=[],http=[];
 const record=(name)=>{checks.push(name);console.log('PASS '+name);};
 async function api(context,route,token,body,method){const response=await context.request.fetch(url+route,{method:method||(body?'POST':'GET'),headers:token?{Authorization:'Bearer '+token}:{},data:body});const value=await response.json();http.push({route,method:method||(body?'POST':'GET'),status:response.status()});assert(response.ok(),JSON.stringify(value));return value;}
 try{
  const customer=await browser.newContext({viewport:{width:1100,height:900}}),page=await customer.newPage();page.on('pageerror',e=>errors.push(String(e)));
  const guest=await customer.request.get(url+'/api/commerce/imported-catalog');assert.equal(guest.status(),401);record('Catalog API requires authentication');
  await page.goto(url+'/shop');await page.getByLabel('邮箱',{exact:true}).fill('customer@example.test');await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('status').filter({hasText:'当前显示 80 项'}).waitFor();const token=await page.evaluate(()=>sessionStorage.getItem('authToken'));
  const catalog=await api(customer,'/api/commerce/imported-catalog',token);assert.deepEqual(catalog.counts,{products:80,spot_items:36,subscription_products:2});assert(catalog.items.every(x=>x.status==='active'));assert(catalog.items.every(x=>!('payload_json' in x)&&!('notes' in x)&&!('template_file' in x)&&!('description' in x)));record('Customer gets all 80 active services,36 active spot items,2 subscriptions; hidden/sold and private import fields excluded');
  const products=await api(customer,'/api/commerce/products',token);assert.equal(products.length,9);for(const p of products){const online=snapshot.tables.products.find(x=>x.sku_code===p.sku);assert.equal(p.name,online.name);assert.equal(p.price_cents,Math.round(online.price*100));}record('All nine reviewed SKUs use exact live names and CNY prices');
  assert.equal(await page.locator('[data-imported-product]').count(),80);assert.equal(await page.locator('[data-imported-product] select').count(),9);assert.equal(await page.getByText('泰股东代持（3个月）',{exact:true}).count(),0);
  await page.getByLabel('商品搜索',{exact:true}).fill('COM-029');await page.getByRole('status').filter({hasText:'当前显示 1 项'}).waitFor();await page.getByRole('heading',{name:'注销VAT',exact:true}).waitFor();assert.equal(await page.locator('[data-imported-product] select').count(),0);record('Search finds imported unimplemented service and offers no false checkout');
  await page.getByLabel('商品搜索',{exact:true}).fill('');await page.getByLabel('商品类型',{exact:true}).selectOption('spot_items');await page.getByRole('status').filter({hasText:'当前显示 36 项'}).waitFor();assert((await page.locator('[data-imported-product]').first().innerText()).includes('THB'));assert.equal(await page.locator('[data-imported-product] select').count(),0);record('All active spot items retain THB display and stay outside unimplemented transaction flow');
  await page.getByLabel('商品类型',{exact:true}).selectOption('subscription_products');await page.getByRole('status').filter({hasText:'当前显示 2 项'}).waitFor();assert.equal(await page.getByText('按客户约定计价',{exact:true}).count(),2);record('Subscription products do not invent a fixed zero price');
  await page.getByLabel('商品类型',{exact:true}).selectOption('products');await page.getByLabel('商品搜索',{exact:true}).fill('COM-001');await page.getByLabel('COM-001 份数',{exact:true}).selectOption('2');
  await page.getByRole('link',{name:'购物车（2 份）',exact:true}).waitFor();await page.getByRole('link',{name:'购物车（2 份）',exact:true}).click();await page.getByRole('heading',{name:'购物车 · 1 种服务 / 2 份',exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'购物车 · 1 种服务 / 2 份',exact:true}).waitFor();record('Visible cart link jumps to selected lines; account cart survives reload');
  await page.getByRole('button',{name:'移除 COM-001',exact:true}).click();await page.getByRole('heading',{name:'购物车 · 0 种服务 / 0 份',exact:true}).waitFor();record('Cart line removal persists');
  await page.getByLabel('商品搜索',{exact:true}).fill('COM-001');await page.getByLabel('COM-001 份数',{exact:true}).selectOption('1');await page.getByRole('link',{name:'购物车（1 份）',exact:true}).waitFor();
  await page.getByLabel('商品搜索',{exact:true}).fill('TRA-006');await page.getByLabel('TRA-006 份数',{exact:true}).selectOption('2');await page.getByRole('link',{name:'购物车（3 份）',exact:true}).click();await page.getByRole('button',{name:'核对当前报价',exact:true}).click();
  const expected=(products.find(p=>p.sku==='COM-001').price_cents+2*products.find(p=>p.sku==='TRA-006').price_cents)/100;await page.getByText('本次合计 ¥'+expected.toFixed(2),{exact:true}).waitFor();const response=page.waitForResponse(r=>r.url()===url+'/api/commerce/orders'&&r.request().method()==='POST');await page.getByRole('button',{name:'确认下单',exact:true}).click();const sale=(await (await response).json()).sale;assert.equal(sale.total_cents,expected*100);assert.equal(sale.lines.flatMap(x=>x.fulfillments).length,3);await page.getByRole('heading',{name:'购物车 · 0 种服务 / 0 份',exact:true}).waitFor();record('Real mixed checkout uses exact live prices×quantity,creates one bill and three workflows,clears cart');
  const bad=await customer.request.post(url+'/api/commerce/quote',{headers:{Authorization:'Bearer '+token},data:{lines:[{product_id:'products:'+snapshot.tables.products.find(x=>x.sku_code==='COM-029').id,quantity:1,revision:1}]}});assert.equal(bad.status(),409);record('Direct API also rejects an unimplemented imported-only product');
  await page.setViewportSize({width:390,height:844});await page.getByLabel('商品搜索',{exact:true}).fill('');await page.screenshot({path:path.join(out,'customer-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));record('Full imported catalog and explicit cart fit mobile width');
  const admin=await browser.newContext(),ap=await admin.newPage();ap.on('pageerror',e=>errors.push(String(e)));const login=await api(admin,'/api/auth/login',null,{email:'admin@example.test',password});await ap.goto(url+'/login');await ap.evaluate(v=>{sessionStorage.setItem('authToken',v.token);sessionStorage.setItem('currentUser',JSON.stringify(v.user));},login);await ap.goto(url+'/commerce');await ap.getByRole('heading',{name:'线上完整商品目录',exact:true}).waitFor();await ap.getByRole('status').filter({hasText:'当前显示 83 项'}).waitFor();const all=await api(admin,'/api/commerce/imported-catalog',login.token);assert.deepEqual(all.counts,{products:83,spot_items:38,subscription_products:2});assert.equal(all.items.length,123);await ap.getByLabel('商品搜索',{exact:true}).fill('COM-020');await ap.getByText('线上状态：隐藏',{exact:true}).waitFor();await ap.screenshot({path:path.join(out,'admin-hidden-status.png'),fullPage:true});record('Staff sees complete123-source-row inventory with original hidden/sold status');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,http,pageErrors:errors,saleId:sale.id},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,saleId:sale.id}));await customer.close();await admin.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
