export interface Employee {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  department: string;
  status: "active" | "inactive";
  joinDate: string;
}

export const employees: Employee[] = [
  { id: "EMP-001", name: "张三", role: "管理员", email: "zhangsan@xiangtai.com", phone: "13800001111", department: "管理部", status: "active", joinDate: "2024-03-01" },
  { id: "EMP-002", name: "李四", role: "业务主管", email: "lisi@xiangtai.com", phone: "13800002222", department: "业务部", status: "active", joinDate: "2024-06-15" },
  { id: "EMP-003", name: "王五", role: "业务专员", email: "wangwu@xiangtai.com", phone: "13800003333", department: "业务部", status: "active", joinDate: "2025-01-10" },
  { id: "EMP-004", name: "赵六", role: "财务主管", email: "zhaoliu@xiangtai.com", phone: "13800004444", department: "财务部", status: "active", joinDate: "2024-04-20" },
  { id: "EMP-005", name: "钱七", role: "行政专员", email: "qianqi@xiangtai.com", phone: "13800005555", department: "行政部", status: "active", joinDate: "2025-03-01" },
  { id: "EMP-006", name: "孙八", role: "业务助理", email: "sunba@xiangtai.com", phone: "13800006666", department: "业务部", status: "inactive", joinDate: "2025-06-01" },
  { id: "EMP-007", name: "周九", role: "法务顾问", email: "zhoujiu@xiangtai.com", phone: "13800007777", department: "法务部", status: "active", joinDate: "2025-08-15" },
];
