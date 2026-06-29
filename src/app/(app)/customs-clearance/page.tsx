import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function Page() {
  return (
    <BusinessLinePage
      businessKey="清关"
      label="清关"
      accentHue={50}
      description="进口清关——报关、商检、缴税、放行。港口拥堵的时候要提前跟客户打预防针，别让客户觉得是我们慢。"
    />
  );
}
