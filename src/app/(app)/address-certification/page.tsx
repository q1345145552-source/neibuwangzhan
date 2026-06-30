import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function AddressCertificationPage() {
  return (
    <BusinessLinePage
      businessKey="地址认证"
      label="地址认证"
      accentHue={190}
      description="公司注册地址实地核查和认证。关键检查项：地契和租赁合同名字必须一致，不一致得补授权书。用湘泰地址的话要先签合同+付首月租金，后续每月自动生成租金记录。"
    />
  );
}
