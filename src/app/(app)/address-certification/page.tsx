import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function Page() {
  return (
    <BusinessLinePage
      businessKey="地址认证"
      label="地址认证"
      accentHue={190}
      description="公司注册地址实地核查和认证。流程简单但需要跑现场，安排好路线一次多跑几家，效率高。"
    />
  );
}
