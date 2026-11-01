import CompanyArchives from "@/components/company-archives";
export default async function Page({searchParams}:{searchParams:Promise<{create_order?:string}>}){const params=await searchParams;return <CompanyArchives initialOrderId={typeof params.create_order==='string'?params.create_order:undefined}/>;}
