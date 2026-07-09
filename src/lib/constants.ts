/* ── 公司注册 ── */
export const companyRegDocs: Record<number, string[]> = {
  1: ["公司名称（中文/英文）", "股东护照复印件", "注册地址", "营业范围"],
  2: ["公司名称预审表", "股东信息表"],
  3: ["公司注册证明", "公章样式确认"],
  4: ["公司证书", "股东护照", "房屋租赁合同", "PP20表格"],
  5: ["公司全套文件", "董事护照", "地址证明"],
  6: ["全套公司文件交付"],
};

export const companyRegTimes: Record<number, string> = {
  1: "1-2天", 2: "2-3天", 3: "1天", 4: "1天（曼谷）/ 1天（清迈）", 5: "1-2周（需预约）", 6: "1天",
};

export const companySubServices = [
  { key: "company-reg", label: "新公司注册", businessTypeId: 1 },
  { key: "vat", label: "VAT注册", businessTypeId: 1 },
  { key: "bank", label: "银行开户", businessTypeId: 1 },
  { key: "address", label: "地址服务", businessTypeId: 1 },
  { key: "accounting", label: "做账/报税", businessTypeId: 1 },
  { key: "change", label: "公司变更", businessTypeId: 1 },
];

/* ── 商标 — TM标注册 ── */
export const trademarkDocs: Record<number, string[]> = {
  1: ["客户想要的商标名称（中文/英文/图形）"],
  2: ["商标类别（按国际分类）"],
  3: [],
  4: ["商标图样", "委托书", "营业执照副本"],
  5: ["TM申请表"],
  6: ["缴费凭证"],
  7: [],
};

export const trademarkTimes: Record<number, string> = {
  1: "1天", 2: "1-2天", 3: "1天", 4: "2-3天", 5: "3-5天", 6: "1天", 7: "1天",
};

/* ── 商标 — 国际商标 ── */
export const internationalTrademarkDocs: Record<number, string[]> = {
  1: ["客户需求确认表"],
  2: ["商标名称和图形"],
  3: ["商标类别确认表"],
  4: [],
  5: ["护照复印件", "商标图样", "委托书"],
  6: ["国际注册申请表"],
  7: ["缴费凭证"],
  8: [],
};

export const internationalTrademarkTimes: Record<number, string> = {
  1: "1天", 2: "2-3天", 3: "1天", 4: "1天", 5: "2-3天", 6: "4-6周", 7: "1天", 8: "1天",
};

export const internationalTrademarkSteps: { name: string; assignee: string }[] = [
  { name: "客户沟通确认需求", assignee: "Ing" },
  { name: "查重（检查维普/各国商标库）", assignee: "Ing" },
  { name: "分类确认（与泰国TM标一致）", assignee: "Ing" },
  { name: "收费开票", assignee: "Ing" },
  { name: "文件整理（护照+商标图样+委托书）", assignee: "Ing" },
  { name: "提交安合注册", assignee: "Ing" },
  { name: "缴费(YJ)", assignee: "Pop" },
  { name: "收TM标发给客户", assignee: "Ing" },
];

/* ── 商标 — 购买R标 ── */
export const buyRTrademarkDocs: Record<number, string[]> = {
  1: ["客户需求确认表"],
  2: ["R标匹配报告"],
  3: ["类别确认表"],
  4: [],
  5: ["转让协议", "公司营业执照"],
  6: ["变更申请表"],
  7: ["缴费凭证"],
  8: [],
};

export const buyRTrademarkTimes: Record<number, string> = {
  1: "1天", 2: "1-3天", 3: "1天", 4: "1天", 5: "1-2天", 6: "1-2天", 7: "1天", 8: "1-2周",
};

export const buyRTrademarkSteps: { name: string; assignee: string }[] = [
  { name: "客户询盘需求沟通", assignee: "Ing" },
  { name: "匹配可用R标", assignee: "Ing" },
  { name: "确认类别（可加1个类别）", assignee: "Ing" },
  { name: "收费开票", assignee: "Ing" },
  { name: "准备转让文件", assignee: "Ing" },
  { name: "提交变更申请（与Fern一起去商标局）", assignee: "Ing" },
  { name: "缴费(Pop)", assignee: "Pop" },
  { name: "完成转让", assignee: "Ing" },
];

/* ── 商标子服务 ── */
export const trademarkSubServices = [
  { key: "tm-reg", label: "TM标注册", businessTypeId: 2 },
  { key: "international", label: "国际商标", businessTypeId: 2 },
  { key: "buy-r", label: "购买R标", businessTypeId: 2 },
];

