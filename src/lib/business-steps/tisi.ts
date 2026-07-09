import type { StepTemplate } from "./types";

export const tisiSteps: StepTemplate[] = [
  { name: "客户发产品图+规格书", assignee: "Fern" },
  { name: "Fern发送产品图+规格书给Khun Ja检查是否需要TISI", assignee: "Fern" },
  { name: "Khun Ja确认可做，准备全套文件(ISO/CB/工厂文件/公司证书/PP20/护照)发送Khun Ja", assignee: "Fern" },
  { name: "TISI网站注册登记", assignee: "Fern" },
  { name: "准备授权委托书", assignee: "Fern" },
  { name: "等TISI官员联系补充文件", assignee: "Fern" },
  { name: "审批通过，协调Next获取HS-code准备清关", assignee: "Fern" },
  { name: "NSW系统获取TISI进口单据", assignee: "Fern" },
  { name: "货物清关到达泰国，安排送至TISI", assignee: "Fern" },
  { name: "官员送样品至实验室检测", assignee: "" },
  { name: "等待检测结果，Khun Ja通知下一步", assignee: "" },
  { name: "收到TISI证书，总周期约3-4个月", assignee: "Fern" },
];
