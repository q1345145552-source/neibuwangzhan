export interface Order {
  id: string;
  customer_name: string;
  business_type_id: number;
  sub_service_type: string;
  address_type: string;
  monthly_rent: number;
  status: string;
  responsible_person: string;
  description: string;
  total_amount: number;
  currency?: string;
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
  approval_status: string;
  submission_count: number;
  deadline: string;
  logistics_status: string;
  step_data: string;
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
  email?: string;
  role?: string;
}

export interface Document {
  id: number;
  order_id: string;
  name: string;
  file_type: string;
  status: string;
  direction?: string;
  file_url?: string;
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
  payment_method?: string;
  slip_number?: string;
  slip_file?: string;
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

export interface Certificate {
  id: number;
  order_id: string;
  certificate_number: string;
  product_name: string;
  issue_date: string;
  expiry_date: string;
  status: string;
  nsw_registration: string;
  nsw_download_status: string;
  notes: string;
  file_url?: string;
  created_at: string;
}

export interface DashboardStats {
  total_orders: number;
  in_progress: number;
  completed: number;
  today_todos: number;
}

// ----- API functions -----


// ---- Auth helper ----
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchOrders(params?: { business_type_id?: number; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.business_type_id) searchParams.set("business_type_id", String(params.business_type_id));
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  const res = await fetch(`/api/orders${query ? "?" + query : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取订单失败");
  return res.json() as Promise<Order[]>;
}

export async function fetchOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取订单详情失败");
  return res.json() as Promise<Order & { steps: OrderStep[] }>;
}

export async function createOrder(data: {
  customer_name: string;
  business_type_id: number;
  description?: string;
  responsible_person?: string;
  total_amount?: number;
  sub_service_type?: string;
  address_type?: string;
  monthly_rent?: number;
  currency?: string;
}) {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("创建订单失败");
  return res.json() as Promise<Order>;
}

export async function updateOrder(id: string, data: Partial<{ customer_name: string; business_type_id: number; description: string; responsible_person: string; total_amount: number; sub_service_type: string; address_type: string; monthly_rent: number; currency?: string }>) {
  const res = await fetch(`/api/orders/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("更新订单失败");
  return res.json() as Promise<Order>;
}

export async function deleteOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("删除订单失败");
  return res.json();
}

export async function fetchBusinessTypes() {
  const res = await fetch("/api/business-types", { headers: authHeaders() });
  if (!res.ok) throw new Error("获取业务线失败");
  return res.json() as Promise<BusinessType[]>;
}

export async function fetchEmployees() {
  const res = await fetch("/api/employees", { headers: authHeaders() });
  if (!res.ok) throw new Error("获取员工列表失败");
  return res.json() as Promise<Employee[]>;
}

export async function createEmployee(data: { name: string; email: string; role?: string; password?: string }) {
  const res = await fetch("/api/employees", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("创建员工失败");
  return res.json();
}

export async function updateStep(orderId: string, stepId: number, data: { status: string; notes?: string; assignee?: string; approval_status?: string; submission_count?: number }) {
  const res = await fetch(`/api/orders/${orderId}/steps`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, ...data }),
  });
  if (!res.ok) throw new Error("更新步骤失败");
  return res.json() as Promise<OrderStep>;
}

export async function fetchDashboardStats() {
  const res = await fetch("/api/dashboard/stats", { headers: authHeaders() });
  if (!res.ok) throw new Error("获取仪表盘数据失败");
  return res.json() as Promise<DashboardStats>;
}

export async function fetchDocuments(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/documents`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取文档失败");
  return res.json() as Promise<Document[]>;
}

export async function uploadDocument(orderId: string, data: { name: string; file_type?: string; uploaded_by?: string; direction?: string; file_url?: string }) {
  const res = await fetch(`/api/orders/${orderId}/documents`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("上传文档失败");
  return res.json() as Promise<Document>;
}

export async function deleteDocument(orderId: string, documentId: number) {
  const res = await fetch(`/api/orders/${orderId}/documents`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!res.ok) throw new Error("删除文档失败");
  return res.json();
}

export async function fetchFinances(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/finances`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取费用失败");
  return res.json() as Promise<Finance[]>;
}

export async function addFinance(orderId: string, data: { type: string; amount: number; description?: string; payment_method?: string; slip_number?: string; slip_file?: string; status?: string }) {
  const res = await fetch(`/api/orders/${orderId}/finances`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("新增费用失败");
  return res.json() as Promise<Finance>;
}

export async function updateFinance(orderId: string, financeId: number, data: Partial<{ type: string; amount: number; description: string; payment_method: string; slip_number: string; slip_file: string; status: string }>) {
  const res = await fetch(`/api/orders/${orderId}/finances`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ finance_id: financeId, ...data }),
  });
  if (!res.ok) throw new Error("更新费用失败");
  return res.json() as Promise<Finance>;
}

