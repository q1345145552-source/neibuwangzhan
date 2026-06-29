export interface FinanceRecord {
  id: string;
  type: "income" | "expense" | "refund";
  description: string;
  orderId?: string;
  businessLine: string;
  clientName: string;
  amount: number;
  date: string;
  status: "paid" | "unpaid" | "refunded";
  method: string;
}

export const financeRecords: FinanceRecord[] = [
  { id: "FIN-001", type: "income", description: "公司注册服务费", orderId: "ORD-2026-0001", businessLine: "公司注册", clientName: "华夏科技有限公司", amount: 35000, date: "2026-06-20", status: "paid", method: "银行转账" },
  { id: "FIN-002", type: "income", description: "商标申请首期款", orderId: "ORD-2026-0002", businessLine: "商标", clientName: "创新品牌管理有限公司", amount: 5000, date: "2026-06-25", status: "paid", method: "微信支付" },
  { id: "FIN-003", type: "expense", description: "FDA官方申请费", orderId: "ORD-2026-0003", businessLine: "FDA产品认证", clientName: "康健医疗设备有限公司", amount: 8500, date: "2026-06-29", status: "paid", method: "银行转账" },
  { id: "FIN-004", type: "income", description: "TISI认证首期款", orderId: "ORD-2026-0004", businessLine: "TISI", clientName: "东南亚贸易有限公司", amount: 15000, date: "2026-06-15", status: "paid", method: "银行转账" },
  { id: "FIN-005", type: "expense", description: "TISI检测费", orderId: "ORD-2026-0004", businessLine: "TISI", clientName: "东南亚贸易有限公司", amount: 6000, date: "2026-06-20", status: "paid", method: "银行转账" },
  { id: "FIN-006", type: "income", description: "DLD认证服务费", orderId: "ORD-2026-0005", businessLine: "DLD", clientName: "通达汽车配件有限公司", amount: 42000, date: "2026-06-27", status: "unpaid", method: "待定" },
  { id: "FIN-007", type: "income", description: "清关服务费", orderId: "ORD-2026-0006", businessLine: "清关", clientName: "环球进出口有限公司", amount: 15000, date: "2026-06-22", status: "paid", method: "银行转账" },
  { id: "FIN-008", type: "income", description: "地址认证服务费", orderId: "ORD-2026-0007", businessLine: "地址认证", clientName: "新创企业管理有限公司", amount: 5000, date: "2026-06-18", status: "paid", method: "支付宝" },
  { id: "FIN-009", type: "income", description: "Mall开店首期款", orderId: "ORD-2026-0008", businessLine: "Mall开店", clientName: "时尚品牌运营有限公司", amount: 35000, date: "2026-06-26", status: "paid", method: "银行转账" },
  { id: "FIN-010", type: "refund", description: "商标申请退款", orderId: "ORD-2026-0009", businessLine: "商标", clientName: "科技创业孵化器有限公司", amount: 12000, date: "2026-06-15", status: "refunded", method: "银行转账" },
  { id: "FIN-011", type: "expense", description: "办公场地租金", businessLine: "-", clientName: "-", amount: 25000, date: "2026-06-01", status: "paid", method: "银行转账" },
  { id: "FIN-012", type: "income", description: "FDA认证尾款", orderId: "ORD-2026-0010", businessLine: "FDA产品认证", clientName: "生物医药科技有限公司", amount: 50000, date: "2026-08-25", status: "unpaid", method: "待定" },
];

export const summaryStats = {
  totalIncome: 217000,
  totalExpense: 39500,
  unpaidAmount: 92000,
  netRevenue: 177500,
};
