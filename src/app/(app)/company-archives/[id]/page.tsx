import CompanyArchives from "@/components/company-archives";
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <CompanyArchives key={id} archiveId={id}/>;}
