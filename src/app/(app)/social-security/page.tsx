"use client";

import { BusinessLinePage } from "@/components/dashboard/business-line-page";

// 标题和描述由 BusinessLinePage 统一渲染（label + description），
// 这里不要再套一层自己的 h1，否则页面上会出现两个标题、两段描述
export default function SocialSecurityPage() {
  return (
    <BusinessLinePage
      businessKey="社保开户"
      label="社保开户"
      accentHue={140}
      description="帮客户到泰国社保局办理雇主登记开户。一单对应一家公司，收费 6,000 泰铢一次性，文件齐全当天办完。9步流程：Eve 收集公司资料、填表、签字盖章、递交社保局当天拿登记号，Pop 负责付款环节。注册证明书6个月内有效，外籍董事需实地考察。"
    />
  );
}
