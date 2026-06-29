import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function Page() {
  return (
    <BusinessLinePage
      businessKey="商标"
      label="商标"
      accentHue={30}
      description="商标检索、申请、续展全搞定。第35类和第42类问得最多，记得提醒客户提前准备使用证据。"
    />
  );
}