/* ── FDA — 化妆品认证 ── */
export const fdaCosmeticsDocs: Record<number, string[]> = {
  1: ["ISO/工厂文件", "产品配方", "产品图", "商标文件", "委托书"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
};

export const fdaCosmeticsTimes: Record<number, string> = {
  1: "2天", 2: "1天", 3: "1天", 4: "1天", 5: "1天", 6: "1天", 7: "5-7天", 8: "2天",
};

/* ── FDA — 食品认证 ── */
export const fdaFoodDocs: Record<number, string[]> = {
  1: ["工厂文件", "产品配方", "产品图+标签", "工序流程", "商标文件"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
};

export const fdaFoodTimes: Record<number, string> = {
  1: "2天", 2: "1天", 3: "30天", 4: "1天", 5: "2天", 6: "1天", 7: "5-7天",
};

/* ── FDA — 危险品认证 ── */
export const fdaHazardDocs: Record<number, string[]> = {
  1: ["工厂文件", "CFS", "MSDS", "产品图", "配方", "工序", "中英文标签"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
};

export const fdaHazardTimes: Record<number, string> = {
  1: "2天", 2: "2天", 3: "1天", 4: "3天", 5: "1天", 6: "1天", 7: "5-7天",
};

/* ── TISI ── */
export const tisiDocs: Record<number, string[]> = {
  1: ["产品图", "产品规格书"],
  2: [],
  3: ["ISO证书", "CB证书", "中国工厂全部文件", "泰国公司证书", "PP20", "法人护照/身份证"],
  4: [],
  5: ["授权委托书"],
  6: [],
  7: ["HS码"],
  8: [],
  9: ["报关文件", "NSW进口单据"],
  10: [],
  11: [],
  12: [],
};

export const tisiTimes: Record<number, string> = {
  1: "1天", 2: "1-2天", 3: "2-3天", 4: "1天", 5: "1天", 6: "7-14天", 7: "2-3天", 8: "1-2天", 9: "5-7天", 10: "1-2天", 11: "30-60天", 12: "1天",
};

export const tisiSubServices = [
  { key: "tisi-main", label: "TISI认证", businessTypeId: 4 },
  { key: "nbtc", label: "NBTC认证", businessTypeId: 4 },
];

/* ── 服务价格 ── */
export const servicePrices: Record<string, { label: string; items: { name: string; price: string }[]; note: string }> = {
  cosmetics: {
    label: "化妆品认证",
    items: [
      { name: "申请费", price: "100泰铢/次" },
      { name: "认证费", price: "按产品数量" },
    ],
    note: "每个产品类目单独计费，首次提交含100泰铢申请费",
  },
  food: {
    label: "食品认证",
    items: [
      { name: "咨询费", price: "按产品类别" },
      { name: "认证费", price: "按产品数量" },
    ],
    note: "按产品类别和数量综合报价，30天咨询期内可修改",
  },
  hazard: {
    label: "危险品认证",
    items: [
      { name: "申请费", price: "按危险等级" },
      { name: "重提交费", price: "超过2次需重新全额缴费" },
    ],
    note: "最多免费提交2次，第3次起按全新申请收费",
  },
};

/* ── FDA 审批状态 ── */
export const approvalStatuses = ["待审批", "需修改", "已通过"] as const;
export type ApprovalStatus = typeof approvalStatuses[number];
export const fdaSubServices = [
  { key: "cosmetics", label: "化妆品认证", businessTypeId: 3 },
  { key: "food", label: "食品认证", businessTypeId: 3 },
  { key: "hazard", label: "危险品认证", businessTypeId: 3 },
  { key: "medical", label: "医疗器械认证", businessTypeId: 3 },
];

/* ── Mall开店 ── */
export const mallShopeeDocs: Record<number, string[]> = {
  1: ["公司证书（3-6个月内）", "泰国银行账户", "PP20", "TikTok/Lazada Mall链接"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
};

export const mallShopeeTimes: Record<number, string> = {
  1: "2天", 2: "1天", 3: "1-2天", 4: "1-2天", 5: "3天", 6: "15天", 7: "1天", 8: "1天", 9: "1天",
};

export const mallTiktokDocs: Record<number, string[]> = {
  1: [],
  2: ["TM标证书 或 R标证书"],
  3: ["Instagram账号（1万粉丝）", "产品图"],
  4: [],
  5: [],
};

export const mallTiktokTimes: Record<number, string> = {
  1: "1天", 2: "2天", 3: "3天", 4: "3-5天", 5: "1天",
};

export const mallLazadaDocs: Record<number, string[]> = {
  1: [],
  2: ["公司证书", "泰国银行账户", "PP20"],
  3: [],
  4: ["FDA/TISI认证"],
  5: [],
};

export const mallLazadaTimes: Record<number, string> = {
  1: "1天", 2: "2天", 3: "3-5天", 4: "1天", 5: "1天",
};

export const mallSubServices = [
  { key: "shopee", label: "Shopee Mall", businessTypeId: 8 },
  { key: "tiktok", label: "TikTok Mall", businessTypeId: 8 },
  { key: "lazada", label: "Lazada Mall", businessTypeId: 8 },
];
export const addressDocs: Record<number, string[]> = {
  1: ["地契", "租赁合同（名字须一致，否则需授权书）"],
  2: [],
  3: [],
  4: [],
};

export const addressTimes: Record<number, string> = {
  1: "1天", 2: "1天", 3: "1-2天", 4: "2-3天",
};
export const customsDocs: Record<number, string[]> = {
  1: ["产品图+规格", "公司证书", "PP20", "法人护照/身份证", "泰国收货地址", "Invoice", "Packing List"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
};

export const customsTimes: Record<number, string> = {
  1: "2天", 2: "1天", 3: "1天", 4: "3-5天", 5: "5-7天", 6: "1-2天",
};

/* ── DLD ── */
export const dldProductDocs: Record<number, string[]> = {
  1: ["产品名称+标签", "ISO工厂证书", "CFS", "配方", "工序说明", "成分列表"],
  2: [],
  3: [],
  4: [],
  5: [],
};

export const dldProductTimes: Record<number, string> = {
  1: "2天", 2: "1天", 3: "1天", 4: "7-14天", 5: "30天",
};

export const dldSiteDocs: Record<number, string[]> = {
  1: ["存储位置和进口位置分开", "有货架", "有合规标识"],
  2: ["场地平面图"],
  3: [],
  4: [],
};

export const dldSiteTimes: Record<number, string> = {
  1: "1天", 2: "2天", 3: "1天", 4: "30天",
};

export const dldSubServices = [
  { key: "product", label: "产品认证", businessTypeId: 5 },
  { key: "site", label: "场地确认", businessTypeId: 5 },
];

/* ── 通用查询函数 ── */
export function getStepDocs(businessTypeId: number, subServiceType?: string): Record<number, string[]> {
  if (businessTypeId === 3) {
    if (subServiceType === "food") return fdaFoodDocs;
    if (subServiceType === "hazard") return fdaHazardDocs;
    return fdaCosmeticsDocs;
  }
  if (businessTypeId === 5) {
    if (subServiceType === "site") return dldSiteDocs;
    return dldProductDocs;
  }
  if (businessTypeId === 8) {
    if (subServiceType === "tiktok") return mallTiktokDocs;
    if (subServiceType === "lazada") return mallLazadaDocs;
    return mallShopeeDocs;
  }
  if (businessTypeId === 2) return trademarkDocs;
  return companyRegDocs;
}

export function getStepTimes(businessTypeId: number, subServiceType?: string): Record<number, string> {
  if (businessTypeId === 3) {
    if (subServiceType === "food") return fdaFoodTimes;
    if (subServiceType === "hazard") return fdaHazardTimes;
    return fdaCosmeticsTimes;
  }
  if (businessTypeId === 5) {
    if (subServiceType === "site") return dldSiteTimes;
    return dldProductTimes;
  }
  if (businessTypeId === 8) {
    if (subServiceType === "tiktok") return mallTiktokTimes;
    if (subServiceType === "lazada") return mallLazadaTimes;
    return mallShopeeTimes;
  }
  if (businessTypeId === 2) return trademarkTimes;
  return companyRegTimes;
}

export const stepRequiredDocs: Record<number, Record<number, string[]>> = {
  1: companyRegDocs, 2: trademarkDocs, 3: fdaCosmeticsDocs, 4: tisiDocs, 5: dldProductDocs, 6: customsDocs, 7: addressDocs, 8: mallShopeeDocs,
};

export const stepTimeEstimates: Record<number, Record<number, string>> = {
  1: companyRegTimes, 2: trademarkTimes, 3: fdaCosmeticsTimes, 4: tisiTimes, 5: dldProductTimes, 6: customsTimes, 7: addressTimes, 8: mallShopeeTimes,
};

export const subServices: Record<number, { key: string; label: string; businessTypeId: number }[]> = {
  1: companySubServices, 2: trademarkSubServices, 3: fdaSubServices, 4: tisiSubServices, 5: dldSubServices, 6: [],
};


