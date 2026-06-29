export interface Order {
  id: string;
  businessLine: string;
  clientName: string;
  contactPerson: string;
  amount: number;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
  createdAt: string;
  deadline: string;
  assignee: string;
  description: string;
}

export const orders: Order[] = [
  {
    id: "ORD-2026-0001",
    businessLine: "公司注册",
    clientName: "华夏科技有限公司",
    contactPerson: "李明",
    amount: 35000,
    status: "completed",
    priority: "medium",
    createdAt: "2026-06-20",
    deadline: "2026-07-15",
    assignee: "张三",
    description: "有限责任公司注册，注册资本500万元，含营业执照、刻章、银行开户一站式服务",
  },
  {
    id: "ORD-2026-0002",
    businessLine: "商标",
    clientName: "创新品牌管理有限公司",
    contactPerson: "王芳",
    amount: 8500,
    status: "in_progress",
    priority: "high",
    createdAt: "2026-06-25",
    deadline: "2026-07-10",
    assignee: "李四",
    description: "第35类、第42类商标注册申请，含商标检索、申请文件准备、提交及后续跟踪",
  },
  {
    id: "ORD-2026-0003",
    businessLine: "FDA产品认证",
    clientName: "康健医疗设备有限公司",
    contactPerson: "赵强",
    amount: 125000,
    status: "pending",
    priority: "high",
    createdAt: "2026-06-28",
    deadline: "2026-08-20",
    assignee: "张三",
    description: "II类医疗器械FDA 510(k)认证，含技术文档编写、测试协调、提交及FDA沟通",
  },
  {
    id: "ORD-2026-0004",
    businessLine: "TISI",
    clientName: "东南亚贸易有限公司",
    contactPerson: "陈静",
    amount: 28000,
    status: "in_progress",
    priority: "medium",
    createdAt: "2026-06-15",
    deadline: "2026-07-25",
    assignee: "王五",
    description: "电子产品TISI认证，含样品测试、工厂审核、证书申请全流程",
  },
  {
    id: "ORD-2026-0005",
    businessLine: "DLD",
    clientName: "通达汽车配件有限公司",
    contactPerson: "刘洋",
    amount: 42000,
    status: "pending",
    priority: "medium",
    createdAt: "2026-06-27",
    deadline: "2026-08-05",
    assignee: "李四",
    description: "汽车零部件DLD认证，含产品检测、文件审核、认证申请",
  },
  {
    id: "ORD-2026-0006",
    businessLine: "清关",
    clientName: "环球进出口有限公司",
    contactPerson: "周磊",
    amount: 15000,
    status: "in_progress",
    priority: "high",
    createdAt: "2026-06-22",
    deadline: "2026-07-02",
    assignee: "王五",
    description: "一批电子产品进口清关，含报关、商检、缴税、放行全流程",
  },
  {
    id: "ORD-2026-0007",
    businessLine: "地址认证",
    clientName: "新创企业管理有限公司",
    contactPerson: "吴婷",
    amount: 5000,
    status: "completed",
    priority: "low",
    createdAt: "2026-06-18",
    deadline: "2026-06-30",
    assignee: "张三",
    description: "公司注册地址认证，含实地核查、文件认证、政府备案",
  },
  {
    id: "ORD-2026-0008",
    businessLine: "Mall开店",
    clientName: "时尚品牌运营有限公司",
    contactPerson: "郑浩",
    amount: 68000,
    status: "pending",
    priority: "medium",
    createdAt: "2026-06-26",
    deadline: "2026-08-15",
    assignee: "李四",
    description: "Lazada/Shopee双平台开店，含店铺注册、品牌备案、产品上架、运营指导",
  },
  {
    id: "ORD-2026-0009",
    businessLine: "商标",
    clientName: "科技创业孵化器有限公司",
    contactPerson: "孙鹏",
    amount: 12000,
    status: "cancelled",
    priority: "low",
    createdAt: "2026-06-10",
    deadline: "2026-07-10",
    assignee: "王五",
    description: "第9类、第38类商标注册",
  },
  {
    id: "ORD-2026-0010",
    businessLine: "FDA产品认证",
    clientName: "生物医药科技有限公司",
    contactPerson: "黄敏",
    amount: 98000,
    status: "in_progress",
    priority: "high",
    createdAt: "2026-06-23",
    deadline: "2026-09-01",
    assignee: "张三",
    description: "I类医疗器械FDA列名，含企业注册、产品列名、标签审核",
  },
];

export const businessLines = [
  "公司注册",
  "商标",
  "FDA产品认证",
  "TISI",
  "DLD",
  "清关",
  "地址认证",
  "Mall开店",
];

export const statusLabels: Record<Order["status"], string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

export const priorityLabels: Record<Order["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export const statusClass: Record<Order["status"], string> = {
  pending: "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  in_progress: "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  completed: "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  cancelled: "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};
