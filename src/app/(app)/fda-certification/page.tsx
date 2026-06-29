import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function Page() {
  return (
    <BusinessLinePage
      businessKey="FDA产品认证"
      label="FDA认证"
      accentHue={155}
      description="医疗器械和食品的FDA认证——门槛高、周期长，但利润也高。510(k)和产品列名是我们主要做的两类，技术文档是关键。"
    />
  );
}
