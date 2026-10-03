import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import { CommerceError } from "./commerce";
import type { ImportedCatalog, ImportedCatalogKind } from "./commerce-imported-catalog-types";

export function importedCatalogEnabled():boolean { return process.env.COMMERCE_PREVIEW_CATALOG_ENABLED === "1"; }
export function readImportedCatalog(db:Database.Database,actor:TokenPayload):ImportedCatalog {
  if (!importedCatalogEnabled()) throw new CommerceError(404,"CATALOG_PREVIEW_DISABLED","本地目录预览未开启");
  if (!["client","admin","employee"].includes(actor.role)) throw new CommerceError(403,"ROLE_REQUIRED","请使用当前测试账号");
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='commerce_imported_catalog'").get()) throw new CommerceError(404,"CATALOG_NOT_IMPORTED","本地目录尚未导入");
  const batch=db.prepare("SELECT i.source,i.captured_at FROM commerce_catalog_imports i JOIN commerce_imported_catalog c ON c.import_batch_id=i.snapshot_sha256 LIMIT 1").get() as {source:string;captured_at:string}|undefined;
  if (!batch) throw new CommerceError(404,"CATALOG_NOT_IMPORTED","本地目录尚未导入");
  const products=db.prepare("SELECT id,sku,active FROM commerce_products").all() as {id:string;sku:string;active:number}[];
  const rows=db.prepare("SELECT kind,source_id,payload_json FROM commerce_imported_catalog ORDER BY kind,source_id").all() as {kind:ImportedCatalogKind;source_id:string;payload_json:string}[];
  // Do not expose raw import fields (notes, templates, descriptions or file URLs).
  // Customer visibility follows source status, even in the isolated preview.
  const items=rows.map(row=>{
    const value=JSON.parse(row.payload_json) as Record<string,unknown>;
    const sku=typeof value.sku_code==="string"?value.sku_code:"";
    const matched=row.kind==="products"?products.find(p=>p.sku===sku&&p.active===1):undefined;
    return {key:row.kind+":"+row.source_id,kind:row.kind,source_id:row.source_id,sku,
      name:String(value.name||""),category:String(value.category_name||value.category||(row.kind==="subscription_products"?"订阅产品":"")),
      sub_category:String(value.sub_category||""),price:typeof value.price==="number"&&Number.isFinite(value.price)?value.price:null,
      currency:typeof value.currency==="string"?value.currency:null,status:String(value.status||""),product_id:matched?.id??null};
  }).filter(row=>actor.role!=="client"||row.status==="active");
  items.sort((a,b)=>Number(!!b.product_id)-Number(!!a.product_id)||a.category.localeCompare(b.category,"zh-CN")||a.sku.localeCompare(b.sku)||a.name.localeCompare(b.name,"zh-CN"));
  const counts:ImportedCatalog["counts"]={products:0,spot_items:0,subscription_products:0};
  for(const row of items)counts[row.kind]++;
  return {...batch,items,counts};
}
