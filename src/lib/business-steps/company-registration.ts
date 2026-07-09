import type { StepTemplate } from "./types";

export const companyRegistrationSteps: StepTemplate[] = [
  { name: "Bam收集客户信息（公司名称中英文+股东护照+注册地址+营业范围），整理到飞书发给Pop", assignee: "Bam" },
  { name: "Bam帮客户注册DBD eBiz账号（需客户泰国邮箱+电话），发QR码给客户验证身份", assignee: "Bam" },
  { name: "客户身份验证（1-2天），通过后Pop登录DBD eBiz办理公司注册", assignee: "Pop" },
  { name: "验证不通过则Eve代为签字担保注册（耗时比正常更长）", assignee: "Eve" },
  { name: "DBD审核通过，制作公司印章（2-3天）", assignee: "Pop" },
  { name: "VAT注册：Pop准备文件，Fern前往税务局办理", assignee: "Fern" },
  { name: "银行开户：Eve预审预约，通知客户来泰，Bam/Pop陪同", assignee: "Eve" },
  { name: "地址服务：Pop联系房东、签合同、付款", assignee: "Pop" },
  { name: "做账报税：Eve每月整理账目（当前零申报，等待老板安排改正常报税）", assignee: "Eve" },
  { name: "公司变更：Pop接需求，Eve协助办理", assignee: "Pop" },
  { name: "全套文件交付客户", assignee: "Bam" },
];
