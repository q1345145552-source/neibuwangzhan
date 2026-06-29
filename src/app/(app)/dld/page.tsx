import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function Page() {
  return (
    <BusinessLinePage
      businessKey="DLD"
      label="DLD"
      accentHue={10}
      description="陆运厅认证，汽车配件和整车都归这儿管。检测清单要先跟客户对一遍再提交，不然来回改浪费时间。"
    />
  );
}
