#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local Chromium regression CLI. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(process.env.INTERNAL_SOURCE_ROOT||process.cwd()),home=os.homedir(),localRequire=createRequire(path.join(root,'package.json'));
const base=new URL(process.env.MERGE_URL);assert(['127.0.0.1','localhost','[::1]'].includes(base.hostname));const url=base.origin;
const password=process.env.MERGE_PASSWORD,out=process.env.MERGE_BROWSER_OUT;
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
 async function request(ctx,route,token,body,method='GET',base=url,headers={}){const r=await ctx.request.fetch(base+route,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...headers},data:body});const data=await r.json();http.push({route,method,status:r.status()});return {r,data};}
 async function ok(...args){const {r,data}=await request(...args);assert(r.ok(),JSON.stringify({status:r.status(),data}));return data;}
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));p.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
  let r=await ctx.request.get(url+'/api/orders');assert.equal(r.status(),401);
  let response=await request(ctx,'/api/auth/login',null,{email:'admin@example.test',password},'POST');assert.equal(response.r.status(),403);record('Guest and staff cannot use the customer data identity boundary');
  await p.goto(url+'/login');await p.getByPlaceholder('请输入邮箱或手机号').fill('customer@example.test');await p.getByPlaceholder('请输入密码').fill(password);await p.getByRole('button',{name:'登录',exact:true}).click();await p.waitForURL('**/dashboard');const token=await p.evaluate(()=>localStorage.getItem('token'));
  const admin=await ok(ctx,'/api/auth/login',null,{email:'admin@example.test',password},'POST',internal);const catalog=await ok(ctx,'/api/products',token);const product=sku=>catalog.products.find(x=>x.sku_code===sku),c=product('COM-001'),t=product('TRA-006');
  const nativeProduct=(await ok(ctx,'/api/commerce/products',admin.token,undefined,'GET',internal)).find(x=>x.sku==='COM-001');
  const mutation=async(method,path,body,revision,key=crypto.randomUUID())=>request(ctx,'/api/'+path,token,body,method,url,{'If-Match':String(revision),'X-Request-Id':key});
  async function state(){const v=await request(ctx,'/api/cart',token);assert(v.r.ok());return {items:v.data,revision:Number(v.r.headers()['x-cart-revision'])};}
  let st=await state();if(st.items.length){const v=await mutation('DELETE','cart',undefined,st.revision);assert(v.r.ok());}
  const purchaseBody=(product,quantity=1)=>({productId:product.id,skuCode:product.sku_code,skuName:product.name,serviceName:product.category_name,subCategory:product.sku_code,quantity,price:product.price,currency:product.currency});
  response=await request(ctx,'/api/cart',token,purchaseBody(c),'POST');assert.equal(response.r.status(),428);record('Original cart writes require an observed revision, not last-writer-wins');
  st=await state();const key=crypto.randomUUID(),body=purchaseBody(c);let a=await mutation('POST','cart',body,st.revision,key);assert(a.r.ok());let b=await mutation('POST','cart',body,st.revision,key);assert(b.r.ok());assert.deepEqual(a.data,b.data);assert.equal((await state()).items[0].quantity,1);
  b=await mutation('POST','cart',{...body,quantity:2},st.revision,key);assert.equal(b.r.status(),409);record('Repeated add command is idempotent; changed body under the same identity is rejected');
  st=await state();const concurrent=await Promise.all([mutation('POST','cart',purchaseBody(t),st.revision),mutation('POST','cart',purchaseBody(t),st.revision)]);assert.deepEqual(concurrent.map(v=>v.r.status()).sort(),[200,409]);record('Concurrent cart changes preserve one valid revision and reject stale writes');
  st=await state();for(const bad of [{...purchaseBody(c),price:0},{...purchaseBody(c),currency:'THB'},purchaseBody(product('COM-029'))]){const v=await mutation('POST','cart',bad,st.revision);assert.equal(v.r.status(),409);}assert.deepEqual(await state(),st);record('Price forgery, currency substitution and unconnected workflows have no cart/order side effects');
  const owned=(await ok(ctx,'/api/orders',token))[0];assert(owned);const other=await ok(ctx,'/api/auth/login',null,{email:'bridge-other@example.test',password},'POST');response=await request(ctx,'/api/orders/'+owned.id,other.token);assert.equal(response.r.status(),404);response=await request(ctx,'/api/download-invoice/'+owned.id,other.token);assert.equal(response.r.status(),404);const data=await ok(ctx,'/api/orders/'+owned.id+'/requirements',token);const doc=data.submissions[0];assert(doc);r=await ctx.request.get(url+'/api/documents/'+doc.id+'/download',{headers:{Authorization:'Bearer '+other.token}});assert.equal(r.status(),404);r=await ctx.request.get(internal+'/api/employees',{headers:{Authorization:'Bearer '+token}});assert.equal(r.status(),403);record('Other customers cannot read orders, branded bills or files; native staff APIs remain isolated');
  // The original image tag uses the HttpOnly download cookie, never a token in its URL.
  await ok(ctx,'/api/auth/refresh-cookie',token,{},'POST');r=await ctx.request.get(url+'/api/documents/'+doc.id+'/download');assert(r.ok());r=await ctx.request.post(url+'/api/cart',{data:purchaseBody(c)});assert.equal(r.status(),401);record('Download cookie works for original attachments but grants no write authority');
  st=await state();assert((await mutation('DELETE','cart',undefined,st.revision)).r.ok());
  async function addOriginal(){await p.goto(url+'/dashboard/services/'+c.category_id);const row=p.getByText(c.name,{exact:true}).locator('xpath=ancestor::div[contains(@class,"px-5")][1]');await row.getByRole('button',{name:'加入购物车',exact:true}).click();await row.getByRole('button',{name:'已加入',exact:true}).waitFor();await p.goto(url+'/dashboard/cart');await p.getByRole('heading',{name:'购物车',exact:true}).waitFor();}
  await addOriginal();
  const updated=await ok(ctx,'/api/commerce/products',admin.token,{id:nativeProduct.id,sku:nativeProduct.sku,name:nativeProduct.name,price_cents:nativeProduct.price_cents+100,active:true,revision:nativeProduct.revision},'POST',internal);
  let changed=p.waitForResponse(r=>r.url().endsWith('/api/cart/checkout')&&r.request().method()==='POST');await p.getByRole('button',{name:'一键下单',exact:true}).click();assert.equal((await changed).status(),409);await p.getByRole('button',{name:'确认更新可售商品报价',exact:true}).waitFor();assert.equal(await p.evaluate(()=>sessionStorage.getItem('customer-bridge-purchase-'+JSON.parse(localStorage.getItem('user')).id)),null);record('Actual price revision change triggers the original quote-review UI and preserves the cart');
  await p.getByRole('button',{name:'确认更新可售商品报价',exact:true}).click();await p.getByText('已按当前可售报价更新，请核对金额后再次下单；下架或币种待核对商品请移除后重新选择。',{exact:true}).waitFor();changed=p.waitForResponse(r=>r.url().endsWith('/api/cart/checkout')&&r.request().method()==='POST');await p.getByRole('button',{name:'一键下单',exact:true}).click();const bought=await changed;assert(bought.ok());assert.equal((await bought.json()).totalAmount,(nativeProduct.price_cents+100)/100);await p.getByRole('heading',{name:'下单成功！',exact:true}).waitFor();record('Explicit original-page reprice confirmation creates the revised bill once');
  await ok(ctx,'/api/commerce/products',admin.token,{id:updated.id,sku:updated.sku,name:updated.name,price_cents:nativeProduct.price_cents,active:true,revision:updated.revision},'POST',internal);
  // Lost real response, then a different device fills a new cart before recovery.
  await addOriginal();const before=(await ok(ctx,'/api/orders',token)).length;let lostSaleId;
  await p.route('**/api/cart/checkout',async route=>{const real=await route.fetch();assert(real.ok());lostSaleId=(await real.json()).id;await route.abort('failed');await p.unroute('**/api/cart/checkout');});
  await p.getByRole('button',{name:'一键下单',exact:true}).click();await p.waitForFunction(()=>!!sessionStorage.getItem('customer-bridge-purchase-'+JSON.parse(localStorage.getItem('user')).id));await p.getByRole('button',{name:'一键下单',exact:true}).waitFor();assert(lostSaleId);assert.equal((await ok(ctx,'/api/orders',token)).length,before+1);st=await state();assert.equal(st.items.length,0);assert((await mutation('POST','cart',purchaseBody(t,2),st.revision)).r.ok());
  await p.reload();await p.getByRole('heading',{name:'购物车',exact:true}).waitFor();await p.waitForFunction(()=>!sessionStorage.getItem('customer-bridge-purchase-'+JSON.parse(localStorage.getItem('user')).id));st=await state();assert.equal(st.items.length,1);assert.equal(st.items[0].sku_code,'TRA-006');assert.equal(st.items[0].quantity,2);assert.equal((await ok(ctx,'/api/orders',token)).length,before+1);record('Lost response is recovered with the exact persisted purchase identity; a later device cart is not consumed or duplicated');
  assert(dialogs.length===1 && /网络/.test(dialogs[0]));assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'robustness-result.json'),JSON.stringify({passed:true,checks,http,errors,expectedNetworkDialogs:dialogs,lostSaleId},null,2));console.log(JSON.stringify({passed:true,checks:checks.length}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
