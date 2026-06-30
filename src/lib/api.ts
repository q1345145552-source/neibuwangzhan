export interface Order {
  id: string;
  customer_name: string;
  business_type_id: number;
  status: string;
  responsible_person: string;
  description: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  steps?: OrderStep[];
}

export interface OrderStep {
  id: number;
  order_id: string;
  step_name: string;
  step_order: number;
  status: string;
  assignee: string;
  notes: string;
  completed_at: string | null;
  created_at: string;
}

export interface BusinessType {
  id: number;
  name: string;
}

export interface Employee {
  id: number;
  name: string;
}

export interface Document {
  id: number;
  order_id: string;
  name: string;
  file_type: string;
  status: string;
  uploaded_by: string;
  created_at: string;
}

export interface Finance {
  id: number;
  order_id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  created_at: string;
}

export interface StepNote {
  id: number;
  step_id: number;
  order_id: string;
  content: string;
  created_by: string;
  created_at: string;
}

export interface StepDocument {
  id: number;
  step_id: number;
  order_id: string;
  document_name: string;
  status: string;
  created_at: string;
}

export interface DashboardStats {
  total_orders: number;
  in_progress: number;
  completed: number;
  today_todos: number;
}

// ----- API functions -----

export async function fetchOrders(params?: { business_type_id?: number; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.business_type_id) searchParams.set("business_type_id", String(params.business_type_id));
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  const res = await fetch(`/api/orders${query ? "?" + query : ""}`);
  if (!res.ok) throw new Error("获取订单失败");
  return res.json() as Promise<Order[]>;
}

export async function fetchOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`);
  if (!res.ok) throw new Error("获取订单详情失败");
  return res.json() as Promise<Order & { steps: OrderStep[] }>;
}

export async function createOrder(data: {
  customer_name: string;
  business_type_id: number;
  description?: string;
  responsible_person?: string;
  total_amount?: number;
}) {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("创建订单失败");
  return res.json() as Promise<Order>;
}

export async function fetchBusinessTypes() {
  const res = await fetch("/api/business-types");
  if (!res.ok) throw new Error("获取业务线失败");
  return res.json() as Promise<BusinessType[]>;
}

export async function fetchEmployees() {
  const res = await fetch("/api/employees");
  if (!res.ok) throw new Error("获取员工列表失败");
  return res.json() as Promise<Employee[]>;
}

export async function updateStep(orderId: string, stepId: number, data: { status: string; notes?: string; assignee?: string }) {
  const res = await fetch(`/api/orders/${orderId}/steps`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, ...data }),
  });
  if (!res.ok) throw new Error("更新步骤失败");
  return res.json() as Promise<OrderStep>;
}

export async function fetchDashboardStats() {
  const res = await fetch("/api/dashboard/stats");
  if (!res.ok) throw new Error("获取仪表盘数据失败");
  return res.json() as Promise<DashboardStats>;
}

export async function fetchDocuments(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/documents`);
  if (!res.ok) throw new Error("获取文档失败");
  return res.json() as Promise<Document[]>;
}

export async function uploadDocument(orderId: string, data: { name: string; file_type?: string; uploaded_by?: string }) {
  const res = await fetch(`/api/orders/${orderId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("上传文档失败");
  return res.json() as Promise<Document>;
}

export async function fetchFinances(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/finances`);
  if (!res.ok) throw new Error("获取费用失败");
  return res.json() as Promise<Finance[]>;
}

export async function addFinance(orderId: string, data: { type: string; amount: number; description?: string }) {
  const res = await fetch(`/api/orders/${orderId}/finances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("新增费用失败");
  return res.json() as Promise<Finance>;
}

export async function fetchStepNotes(orderId: string, stepId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`);
  if (!res.ok) throw new Error("获取备注失败");
  return res.json() as Promise<StepNote[]>;
}

export async function addStepNote(orderId: string, stepId: number, content: string, createdBy: string) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, created_by: createdBy }),
  });
  if (!res.ok) throw new Error("添加备注失败");
  return res.json() as Promise<StepNote>;
}

export async function fetchStepDocuments(orderId: string, stepId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/documents`);
  if (!res.ok) throw new Error("获取文档清单失败");
  return res.json() as Promise<StepDocument[]>;
}

export async function markStepDocumentUploaded(orderId: string, stepId: number, documentId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/documents/mark-uploaded`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!res.ok) throw new Error("标记上传失败");
  return res.json() as Promise<StepDocument>;
}

// ----- 前端状态映射 -----

export const statusLabels: Record<string, string> = {
  "待处理": "待处理",
  "进行中": "进行中",
  "已完成": "已完成",
  "已逾期": "已逾期",
};

export const statusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "已逾期": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
};
