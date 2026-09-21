import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import type { CommerceSalePage } from "./commerce-types";
import { readSale } from "./commerce";
import { fail } from "./commerce-validation";

export function salePage(db:Database.Database,actor:TokenPayload,query:URLSearchParams):CommerceSalePage {
  for(const name of query.keys())if(!["limit","cursor","search"].includes(name))fail(400,"INVALID_FIELD","不支持的订单筛选字段");
  const value=query.get("limit")??"20";
  if(!/^\d+$/.test(value)||Number(value)<1||Number(value)>50)fail(400,"INVALID_LIMIT","每页请选择 1 至 50 笔");
  const limit=Number(value),where:string[]=[],args:(string|number)[]=[];
  if(actor.role==="client"){where.push("s.buyer_account_id=?");args.push(actor.id);}
  const search=(query.get("search")??"").trim();
  if(search.length>80)fail(400,"INVALID_SEARCH","搜索内容过长");
  if(search){
    const pattern="%"+search.replaceAll("!","!!").replaceAll("%","!%").replaceAll("_","!_")+"%";
    where.push("(s.id LIKE ? ESCAPE '!' OR s.buyer_name LIKE ? ESCAPE '!' OR EXISTS(SELECT 1 FROM commerce_lines l WHERE l.sale_id=s.id AND (l.sku LIKE ? ESCAPE '!' OR l.name LIKE ? ESCAPE '!')))" );args.push(pattern,pattern,pattern,pattern);
  }
  const cursor=query.get("cursor");
  if(cursor){
    let row:unknown;
    try{if(cursor.length>500||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new Error("cursor");row=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));}catch{fail(400,"INVALID_CURSOR","分页位置有误，请刷新订单");}
    if(!Array.isArray(row)||row.length!==2||typeof row[0]!=="string"||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row[0])||typeof row[1]!=="string"||row[1].length>80)fail(400,"INVALID_CURSOR","分页位置有误，请刷新订单");
    where.push("(s.created_at<? OR (s.created_at=? AND s.id<?))");args.push(row[0],row[0],row[1]);
  }
  const rows=db.prepare(`SELECT s.id,s.created_at FROM commerce_sales s ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY s.created_at DESC,s.id DESC LIMIT ?`).all(...args,limit+1) as {id:string;created_at:string}[];
  const selected=rows.slice(0,limit),last=selected.at(-1);
  return {items:selected.map(row=>readSale(db,actor,row.id)),next_cursor:rows.length>limit&&last?Buffer.from(JSON.stringify([last.created_at,last.id])).toString("base64url"):null};
}
