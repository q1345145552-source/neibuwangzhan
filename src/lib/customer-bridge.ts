import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import { checkout, listProducts, readCart, readSale, saveCart } from "./commerce";
import type { CommerceProduct, CommerceSale, CommerceSelection } from "./commerce-types";
import { fail, recordBody, boundedText } from "./commerce-validation";

type Db = Database.Database;
type Row = Record<string, unknown>;
const initialized = new WeakSet<Db>();
export const customerBridgeEnabled = () => process.env.COMMERCE_CUSTOMER_BRIDGE_ENABLED === "1";
export function bridgeSchema(db: Db) {
  if (initialized.has(db)) return;
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS commerce_customer_commands (
      account_id INTEGER NOT NULL REFERENCES employees(id), request_id TEXT NOT NULL,
      identity TEXT NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY(account_id,request_id));
    CREATE TABLE IF NOT EXISTS commerce_customer_quotes (
      account_id INTEGER NOT NULL REFERENCES employees(id), product_id TEXT NOT NULL REFERENCES commerce_products(id),
      revision INTEGER NOT NULL, unit_cents INTEGER NOT NULL, name TEXT NOT NULL,
      PRIMARY KEY(account_id,product_id,revision));
  `)).immediate();
  initialized.add(db);
}
export function importedRows(db: Db, kind: string, includeHidden = false): Row[] {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='commerce_imported_catalog'").get())
    return fail(503,"CATALOG_NOT_LOADED","测试商品目录尚未导入");
  return (db.prepare("SELECT payload_json FROM commerce_imported_catalog WHERE kind=? ORDER BY source_id").all(kind) as {payload_json:string}[])
    .map(row => recordBody(JSON.parse(row.payload_json)))
    .filter(row => includeHidden || row.status === "active");
}
export function customerProducts(db: Db, actor: TokenPayload) {
  const core = new Map(listProducts(db,{...actor,role:"admin"}).map(product => [product.sku,product]));
  const products = importedRows(db,"products").filter(row=>core.get(String(row.sku_code))?.active!==0).map((row):Row => {
    const product = core.get(String(row.sku_code));
    // Preserve the existing public product-page contract, never export unrelated database fields.
    const visible = Object.fromEntries(["id","category_id","category_name","sku_code","name","price","currency","note","image","sort_order","status","requirements","notes","template_file","tax_fields","sub_category"].map(k=>[k,row[k]??null]));
    return {...visible, ...(product ? {name:product.name,price:product.price_cents/100,currency:product.currency,revision:product.revision,core_product_id:product.id,terms_version:product.terms.version} : {})};
  }).sort((a,b)=>Number(a.sort_order??0)-Number(b.sort_order??0));
  const grouped: Record<string,typeof products> = {};
  for(const row of products) (grouped[String(row.category_id)]??=[]).push(row);
  return {products,grouped};
}
function rawProduct(db:Db, id:string) {
  return importedRows(db,"products",true).find(row=>row.id===id);
}
function sourceForCore(db:Db, product:CommerceProduct) {
  return importedRows(db,"products",true).find(row=>row.sku_code===product.sku);
}
function selectedProduct(db:Db, actor:TokenPayload, body:Row):CommerceProduct {
  const raw=rawProduct(db,boundedText(body.productId,80,"商品编号"));
  if(!raw || raw.status!=="active") return fail(409,"PRODUCT_UNAVAILABLE","商品已下架，请重新选择");
  const product=listProducts(db,actor).find(row=>row.sku===raw.sku_code && row.active);
  if(!product) return fail(409,"WORKFLOW_NOT_CONNECTED","该商品的内部办理数据映射尚未接通，本次未下单");
  if(body.currency!=="CNY" || body.price!==product.price_cents/100) return fail(409,"QUOTE_CHANGED","商品报价已变化，请重新加载商品后确认");
  return product;
}
function quantity(value:unknown):number {
  if(typeof value!=="number" || !Number.isInteger(value) || value<1 || value>10) return fail(400,"INVALID_QUANTITY","每种服务请选择 1 至 10 份");
  return value;
}
function selection(product:CommerceProduct, value:number):CommerceSelection {
  return {product_id:product.id,quantity:value,revision:product.revision,terms_version:product.terms.version};
}
function rememberQuote(db:Db, actor:TokenPayload, product:CommerceProduct, revision=product.revision) {
  db.prepare("INSERT OR IGNORE INTO commerce_customer_quotes(account_id,product_id,revision,unit_cents,name) VALUES (?,?,?,?,?)")
    .run(actor.id,product.id,revision,product.price_cents,product.name);
}
export function customerCart(db:Db, actor:TokenPayload) {
  bridgeSchema(db);
  return db.transaction(()=>{
    const saved=readCart(db,actor),core=listProducts(db,{...actor,role:"admin"});
    const items=saved.lines.map(line=>{
      const product=core.find(row=>row.id===line.product_id);
      if(!product) return fail(409,"CART_INVALID","购物车商品待核对");
      rememberQuote(db,actor,product,line.revision);
      const cached=db.prepare("SELECT unit_cents,name FROM commerce_customer_quotes WHERE account_id=? AND product_id=? AND revision=?").get(actor.id,product.id,line.revision) as {unit_cents:number;name:string};
      const raw=sourceForCore(db,product);
      return {id:product.id,product_id:raw?.id??product.id,sku_code:product.sku,sku_name:cached.name,service_name:raw?.category_name??"",sub_category:raw?.sub_category??"",price:cached.unit_cents/100,currency:"CNY",quantity:line.quantity,
        core_product_id:product.id,product_revision:line.revision,terms_version:line.terms_version,cart_revision:saved.revision};
    });
    return {revision:saved.revision,items,lines:saved.lines};
  }).immediate();
}
export function command<T>(db:Db,actor:TokenPayload,key:unknown,identity:unknown,operation:()=>T):T {
  bridgeSchema(db);
  const id=boundedText(key,80,"请求编号");
  if(!/^[A-Za-z0-9_-]{16,80}$/.test(id))return fail(400,"INVALID_REQUEST_ID","请求编号格式有误");
  const canonical=JSON.stringify(identity);
  return db.transaction(()=>{
    const previous=db.prepare("SELECT identity,response_json FROM commerce_customer_commands WHERE account_id=? AND request_id=?").get(actor.id,id) as {identity:string;response_json:string}|undefined;
    if(previous){if(previous.identity!==canonical)return fail(409,"REQUEST_CONFLICT","原请求内容已变化，请核对后重试");return JSON.parse(previous.response_json) as T;}
    const response=operation();db.prepare("INSERT INTO commerce_customer_commands VALUES (?,?,?,?)").run(actor.id,id,canonical,JSON.stringify(response));return response;
  }).immediate();
}
export function changeCustomerCart(db:Db,actor:TokenPayload,path:string,method:string,body:Row,revision:number,key:string) {
  return command(db,actor,key,{path,method,body,revision},()=>{
    const current=readCart(db,actor);
    if(current.revision!==revision)return fail(409,"CART_CHANGED","购物车已在其他页面变化，请刷新后重试");
    let lines=current.lines.map(row=>({...row}));
    if(path==="cart" && method==="POST"){
      const product=selectedProduct(db,actor,body),q=quantity(body.quantity??1),existing=lines.find(row=>row.product_id===product.id);
      if(existing){quantity(existing.quantity+q);existing.quantity+=q;}else lines.push(selection(product,q));
      rememberQuote(db,actor,product);
    }else if(path==="cart/refresh-prices" && method==="POST"){
      const products=listProducts(db,actor);
      lines=lines.map(line=>{const product=products.find(row=>row.id===line.product_id&&row.active);if(!product)return line;rememberQuote(db,actor,product);return selection(product,line.quantity);});
    }else if(path==="cart" && method==="DELETE")lines=[];
    else {
      const id=path.slice("cart/".length),line=lines.find(row=>row.product_id===id);
      if(!line)return fail(404,"CART_ITEM_NOT_FOUND","购物车条目不存在");
      if(method==="PATCH")line.quantity=quantity(body.quantity);
      else if(method==="DELETE")lines=lines.filter(row=>row.product_id!==id);
      else return fail(405,"METHOD_NOT_ALLOWED","操作方法不匹配");
    }
    saveCart(db,actor,{revision,lines});return customerCart(db,actor);
  });
}
export function customerOrder(sale:CommerceSale) {
  const fs=sale.lines.flatMap(line=>line.fulfillments),allCancelled=fs.length>0&&fs.every(f=>f.status==="客户取消");
  const status=allCancelled?"cancelled":fs.length>0&&fs.every(f=>f.status==="已完成")?"completed":fs.some(f=>f.status==="进行中"||f.steps.some(s=>s.status==="已完成"))?"processing":"pending";
  return {id:sale.id,order_no:sale.id,user_id:String(sale.buyer_account_id),user_name:sale.buyer_name,sku_name:sale.lines.map(line=>line.name).join(" + "),service_name:sale.lines.length>1?"购物车合并结算":sale.lines[0]?.sku.startsWith("COM-")?"公司咨询服务":"商标服务",sub_category:sale.lines.map(line=>line.sku).join(" / "),price:sale.total_cents/100,deal_price:null,currency:sale.currency,quantity:sale.lines.reduce((n,line)=>n+line.quantity,0),status,created_at:sale.created_at.replace(" ","T")+"Z",updated_at:sale.created_at.replace(" ","T")+"Z",sync_status:"sent",customer_info:"{}",notes:""};
}
export function customerInvoice(sale:CommerceSale) {
  const paid=sale.invoice.status==="paid";
  return {id:sale.invoice.id,order_id:sale.id,invoice_no:sale.invoice.id,amount:sale.billing.original_cents/100,currency:sale.currency,status:paid?"paid":"unpaid",discount_type:"amount",discount:sale.billing.credited_cents/100,deposit:0,issued_at:sale.created_at.replace(" ","T")+"Z",paid_at:sale.invoice.paid_at,balance_due:sale.billing.balance_due_cents/100,received_amount:sale.billing.received_cents/100,refunded_amount:sale.billing.refunded_cents/100};
}
export function customerOrderDetail(db:Db,actor:TokenPayload,id:string) {
  const sale=readSale(db,actor,id);
  return {order:customerOrder(sale),invoice:customerInvoice(sale),history:[],steps:[],
    internal_expected:sale.lines.flatMap((line,i)=>line.fulfillments.map(f=>({line_no:i+1,copy_no:f.copy_no,sku_name:line.name}))),
    internal_progress:sale.lines.flatMap((line,i)=>line.fulfillments.map(f=>({line_no:i+1,copy_no:f.copy_no,seq:1,status:f.status,updated_at:null,steps:f.steps.map(s=>({step_order:s.step_order,step_name:s.name,status:s.status}))})))};
}
export function customerOrders(db:Db,actor:TokenPayload) {
  // The original page filters client-side. Never inherit the pilot list's 100-row truncation.
  const rows=db.prepare("SELECT id FROM commerce_sales WHERE buyer_account_id=? ORDER BY created_at DESC,id DESC").all(actor.id) as {id:string}[];
  return rows.map(row=>customerOrder(readSale(db,actor,row.id)));
}
export function purchaseCustomerCart(db:Db,actor:TokenPayload,body:Row) {
  if(body.currency!=="CNY")return fail(400,"INVALID_CURRENCY","下单币种必须为人民币");
  const result=checkout(db,actor,{request_id:body.request_id,cart_revision:body.cart_revision,lines:body.lines});
  return {id:result.sale.id,order_no:result.sale.id,orders:[{...customerOrder(result.sale),totalAmount:result.sale.total_cents/100}],itemCount:result.sale.lines.reduce((n,line)=>n+line.quantity,0),totalAmount:result.sale.total_cents/100,duplicate:result.duplicate};
}
export function purchaseCustomerProduct(db:Db,actor:TokenPayload,body:Row) {
  return command(db,actor,body.request_id,{action:"direct-purchase",body},()=>{
    const product=selectedProduct(db,actor,body);const result=checkout(db,actor,{request_id:body.request_id,lines:[selection(product,quantity(body.quantity??1))]});
    return {id:result.sale.id,order_no:result.sale.id};
  });
}
