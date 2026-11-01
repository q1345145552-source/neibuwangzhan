export interface CompanyShareholder { name:string; passport_number:string; percentage:string; dbd_phone:string }
export const COMPANY_ARCHIVE_STATUSES = ["注册中", "已注册", "注销"] as const;
export interface CompanyArchive {
  id:number; name_zh:string; name_foreign:string; registered_address:string; legal_representative:string;
  legal_passport_number:string; legal_dbd_phone:string; shareholders:CompanyShareholder[];
  email:string; business_scope:string; registered_capital:string; registration_date:string;
  status:typeof COMPANY_ARCHIVE_STATUSES[number]; order_id:string|null; customer_id:number|null;
  notes:string; created_by:string; updated_by:string; created_at:string; updated_at:string; version:number;
  customer_name?:string; order_customer_name?:string;
}
export type CompanyArchiveForm = Pick<CompanyArchive,"name_zh"|"name_foreign"|"registered_address"|"legal_representative"|"legal_passport_number"|"legal_dbd_phone"|"shareholders"|"email"|"business_scope"|"registered_capital"|"registration_date"|"status"|"order_id"|"customer_id"|"notes">;
export interface CompanyArchiveOptions { orders:{id:string;customer_name:string;created_at:string}[]; customers:{id:number;company_name:string}[] }
export const emptyCompanyArchive:CompanyArchiveForm = {name_zh:"",name_foreign:"",registered_address:"",legal_representative:"",legal_passport_number:"",legal_dbd_phone:"",shareholders:[],email:"",business_scope:"",registered_capital:"",registration_date:"",status:"注册中",order_id:null,customer_id:null,notes:""};

export const COMPANY_FILE_CATEGORIES = ["公司证书","股东护照","章程","PP20 及税务文件","其他"] as const;
export interface CompanyArchiveFile {id:number;archive_id:number;filename:string;category:string;original_name:string;mime_type:string;size:number;created_by:string;created_at:string}