export async function deleteFinance(orderId: string, financeId: number) {
  const res = await fetch(`/api/orders/${orderId}/finances`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ finance_id: financeId }),
  });
  if (!res.ok) throw new Error("删除费用失败");
  return res.json();
}

export async function fetchStepNotes(orderId: string, stepId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取备注失败");
  return res.json() as Promise<StepNote[]>;
}

export async function addStepNote(orderId: string, stepId: number, content: string, createdBy: string) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ content, created_by: createdBy }),
  });
  if (!res.ok) throw new Error("添加备注失败");
  return res.json() as Promise<StepNote>;
}

export async function deleteStepNote(orderId: string, stepId: number, noteId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ note_id: noteId }),
  });
  if (!res.ok) throw new Error("删除备注失败");
  return res.json();
}

export async function fetchStepDocuments(orderId: string, stepId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/documents`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取文档清单失败");
  return res.json() as Promise<StepDocument[]>;
}

export async function markStepDocumentUploaded(orderId: string, stepId: number, documentId: number) {
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/documents/mark-uploaded`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ document_id: documentId }),
  });
  if (!res.ok) throw new Error("标记上传失败");
  return res.json() as Promise<StepDocument>;
}

export async function fetchCertificates(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/certificates`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取证书失败");
  return res.json() as Promise<Certificate[]>;
}

export async function addCertificate(orderId: string, data: { certificate_number: string; product_name?: string; issue_date?: string; expiry_date?: string; notes?: string; file_url?: string }) {
  const res = await fetch(`/api/orders/${orderId}/certificates`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("添加证书失败");
  return res.json() as Promise<Certificate>;
}

export async function updateCertificate(orderId: string, certId: number, data: Partial<{ certificate_number?: string; product_name?: string; issue_date?: string; expiry_date?: string; status?: string; nsw_registration?: string; nsw_download_status?: string; notes?: string; file_url?: string }>) {
  const res = await fetch(`/api/orders/${orderId}/certificates`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ cert_id: certId, ...data }),
  });
  if (!res.ok) throw new Error("更新证书失败");
  return res.json();
}

export async function deleteCertificate(orderId: string, certId: number) {
  const res = await fetch(`/api/orders/${orderId}/certificates`, {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ cert_id: certId }),
  });
  if (!res.ok) throw new Error("删除证书失败");
  return res.json();
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



export interface Task {
  id: string;
  title: string;
  description?: string;
  assignee?: string;
  priority?: "low" | "medium" | "high";
  status?: "pending" | "in_progress" | "completed";
  business_line?: string;
  deadline?: string;
  order_id?: string;
  created_at?: string;
}

export async function fetchTasks(params?: { business?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.business) searchParams.set("business", params.business);
  const query = searchParams.toString();
  const res = await fetch(`/api/tasks${query ? "?" + query : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取任务失败");
  return res.json();
}


export async function fetchAssignedSteps(userName: string) {
  const res = await fetch(`/api/steps/assigned?user=${encodeURIComponent(userName)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("加载失败");
  return res.json();
}

export async function createTask(data: { title: string; assignee?: string; priority?: string; business_line?: string; deadline?: string }) {
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("创建任务失败");
  return res.json();
}

export async function updateTaskStatus(id: string, status: string) {
  const res = await fetch("/api/tasks", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
  if (!res.ok) throw new Error("更新任务失败");
  return res.json();
}

export async function deleteTask(id: string) {
  const res = await fetch("/api/tasks", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error("删除任务失败");
  return res.json();
}

export async function fetchAllDocuments(params?: { business?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.business) searchParams.set("business", params.business);
  const query = searchParams.toString();
  const res = await fetch(`/api/documents${query ? "?" + query : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取文档失败");
  return res.json();
}

export async function fetchAllFinances(params?: { type?: string; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  const res = await fetch(`/api/finances${query ? "?" + query : ""}`, { headers: authHeaders() });
  if (!res.ok) throw new Error("获取费用失败");
  return res.json();
}

export async function updateEmployee(id: number, data: { name?: string; email?: string; role?: string; password?: string }) {
  const res = await fetch("/api/employees", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...data }),
  });
  if (!res.ok) throw new Error("更新员工失败");
  return res.json();
}

export async function deleteEmployee(id: number) {
  const res = await fetch("/api/employees", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error("删除员工失败");
  return res.json();
}
