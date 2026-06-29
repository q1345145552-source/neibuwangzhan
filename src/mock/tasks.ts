export interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "completed";
  orderId?: string;
  businessLine: string;
  deadline: string;
}

export const tasks: Task[] = [
  {
    id: "TASK-001",
    title: "审核FDA认证技术文档",
    description: "审查康健医疗提交的510(k)技术文档完整性和准确性",
    assignee: "张三",
    priority: "high",
    status: "pending",
    orderId: "ORD-2026-0003",
    businessLine: "FDA产品认证",
    deadline: "2026-07-05",
  },
  {
    id: "TASK-002",
    title: "跟进商标申请材料",
    description: "联系客户补充第35类商标使用证据",
    assignee: "李四",
    priority: "high",
    status: "in_progress",
    orderId: "ORD-2026-0002",
    businessLine: "商标",
    deadline: "2026-07-03",
  },
  {
    id: "TASK-003",
    title: "安排TISI样品测试",
    description: "协调实验室进行电子产品TISI标准测试",
    assignee: "王五",
    priority: "medium",
    status: "in_progress",
    orderId: "ORD-2026-0004",
    businessLine: "TISI",
    deadline: "2026-07-10",
  },
  {
    id: "TASK-004",
    title: "提交清关文件",
    description: "整理进口报关所需全套文件并提交海关",
    assignee: "王五",
    priority: "high",
    status: "completed",
    orderId: "ORD-2026-0006",
    businessLine: "清关",
    deadline: "2026-06-29",
  },
  {
    id: "TASK-005",
    title: "准备DLD检测清单",
    description: "根据泰国陆运厅要求整理汽车配件检测项目清单",
    assignee: "李四",
    priority: "medium",
    status: "pending",
    orderId: "ORD-2026-0005",
    businessLine: "DLD",
    deadline: "2026-07-08",
  },
  {
    id: "TASK-006",
    title: "公司注册后续年检提醒",
    description: "发送年检提醒邮件并准备相关材料",
    assignee: "张三",
    priority: "low",
    status: "pending",
    businessLine: "公司注册",
    deadline: "2026-07-15",
  },
  {
    id: "TASK-007",
    title: "Mall店铺装修优化",
    description: "优化Lazada店铺首页banner和产品分类",
    assignee: "李四",
    priority: "medium",
    status: "in_progress",
    orderId: "ORD-2026-0008",
    businessLine: "Mall开店",
    deadline: "2026-07-12",
  },
  {
    id: "TASK-008",
    title: "地址认证场地核查",
    description: "安排实地核查并出具认证报告",
    assignee: "张三",
    priority: "low",
    status: "completed",
    orderId: "ORD-2026-0007",
    businessLine: "地址认证",
    deadline: "2026-06-30",
  },
];

export const statusColumns = [
  { key: "pending", label: "待处理", count: 0 },
  { key: "in_progress", label: "进行中", count: 0 },
  { key: "completed", label: "已完成", count: 0 },
] as const;

export type TaskStatus = typeof statusColumns[number]["key"];
