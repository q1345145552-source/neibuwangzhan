export interface Document {
  id: string;
  name: string;
  type: string;
  businessLine: string;
  orderId?: string;
  uploadBy: string;
  uploadDate: string;
  size: string;
  status: "approved" | "pending" | "rejected";
}

export const documents: Document[] = [
  { id: "DOC-001", name: "营业执照副本.pdf", type: "资质文件", businessLine: "公司注册", orderId: "ORD-2026-0001", uploadBy: "张三", uploadDate: "2026-06-20", size: "2.4 MB", status: "approved" },
  { id: "DOC-002", name: "商标申请书.docx", type: "申请文件", businessLine: "商标", orderId: "ORD-2026-0002", uploadBy: "李四", uploadDate: "2026-06-28", size: "156 KB", status: "pending" },
  { id: "DOC-003", name: "510(k)技术文档.pdf", type: "技术文档", businessLine: "FDA产品认证", orderId: "ORD-2026-0003", uploadBy: "张三", uploadDate: "2026-06-28", size: "12.8 MB", status: "pending" },
  { id: "DOC-004", name: "TISI测试报告.pdf", type: "检测报告", businessLine: "TISI", orderId: "ORD-2026-0004", uploadBy: "王五", uploadDate: "2026-06-22", size: "5.1 MB", status: "approved" },
  { id: "DOC-005", name: "DLD认证申请表.docx", type: "申请文件", businessLine: "DLD", orderId: "ORD-2026-0005", uploadBy: "李四", uploadDate: "2026-06-27", size: "89 KB", status: "pending" },
  { id: "DOC-006", name: "进口报关单.pdf", type: "报关文件", businessLine: "清关", orderId: "ORD-2026-0006", uploadBy: "王五", uploadDate: "2026-06-22", size: "1.2 MB", status: "approved" },
  { id: "DOC-007", name: "场地核查报告.pdf", type: "认证报告", businessLine: "地址认证", orderId: "ORD-2026-0007", uploadBy: "张三", uploadDate: "2026-06-30", size: "3.7 MB", status: "approved" },
  { id: "DOC-008", name: "店铺授权委托书.pdf", type: "委托文件", businessLine: "Mall开店", orderId: "ORD-2026-0008", uploadBy: "李四", uploadDate: "2026-06-26", size: "420 KB", status: "approved" },
  { id: "DOC-009", name: "商标使用证据.zip", type: "证据材料", businessLine: "商标", orderId: "ORD-2026-0002", uploadBy: "李四", uploadDate: "2026-06-29", size: "8.5 MB", status: "pending" },
  { id: "DOC-010", name: "企业注册登记表.pdf", type: "登记文件", businessLine: "公司注册", orderId: "ORD-2026-0001", uploadBy: "张三", uploadDate: "2026-06-21", size: "1.8 MB", status: "approved" },
];
