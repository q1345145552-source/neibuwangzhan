export const COMPANY_ARCHIVE_STATUSES = ["注册中", "已注册", "注销"] as const;
export interface CompanyArchive {
  id:number; name_zh:string; name_foreign:string; registered_address:string; legal_representative:string;
  email:string; business_scope:string; registered_capital:string; registration_date:string;
  status:typeof COMPANY_ARCHIVE_STATUSES[number]; order_id:string|null; customer_id:number|null;
  notes:string; created_by:string; updated_by:string; created_at:string; updated_at:string; version:number;
  customer_name?:string; order_customer_name?:string;
}
export type CompanyArchiveForm = Pick<CompanyArchive,"name_zh"|"name_foreign"|"registered_address"|"legal_representative"|"email"|"business_scope"|"registered_capital"|"registration_date"|"status"|"order_id"|"customer_id"|"notes">;
export interface CompanyArchiveOptions { orders:{id:string;customer_name:string;created_at:string}[]; customers:{id:number;company_name:string}[] }
export const emptyCompanyArchive:CompanyArchiveForm = {name_zh:"",name_foreign:"",registered_address:"",legal_representative:"",email:"",business_scope:"",registered_capital:"",registration_date:"",status:"注册中",order_id:null,customer_id:null,notes:""};
