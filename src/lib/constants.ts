/* ── 公司注册步骤文档需求 ── */
export const stepRequiredDocs: Record<number, string[]> = {
  1: ["公司名称（中文/英文）", "股东护照复印件", "注册地址", "营业范围"],
  2: ["公司名称预审表", "股东信息表"],
  3: ["公司注册证明", "公章样式确认"],
  4: ["公司证书", "股东护照", "房屋租赁合同", "PP20表格"],
  5: ["公司全套文件", "董事护照", "地址证明"],
  6: ["全套公司文件交付"],
};

/* ── 步骤预计时间 ── */
export const stepTimeEstimates: Record<number, string> = {
  1: "1-2天",
  2: "2-3天",
  3: "1天",
  4: "1天（曼谷）/ 1天（清迈）",
  5: "1-2周（需预约）",
  6: "1天",
};

/* ── 子服务 ── */
export const subServices = [
  { key: "company-reg", label: "新公司注册", businessTypeId: 1 },
  { key: "vat", label: "VAT注册", businessTypeId: 1 },
  { key: "bank", label: "银行开户", businessTypeId: 1 },
  { key: "address", label: "地址服务", businessTypeId: 1 },
  { key: "accounting", label: "做账/报税", businessTypeId: 1 },
  { key: "change", label: "公司变更", businessTypeId: 1 },
];
