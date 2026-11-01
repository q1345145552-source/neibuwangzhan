import type Database from "better-sqlite3";
import { COMPANY_ARCHIVE_STATUSES, type CompanyArchive, type CompanyArchiveForm, type CompanyShareholder } from "./company-archives";
export const companyArchiveSelect = `SELECT a.*,c.company_name customer_name,o.customer_name order_customer_name FROM company_archives a LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN orders o ON o.id=a.order_id`;
export const registrationOrderScope = "b.name='公司注册' AND COALESCE(o.sub_service_type,'') IN ('','company-reg')";
export function hydrateCompanyArchive(row:Omit<CompanyArchive,"shareholders"> & {shareholders:string|CompanyShareholder[]}):CompanyArchive {
  return {...row,shareholders:typeof row.shareholders==='string'?JSON.parse(row.shareholders):row.shareholders as CompanyShareholder[]};
}
export function readCompanyArchive(db:Database.Database,id:number) { const row=db.prepare(companyArchiveSelect+" WHERE a.id=?").get(id); return row?hydrateCompanyArchive(row as Parameters<typeof hydrateCompanyArchive>[0]):undefined; }
export function companyArchiveStorage(data:CompanyArchiveForm){return {...data,shareholders:JSON.stringify(data.shareholders)};}
function validateShareholders(raw:unknown):CompanyShareholder[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>200)throw Error('股东资料格式不正确，最多支持200位股东');
  return raw.map((item,index)=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw Error(`第${index+1}位股东资料不正确`);
    const record=item as Record<string,unknown>;
    const text=(key:string,label:string,max:number)=>{const value=record[key]??'';if(typeof value!=='string'||value.trim().length>max)throw Error(`第${index+1}位股东的${label}格式不正确或过长`);return value.trim();};
    const name=text('name','姓名',200),passport_number=text('passport_number','护照号',100),dbd_phone=text('dbd_phone','DBD 认证电话',100);
    if(!name)throw Error(`请填写第${index+1}位股东姓名`);
    const value=record.percentage??'',percentage=typeof value==='number'&&Number.isFinite(value)?String(value):value;
    if(typeof percentage!=='string'||(percentage!==''&&(!/^\d{1,3}(\.\d{1,4})?$/.test(percentage)||Number(percentage)>100)))throw Error(`第${index+1}位股东持股比例需为0至100的百分比，最多4位小数`);
    return {name,passport_number,percentage,dbd_phone};
  });
}
export function validateCompanyArchive(db:Database.Database,raw:Record<string,unknown>,user:{name:string;role:string},previous?:CompanyArchive):CompanyArchiveForm {
  const data:Record<string,unknown>={...(previous||{}),...raw};
  const labels:Record<string,string>={name_zh:'中文公司名',name_foreign:'英文/泰文公司名',registered_address:'注册地址',legal_representative:'法人姓名',legal_passport_number:'法人护照号',legal_dbd_phone:'法人 DBD 认证电话',email:'公司邮箱',business_scope:'经营范围',registered_capital:'注册资本',registration_date:'注册日期',status:'状态',notes:'备注'};
  const text=(key:string,max=200)=>{const value=data[key]??"";if(typeof value!=="string"||value.trim().length>max)throw Error(`${labels[key]||"资料"}格式不正确或过长`);return value.trim();};
  const result={name_zh:text('name_zh'),name_foreign:text('name_foreign'),registered_address:text('registered_address',2000),legal_representative:text('legal_representative'),legal_passport_number:text('legal_passport_number',100),legal_dbd_phone:text('legal_dbd_phone',100),shareholders:validateShareholders(data.shareholders),email:text('email',254),business_scope:text('business_scope',20000),registered_capital:text('registered_capital',24),registration_date:text('registration_date',10),status:text('status'),notes:text('notes',20000),order_id:data.order_id==null||data.order_id===''?null:data.order_id,customer_id:data.customer_id==null||data.customer_id===''?null:data.customer_id};
  if(!result.name_zh&&!result.name_foreign)throw Error('请至少填写中文或英文/泰文公司名');
  if(!COMPANY_ARCHIVE_STATUSES.includes(result.status as CompanyArchive['status']))throw Error('请选择正确的公司状态');
  if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw Error('公司邮箱格式不正确');
  if(result.registration_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(result.registration_date)||!Number.isFinite(Date.parse(result.registration_date))||new Date(result.registration_date).toISOString().slice(0,10)!==result.registration_date))throw Error('注册日期不正确');
  if(result.registered_capital&&!/^\d+(\.\d{1,2})?$/.test(result.registered_capital))throw Error('注册资本需为非负数字，最多两位小数');
  if(result.order_id!==null&&(typeof result.order_id!=='string'||!db.prepare(`SELECT 1 FROM orders o JOIN business_types b ON b.id=o.business_type_id WHERE o.id=? AND ${registrationOrderScope}`).get(result.order_id)))throw Error('请选择有效的新公司注册订单');
  if(result.customer_id!==null){
    if(typeof result.customer_id!=='number'||!Number.isSafeInteger(result.customer_id)||result.customer_id<=0)throw Error('关联客户编号无效');
    const customer=db.prepare('SELECT claimed_by FROM customers WHERE id=?').get(result.customer_id) as {claimed_by:string|null}|undefined;
    if(!customer)throw Error('关联客户不存在');
    if(user.role!=='admin'&&customer.claimed_by?.trim()&&customer.claimed_by!==user.name&&previous?.customer_id!==result.customer_id)throw Error('请选择公海或自己负责的客户');
  }
  return result as CompanyArchiveForm;
}
