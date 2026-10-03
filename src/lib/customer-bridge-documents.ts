import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { readSale } from "./commerce";
import { fail } from "./commerce-validation";
import { importedRows } from "./customer-bridge";
import { POST as upload } from "@/app/api/upload/route";
import { GET as download } from "@/app/api/files/[filename]/route";
import { uploadsDir } from "./uploads";

type Db=Database.Database;
const initialized=new WeakSet<Db>();
function schema(db:Db){
 if(initialized.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS commerce_customer_document_links (
 document_id INTEGER PRIMARY KEY REFERENCES documents(id),sale_id TEXT NOT NULL REFERENCES commerce_sales(id),
 requirement_id TEXT,kind TEXT NOT NULL CHECK(kind IN ('material','receipt')),text_content TEXT NOT NULL DEFAULT '');`);
 initialized.add(db);
}
export function customerDocuments(db:Db,actor:TokenPayload,saleId:string,kind="material"){
 schema(db);const sale=readSale(db,actor,saleId),raw=importedRows(db,"products",true);
 const documents=sale.lines.flatMap(line=>line.fulfillments.flatMap(f=>f.documents));
 const links=db.prepare("SELECT document_id,requirement_id,kind,text_content FROM commerce_customer_document_links WHERE sale_id=?").all(saleId) as {document_id:number;requirement_id:string|null;kind:string;text_content:string}[];
 const requirements=sale.lines.flatMap(line=>line.fulfillments.map(f=>({id:"req:"+f.order_id,order_id:saleId,doc_name:line.name+" · 第 "+f.copy_no+" 份资料",doc_desc:String(raw.find(r=>r.sku_code===line.sku)?.requirements??""),required:1,status:f.status==="客户取消"?"cancelled":"pending"})));
 const submissions=documents.filter(doc=>(links.find(l=>l.document_id===doc.id)?.kind??"material")===kind).map(doc=>{
  const link=links.find(l=>l.document_id===doc.id);
  return {id:String(doc.id),order_id:saleId,requirement_id:link?.requirement_id??null,file_name:doc.name,file_path:link?.text_content?"text:"+link.text_content:"/api/documents/"+doc.id+"/download",status:doc.status==="已审核"?"approved":doc.status==="已驳回"?"rejected":"pending",review_note:"",submitted_at:(db.prepare("SELECT created_at FROM documents WHERE id=?").get(doc.id) as {created_at:string}).created_at.replace(" ","T")+"Z"};
 });
 return {requirements,submissions};
}
export async function submitCustomerDocuments(req:NextRequest,db:Db,actor:TokenPayload,saleId:string,kind="material"){
 schema(db);const sale=readSale(db,actor,saleId),form=await req.formData();
 const requirement=String(form.get("requirementId")??"");const fs=sale.lines.flatMap(line=>line.fulfillments);
 const selected=requirement?fs.find(f=>"req:"+f.order_id===requirement):fs.length===1||kind==="receipt"?fs[0]:undefined;
 if(!selected)return fail(400,"REQUIREMENT_REQUIRED","请选择对应的资料需求，以确定办理对象");
 if(selected.status==="客户取消"&&kind!=="receipt")return fail(409,"ORDER_CANCELLED","该办理已取消，资料保持原样");
 const text=String(form.get("text")??"").trim();if(text.length>20000)return fail(413,"TEXT_TOO_LONG","文字资料过长");
 const files=[...form.getAll("files"),...form.getAll("file")].filter((f):f is File=>f instanceof File&&f.size>0);
 if(files.length>10||files.some(f=>f.size>10*1024*1024))return fail(413,"FILES_TOO_LARGE","每批最多十份文件，每份最多 10MB");
 if(!text&&!files.length)return fail(400,"EMPTY_DOCUMENTS","请填写文字或选择文件");
 const added:{id:number;filename:string}[]=[];
 const staged:{name:string;url:string;fileType:string;text:string;filename:string}[]=[];
 try{
  for(const file of files){
   const fd=new FormData();fd.set("file",file);const response=await upload(new NextRequest(new URL("/api/upload",req.url),{method:"POST",headers:{Authorization:req.headers.get("Authorization")??""},body:fd}));
   const value=await response.json();if(!response.ok)return fail(response.status,"UPLOAD_FAILED",value.error??"上传失败");
   staged.push({name:(kind==="receipt"?"水单-":"")+file.name,url:value.url,fileType:file.type,text:"",filename:value.url.split("/").pop()});
  }
  if(text){
   const filename=randomUUID()+"_customer-note.txt";await mkdir(path.join(uploadsDir),{recursive:true});await writeFile(path.join(uploadsDir,filename),text,{flag:"wx"});
   // Track the written file before the registry write so a DB failure also removes it.
   staged.push({name:"文字资料.txt",url:"/api/files/"+filename,fileType:"text/plain",text,filename});
   db.prepare("INSERT INTO file_uploads(filename,uploaded_by_id,uploaded_by_role,mime_type,size) VALUES (?,?,?,?,?)").run(filename,actor.id,actor.role,"text/plain",Buffer.byteLength(text));
  }
  try{
   db.transaction(()=>{
    // Recheck ownership and cancellation after async file IO, before attaching any document.
    const fresh=readSale(db,actor,saleId).lines.flatMap(l=>l.fulfillments).find(f=>f.order_id===selected.order_id);
    if(!fresh||(fresh.status==="客户取消"&&kind!=="receipt"))return fail(409,"ORDER_CHANGED","办理状态已变化，资料未提交");
    for(const f of staged){const r=db.prepare("INSERT INTO documents(order_id,name,file_type,status,direction,file_url,uploaded_by,client_author_id,publication_verified) VALUES (?,?,?,'待审核','client_to_us',?,?,?,0)").run(selected.order_id,f.name,f.fileType,f.url,actor.name,actor.id);const id=Number(r.lastInsertRowid);db.prepare("INSERT INTO commerce_customer_document_links VALUES (?,?,?,?,?)").run(id,saleId,requirement||null,kind,f.text);added.push({id,filename:f.filename});}
   }).immediate();
  }catch(error){for(const f of staged){db.prepare("DELETE FROM file_uploads WHERE filename=? AND uploaded_by_id=?").run(f.filename,actor.id);await unlink(path.join(uploadsDir,f.filename)).catch(()=>{});}throw error;}
  return {ok:true,documents:added.map(x=>({id:String(x.id)}))};
 }catch(error){
  for(const f of staged){db.prepare("DELETE FROM file_uploads WHERE filename=? AND uploaded_by_id=?").run(f.filename,actor.id);await unlink(path.join(uploadsDir,f.filename)).catch(()=>{});}
  throw error;
 }
}
export async function downloadCustomerDocument(req:NextRequest,db:Db,actor:TokenPayload,id:string){
 const row=db.prepare(`SELECT d.*,l.sale_id FROM documents d JOIN commerce_fulfillments f ON f.order_id=d.order_id JOIN commerce_lines l ON l.id=f.line_id WHERE d.id=?`).get(id) as {sale_id:string;file_url:string;name:string}|undefined;
 if(!row)return fail(404,"DOCUMENT_NOT_FOUND","资料不存在");
 const allowed=readSale(db,actor,row.sale_id).lines.flatMap(l=>l.fulfillments).flatMap(f=>f.documents).some(d=>String(d.id)===id);
 if(!allowed)return fail(404,"DOCUMENT_NOT_FOUND","资料不存在");
 const filename=row.file_url.split("/").pop();if(!filename)return fail(404,"DOCUMENT_NOT_FOUND","资料文件不存在");
 const response=await download(req,{params:Promise.resolve({filename})});
 if(response.ok)response.headers.set("Content-Disposition","inline; filename*=UTF-8''"+encodeURIComponent(row.name));return response;
}
