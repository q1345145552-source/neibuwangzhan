export interface OrderProgress {
  step: string;
  label: string;
  status: "done" | "current" | "upcoming";
  date?: string;
  remark?: string;
}

export interface OrderDocument {
  name: string;
  type: string;
  uploadDate: string;
  status: "approved" | "pending" | "rejected";
}

export interface OrderCost {
  item: string;
  amount: number;
  date: string;
  status: "paid" | "unpaid";
}

export const orderProgressSteps: Record<string, OrderProgress[]> = {
  "ORD-2026-0002": [
    { step: "1", label: "需求确认", status: "done", date: "2026-06-25", remark: "已确认商标类别及申请策略" },
    { step: "2", label: "商标检索", status: "done", date: "2026-06-26", remark: "已完成近似商标检索，无冲突" },
    { step: "3", label: "材料准备", status: "current", date: "2026-06-28", remark: "正在准备申请材料" },
    { step: "4", label: "提交申请", status: "upcoming" },
    { step: "5", label: "审查公示", status: "upcoming" },
    { step: "6", label: "注册完成", status: "upcoming" },
  ],
};

export const orderDocuments: OrderDocument[] = [
  { name: "委托代理合同.pdf", type: "合同", uploadDate: "2026-06-25", status: "approved" },
  { name: "商标图样.png", type: "图样", uploadDate: "2026-06-26", status: "approved" },
  { name: "营业执照副本.pdf", type: "资质", uploadDate: "2026-06-26", status: "approved" },
  { name: "商标申请书.docx", type: "申请", uploadDate: "2026-06-28", status: "pending" },
  { name: "授权委托书.pdf", type: "委托", uploadDate: "2026-06-28", status: "approved" },
];

export const orderCosts: OrderCost[] = [
  { item: "官方申请费", amount: 3000, date: "2026-06-26", status: "paid" },
  { item: "代理服务费（首期）", amount: 3500, date: "2026-06-26", status: "paid" },
  { item: "商标检索费", amount: 500, date: "2026-06-26", status: "paid" },
  { item: "代理服务费（尾款）", amount: 1500, date: "2026-07-10", status: "unpaid" },
];
