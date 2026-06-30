import { BusinessLinePage } from "@/components/dashboard/business-line-page";

export default function CustomsClearancePage() {
  return (
    <BusinessLinePage
      businessKey="清关"
      label="清关"
      accentHue={50}
      description="进口清关一条龙——收集资料、确认可进口、安排发货、泰国清关、送达客户。涉及限制品（化妆品需FDA许可）得提前告诉客户先办证。Fern对接、Next清关，整套下来一个月左右。"
    />
  );
}
