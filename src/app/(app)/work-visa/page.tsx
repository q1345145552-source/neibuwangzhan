"use client";

import { BusinessLinePage } from "@/components/dashboard/business-line-page";

// 标题和描述由 BusinessLinePage 统一渲染（label + description），
// 这里不要再套一层自己的 h1，否则页面上会出现两个标题、两段描述
export default function WorkVisaPage() {
  return (
    <BusinessLinePage
      businessKey="工作签证"
      label="工作签证"
      accentHue={210}
      description="给外国人办理泰国工作签证和劳工部工作证。一单对应一个外国人，客户先付费，分两个阶段——Non-B签证90天+工作证，一年续签。13步流程由 Pop 全程负责：公司文件收集 → WP3预批 → Non-B签证 → 工作证蓝本 → 一年续签。外包团队跑腿，费用客户先付无垫付。"
    />
  );
}
