/* ── 公司注册 ── */
export const companyRegDocs: Record<number, string[]> = {
  1: ["公司名称中英文", "股东护照", "注册地址", "营业范围"],
  2: ["客户泰国邮箱", "泰国电话"],
  3: [],
  4: [],
  5: [],
  6: ["公司证书", "股东护照", "租赁合同", "PP20表格"],
  7: ["公司全套文件", "董事护照", "银行预审表"],
  8: ["地址信息", "房东联系方式"],
  9: ["月度账目数据"],
  10: ["变更需求说明", "相关证件"],
  11: [],
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
  1: ["工厂文件/ISO", "产品配方", "产品图", "商标文件", "授权委托书"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
  10: [],
  11: [],
  12: [],
};

/* ── FDA — 食品认证 ── */
export const fdaFoodDocs: Record<number, string[]> = {
  1: ["工厂文件", "产品配方", "产品图+标签", "生产工艺流程", "商标文件"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
  10: [],
  11: [],
  12: [],
};

/* ── FDA — 危险品认证 ── */
export const fdaHazardDocs: Record<number, string[]> = {
  1: ["工厂文件", "CFS", "MSDS", "产品图", "配方", "生产工艺流程", "中英文标签"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
  10: [],
  11: [],
  12: [],
  13: [],
  14: [],
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

export const nbtcDocs: Record<number, string[]> = {
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

/* ── 社保开户 ── */
export const socialSecurityDocs: Record<number, string[]> = {
  1: ["公司注册证明书（6个月内有效）", "董事身份证复印件", "董事户口本复印件", "BOJ5 股东名册", "BOJ2 公司设立文件", "BOJ3 公司设立文件", "公司地址地图", "公司实景照片（清楚拍到招牌和门牌号）"],
  2: ["雇员信息表（Excel：姓名、工资金额、入职日期）"],
  3: ["SPS 1-01 雇主登记表", "SPS 1-02 雇主登记表", "SPS 1-03/1 雇员入职申报表", "雇员名单表", "授权委托书"],
  4: [],
  5: [],
  6: [],
  7: [],
  8: [],
  9: [],
};

export const socialSecuritySubServices = [
  { key: "social-security", label: "社保开户", businessTypeId: 11 },
];

/* ── 工作签证 ── */
export const workVisaDocs: Record<number, string[]> = {
  1: ["公司注册证明书", "董事身份证或护照", "BOJ2 公司设立文件", "BOJ3 公司设立文件", "BOJ5 股东名册", "公司地址地图", "PP.01 表格", "PP.20 表格", "PP.09 表格（如有）", "社保缴费记录（至少1个月）", "ภ.ง.ด.1（至少1个月）"],
  2: ["外国人护照每一页扫描件", "毕业证（如有）", "工作经历证明（如有）"],
  3: ["公司大楼外观照片", "公司招牌照片", "办公室工作环境照片", "泰国员工照片", "外国人与董事或泰国员工合影"],
  4: ["WP3 申请表", "全套公司文件", "全套外国人文件", "场地照片"],
  5: [],
  6: ["WP3 批准函"],
  7: [],
  8: ["WP.1 申请表", "全套公司文件", "全套外国人文件", "体检报告", "雇佣合同", "WP3 批准函"],
  9: [],
  10: ["更新后的公司注册证明书", "更新后的场地照片", "工作证蓝本", "雇佣合同", "近3个月工资单", "个税单", "社保缴费记录"],
  11: ["续签申请表（TM.7）", "全套更新公司文件", "全套更新外国人文件", "工作证蓝本"],
  12: [],
  13: [],
};

export const workVisaSubServices: { key: string; label: string; businessTypeId: number }[] = [];

export const tisiSubServices = [
  { key: "tisi-main", label: "TISI认证", businessTypeId: 4 },
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
  1: ["公司证书（不超过6个月）", "法人护照", "商标文件", "PP20", "银行账号", "TK Mall链接", "LazMall链接", "所有文件蓝笔签名+盖章"],
  2: ["产品图片", "产品视频"],
  3: ["公司邮箱", "公司电话", "公司文件", "商标文件", "Mall店链接"],
  4: [],
  5: ["店铺账号密码", "PP20", "合同（泰文+英文各一份）", "E-Tax测试（80分以上）"],
  6: [],
  7: ["付款凭证截图"],
  8: [],
};

export const mallTiktokDocs: Record<number, string[]> = {
  1: ["企业店铺信息", "商标资料", "法人护照", "公司证书（不超过6个月）", "店铺账号密码", "其他平台店铺链接"],
  2: ["WIPO商标信息", "TM标或R标证书"],
  3: ["Instagram主页（粉丝>1万）", "产品图"],
  4: [],
  5: [],
  6: [],
};

export const mallLazadaDocs: Record<number, string[]> = {
  1: ["公司证书（不超过6个月）", "PP20", "公司银行账户", "法人护照", "电话号码", "邮箱密码", "电器类：自有TISI认证"],
  2: ["全套公司文件", "商标资料"],
  3: ["DBD登记仓库地址", "仓库现场照片"],
  4: [],
};

export const mallSubServices = [
  { key: "shopee", label: "Shopee Mall", businessTypeId: 8 },
  { key: "tiktok", label: "TikTok Mall", businessTypeId: 8 },
  { key: "lazada", label: "Lazada Mall", businessTypeId: 8 },
];
export const addressDocs: Record<number, string[]> = {
  1: ["地契", "租赁合同"],
  2: ["FDA系统开通申请表", "公司证书", "法人护照", "PP20"],
  3: [],
  4: ["授权书", "同意书"],
  5: [],
  6: ["平面图", "建筑图", "地图"],
  7: [],
  8: [],
  9: [],
  10: [],
  11: [],
  12: [],
  13: [],
  14: [],
  15: [],
  16: [],
};

export const customsDocs: Record<number, string[]> = {
  1: ["产品图+规格", "公司证书", "PP20", "法人护照/身份证", "泰国收货地址", "Invoice", "Packing List"],
  2: [],
  3: [],
  4: [],
  5: [],
  6: [],
};

/* ── DLD ── */
export const dldProductDocs: Record<number, string[]> = {
  1: ["产品名称+标签", "ISO工厂证书", "CFS", "配方", "工序说明", "成分列表"],
  2: [],
  3: [],
  4: [],
  5: [],
};

export const dldSiteDocs: Record<number, string[]> = {
  1: ["存储位置和进口位置分开", "有货架", "有合规标识"],
  2: ["场地平面图"],
  3: [],
  4: [],
};

export const dldSubServices = [
  { key: "product", label: "产品认证", businessTypeId: 5 },
  { key: "site", label: "场地确认", businessTypeId: 5 },
];

/* ── 通用查询函数 ── */
export function getStepDocs(businessTypeId: number, subServiceType?: string): Record<number, string[]> {
  if (businessTypeId === 1) return companyRegDocs;
  if (businessTypeId === 2) {
    if (subServiceType === "international") return internationalTrademarkDocs;
    if (subServiceType === "buy-r") return buyRTrademarkDocs;
    return trademarkDocs;
  }
  if (businessTypeId === 3) {
    if (subServiceType === "food") return fdaFoodDocs;
    if (subServiceType === "hazard") return fdaHazardDocs;
    // 医疗器械暂无独立配置：返回空映射，避免展示化妆品的错误清单
    if (subServiceType === "medical") return {};
    return fdaCosmeticsDocs;
  }
  if (businessTypeId === 4) return tisiDocs;
  if (businessTypeId === 5) {
    if (subServiceType === "site") return dldSiteDocs;
    return dldProductDocs;
  }
  if (businessTypeId === 6) return customsDocs;
  if (businessTypeId === 7) return addressDocs;
  if (businessTypeId === 8) {
    if (subServiceType === "tiktok") return mallTiktokDocs;
    if (subServiceType === "lazada") return mallLazadaDocs;
    return mallShopeeDocs;
  }
  if (businessTypeId === 9) return nbtcDocs;
  if (businessTypeId === 10) return workVisaDocs;
  if (businessTypeId === 11) return socialSecurityDocs;
  return {};
}

export const stepRequiredDocs: Record<number, Record<number, string[]>> = {
  1: companyRegDocs, 2: trademarkDocs, 3: fdaCosmeticsDocs, 4: tisiDocs, 5: dldProductDocs, 6: customsDocs, 7: addressDocs, 8: mallShopeeDocs, 9: nbtcDocs, 10: workVisaDocs, 11: socialSecurityDocs,
};

export const subServices: Record<number, { key: string; label: string; businessTypeId: number }[]> = {
  1: companySubServices, 2: trademarkSubServices, 3: fdaSubServices, 4: tisiSubServices, 5: dldSubServices, 6: [], 7: [], 8: mallSubServices, 9: [], 10: [], 11: [],
};

