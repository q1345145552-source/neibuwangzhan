import type { CommerceOrderPurchase } from "./commerce-types";
import { getStoredAuthToken } from "@/lib/auth-storage";

export interface Order {
  commerce_purchase?: CommerceOrderPurchase | null;
  source_system?: string;
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
  trademark_name?: string;
  cancel_reason?: string;
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
  started_at?: string | null;
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
  /** 在职/离职/试用期/待离职/停薪留职，默认在职 */
  status?: string;
  /** 离职日期 YYYY-MM-DD，空表示未离职 */
  resignation_date?: string;
  /** 离职原因 */
  resignation_reason?: string;
  /** 头像地址（/api/files/...），空表示未上传 */
  avatar?: string;
  /** 入职日期 YYYY-MM-DD，空表示未填写 */
  hire_date?: string;
  /** 性别 */
  gender?: string;
  /** 出生日期 YYYY-MM-DD */
  birth_date?: string;
  /** 电话 */
  phone?: string;
  /** 住址 */
  address?: string;
  /** 身份证号或护照号 */
  id_number?: string;
  /** 部门 */
  department?: string;
  /** 职位 */
  position?: string;
  /** 合同期限 */
  contract_term?: string;
  /** 开户银行 */
  bank_name?: string;
  /** 银行账号 */
  bank_account?: string;
  /** 紧急联系人姓名 */
  emergency_name?: string;
  /** 紧急联系人电话 */
  emergency_phone?: string;
  /** 紧急联系人关系 */
  emergency_relation?: string;
  /** 学历 */
  education?: string;
  /** 技能 */
  skills?: string;
  /** 备注 */
  notes?: string;
  /** 生辰八字 */
  bazi?: string;
  /** 算命（命理分析/算命结果） */
  fortune?: string;
  /** 护照号 */
  passport_number?: string;
  /** 社保号 */
  social_security_number?: string;
  /** 税号 */
  tax_number?: string;
  /** 工作证号 */
  work_permit_number?: string;
  /** 工作证到期日 YYYY-MM-DD */
  work_permit_expiry?: string;
  /** 签证到期日 YYYY-MM-DD */
  visa_expiry?: string;
  /** 仅 client 角色：该账号在外部客户端口能看到哪些公司的订单 */
  customer_names?: string[];
}

/** 员工记过/记优点记录 */
export interface EmployeeRecord {
  id: number;
  employee_id: number;
  /** demerit=记过(扣分)，merit=记优点(加分) */
  type: "demerit" | "merit";
  /** 分值（正数，一分=十泰铢） */
  points: number;
  content: string;
  created_by: string;
  created_at: string;
}

/** 员工自助信息变更申请 */
export interface EmployeeInfoChange {
  id: number;
  employee_id: number;
  employee_name: string;
  phone: string;
  address: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  status: "待审核" | "已通过" | "已驳回";
  reject_reason: string;
  created_by: string;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
}

/** 员工教育履历（学历记录） */
export interface EmployeeEducation {
  id: number;
  employee_id: number;
  level: string;
  school: string;
  major: string;
  grad_year: string;
  created_at: string;
}

/** 员工个人情况记录（仅管理员） */
export interface EmployeePersonalNotes {
  employee_id: number;
  family_composition: string;
  family_relationship: string;
  family_economy: string;
  relationship_status: string;
  relationship_stability: string;
  relationship_affect: string;
  parents_alive: string;
  parents_health: string;
  parents_care: string;
  work_status: string;
  work_pressure: string;
  work_mentality: string;
  work_adaptation: string;
  family_factors: string;
  relationship_factors: string;
  health_factors: string;
  other_factors: string;
  family_factor_remark: string;
  relationship_factor_remark: string;
  health_factor_remark: string;
  other_factor_remark: string;
  updated_by: string;
  updated_at: string;
}

/** 员工体检记录（仅管理员） */
export interface MedicalExam {
  employee_id: number;
  exam_date: string;
  result: string;
  file_name: string;
  original_name: string;
  size: number;
  mime_type: string;
  file_url?: string;
  created_by: string;
  updated_by: string;
  updated_at: string;
  created_at: string;
}

/** 员工 AI 状态评估结果 */
export interface StatusAssessment {
  employee_id: number;
  level: string;
  reason: string;
  analyzed_at?: string;
  cached?: boolean;
}

/** 员工个人情况跟进记录（仅管理员） */
export interface PersonalFollowup {
  id: number;
  employee_id: number;
  follow_date: string;
  content: string;
  created_by: string;
  created_at: string;
}

/** 入职资料清单事项 */
export interface OnboardingDoc {
  id: number;
  employee_id: number;
  item: string;
  collected: number;
  updated_by: string;
  updated_at: string;
  created_at: string;
}

/** 离职交接清单事项 */
export interface HandoverItem {
  id: number;
  employee_id: number;
  item: string;
  done: number;
  updated_by: string;
  updated_at: string;
  created_at: string;
}

/** 员工记过（严重处分）记录 */
export interface Demerit {
  id: number;
  employee_id: number;
  employee_name: string;
  content: string;
  file_name: string;
  original_name: string;
  size: number;
  mime_type: string;
  created_by: string;
  created_at: string;
  file_url: string;
}

/** 员工档案文件 */
export interface EmployeeFile {
  id: number;
  employee_id: number;
  /** 合同 / 错误承认书 / 其他 */
  category: string;
  filename: string;
  original_name: string;
  size: number;
  mime_type: string;
  created_by: string;
  created_at: string;
  url: string;
}

export interface Document {
  publication_verified?: number;
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
  commerce_refund?: boolean;
  id: number;
  order_id: string;
  type: string;
  amount: number;
  status: string;
  description: string;
  payment_method?: string;
  slip_number?: string;
  slip_file?: string;
  currency?: string;
  trademark_name?: string;
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
  canceled: number;
  today_todos: number;
}

// ----- API functions -----


// ---- Auth helper ----
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}


// 统一封装带认证的 fetch，防止后退导航时 token 丢失导致错误冒泡
export async function fetchWithAuth(url: string, options?: RequestInit): Promise<Response> {
  const token = getStoredAuthToken();
  // token 为空时不发请求，避免 401 污染页面
  if (!token) throw new Error("NO_TOKEN");
  const headers: Record<string, string> = { ...(options?.headers as Record<string, string> || {}) };
  headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}


export async function fetchOrders(params?: { business_type_id?: number; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.business_type_id) searchParams.set("business_type_id", String(params.business_type_id));
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  const res = await fetch(`/api/orders${query ? "?" + query : ""}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取订单失败");
  return res.json() as Promise<Order[]>;
}

export async function fetchOrder(id: string) {
  const res = await fetch(`/api/orders/${id}`, { headers: authHeaders(), cache: "no-store" });
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
  trademark_name?: string;
}) {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const resData = await res.json();
  if (!res.ok) throw new Error(resData.error || "创建订单失败");
  return resData as Order;
}

export async function updateOrder(id: string, data: Partial<{ customer_name: string; business_type_id: number; description: string; responsible_person: string; total_amount: number; sub_service_type: string; address_type: string; monthly_rent: number; currency?: string; trademark_name?: string; cancel?: boolean; restore?: boolean; cancel_reason?: string }>) {
  const res = await fetch(`/api/orders/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const updateData = await res.json();
  if (!res.ok) throw new Error(updateData.error || "更新订单失败");
  return updateData as Order;
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
  const res = await fetch("/api/business-types", { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取业务线失败");
  return res.json() as Promise<BusinessType[]>;
}

export async function fetchEmployees(params?: { include_left?: boolean }) {
  const q = params?.include_left ? "?include_left=1" : "";
  const res = await fetch(`/api/employees${q}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取员工列表失败");
  return res.json() as Promise<Employee[]>;
}

export async function createEmployee(data: { name: string; email: string; role?: string; password?: string; hire_date?: string }) {
  const res = await fetch("/api/employees", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("创建员工失败");
  return res.json();
}

export async function updateStep(orderId: string, stepId: number, data: { status?: string; notes?: string; assignee?: string; approval_status?: string; submission_count?: number }) {
  const res = await fetch(`/api/orders/${orderId}/steps`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ step_id: stepId, ...data }),
  });
  if (!res.ok) {
    let msg = "更新步骤失败";
    try { const err = await res.json(); if (err?.error) msg = err.error; } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<OrderStep>;
}

export async function fetchDashboardStats() {
  const res = await fetch("/api/dashboard/stats", { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取仪表盘数据失败");
  return res.json() as Promise<DashboardStats>;
}

export async function fetchDocuments(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/documents`, { headers: authHeaders(), cache: "no-store" });
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
  const res = await fetch(`/api/orders/${orderId}/finances`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取费用失败");
  return res.json() as Promise<Finance[]>;
}

export async function addFinance(orderId: string, data: { type: string; amount: number; description?: string; payment_method?: string; slip_number?: string; slip_file?: string; status?: string; currency?: string }) {
  const res = await fetch(`/api/orders/${orderId}/finances`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("新增费用失败");
  return res.json() as Promise<Finance>;
}

export async function updateFinance(orderId: string, financeId: number, data: Partial<{ type: string; amount: number; description: string; payment_method: string; slip_number: string; slip_file: string; status: string; currency: string }>) {
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
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/notes`, { headers: authHeaders(), cache: "no-store" });
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
  const res = await fetch(`/api/orders/${orderId}/steps/${stepId}/documents`, { headers: authHeaders(), cache: "no-store" });
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
  const res = await fetch(`/api/orders/${orderId}/certificates`, { headers: authHeaders(), cache: "no-store" });
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
  "客户取消": "客户取消",
};

export const statusClass: Record<string, string> = {
  "待处理": "bg-[color-mix(in_oklch,var(--warning),var(--background)_85%)] text-[oklch(0.40_0.14_85)]",
  "进行中": "bg-[color-mix(in_oklch,var(--info),var(--background)_85%)] text-[oklch(0.38_0.10_240)]",
  "已完成": "bg-[color-mix(in_oklch,var(--success),var(--background)_85%)] text-[oklch(0.38_0.14_155)]",
  "已逾期": "bg-[color-mix(in_oklch,var(--destructive),var(--background)_92%)] text-[oklch(0.35_0.18_25)]",
  "客户取消": "bg-[var(--muted)] text-[var(--muted-foreground)]",
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
  const res = await fetch(`/api/tasks${query ? "?" + query : ""}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取任务失败");
  return res.json();
}


export async function fetchAssignedSteps(userName: string) {
  const res = await fetch(`/api/steps/assigned?user=${encodeURIComponent(userName)}`, { headers: authHeaders(), cache: "no-store" });
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
  const res = await fetch(`/api/documents${query ? "?" + query : ""}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取文档失败");
  return res.json();
}

export async function uploadGlobalDocument(data: { name: string; file_type?: string; file_url?: string; order_id?: string }) {
  const res = await fetch("/api/documents", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("上传文档失败");
  return res.json();
}

export async function deleteGlobalDocument(id: number) {
  const res = await fetch('/api/documents?id=' + id, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('删除文档失败');
  return res.json();
}

export async function fetchAllFinances(params?: { type?: string; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.type) searchParams.set("type", params.type);
  if (params?.status) searchParams.set("status", params.status);
  const query = searchParams.toString();
  const res = await fetch(`/api/finances${query ? "?" + query : ""}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取费用失败");
  return res.json();
}

export async function updateEmployee(
  id: number,
  data: { name?: string; email?: string; role?: string; password?: string; status?: string; resignation_date?: string; resignation_reason?: string; hire_date?: string; gender?: string; birth_date?: string; phone?: string; address?: string; id_number?: string; department?: string; position?: string; contract_term?: string; bank_name?: string; bank_account?: string; emergency_name?: string; emergency_phone?: string; emergency_relation?: string; education?: string; skills?: string; notes?: string; bazi?: string; fortune?: string; passport_number?: string; social_security_number?: string; tax_number?: string; work_permit_number?: string; work_permit_expiry?: string; visa_expiry?: string; customer_names?: string[] }
) {
  const res = await fetch("/api/employees", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...data }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "更新员工失败");
  return result as Employee;
}

/** 某员工的记过/记优点记录（按时间倒序） */
export async function fetchEmployeeRecords(employeeId: number): Promise<EmployeeRecord[]> {
  const res = await fetch(`/api/employees/records?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取记录失败");
  return res.json();
}

/** 给员工记过/记优点 */
export async function createEmployeeRecord(data: { employee_id: number; type: "demerit" | "merit"; points: number; content: string }): Promise<EmployeeRecord> {
  const res = await fetch("/api/employees/records", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "记录失败");
  return result as EmployeeRecord;
}

/** 某员工的记过（严重处分）记录 + 记过次数 */
export async function fetchDemerits(employeeId: number): Promise<{ count: number; records: Demerit[] }> {
  const res = await fetch(`/api/employees/demerits?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取记过记录失败");
  return res.json();
}

/** 给员工记过（严重处分），可附警告函文件 */
export async function createDemerit(employeeId: number, content: string, file: File | null): Promise<Demerit> {
  const fd = new FormData();
  fd.append("employee_id", String(employeeId));
  fd.append("content", content);
  if (file) fd.append("file", file);
  const res = await fetch("/api/employees/demerits", { method: "POST", headers: authHeaders(), body: fd });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "记过失败");
  return result as Demerit;
}

/** 个人情况最近更新状态（仅管理员） */
export interface PersonalUpdateStatus {
  id: number;
  name: string;
  updated_at: string;
}

/** 所有员工个人情况最近更新日期（仅管理员） */
export async function fetchPersonalStatus(): Promise<PersonalUpdateStatus[]> {
  const res = await fetch("/api/employees/personal/status", { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取更新状态失败");
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

/** 体检记录（仅管理员） */
export async function fetchMedicalExam(employeeId: number): Promise<MedicalExam | null> {
  const res = await fetch(`/api/employees/medical?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取体检记录失败");
  return res.json();
}

/** 保存体检记录（仅管理员，可上传报告文件） */
export async function saveMedicalExam(employeeId: number, data: { exam_date: string; result: string }, file: File | null): Promise<MedicalExam> {
  const fd = new FormData();
  fd.append("employee_id", String(employeeId));
  fd.append("exam_date", data.exam_date);
  fd.append("result", data.result);
  if (file) fd.append("file", file);
  const res = await fetch("/api/employees/medical", { method: "PUT", headers: authHeaders(), body: fd });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "保存失败");
  return result as MedicalExam;
}

/** 已缓存的员工状态评估（仅管理员） */
export async function fetchStatusAssessment(employeeId: number): Promise<StatusAssessment | null> {
  const res = await fetch(`/api/employees/status-assessment?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取评估失败");
  return res.json();
}

/** 评估员工状态（仅管理员，结果缓存） */
export async function assessStatus(employeeId: number): Promise<StatusAssessment> {
  const res = await fetch("/api/employees/status-assessment", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "评估失败");
  return result as StatusAssessment;
}

/** 个人情况记录（仅管理员） */
export async function fetchPersonalNotes(employeeId: number): Promise<EmployeePersonalNotes> {
  const res = await fetch(`/api/employees/personal?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取个人情况失败");
  return res.json();
}

/** 保存个人情况记录（仅管理员） */
export async function savePersonalNotes(employeeId: number, data: Partial<EmployeePersonalNotes>): Promise<EmployeePersonalNotes> {
  const res = await fetch("/api/employees/personal", {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId, ...data }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "保存失败");
  return result as EmployeePersonalNotes;
}

/** 个人情况跟进记录（仅管理员） */
export async function fetchPersonalFollowups(employeeId: number): Promise<PersonalFollowup[]> {
  const res = await fetch(`/api/employees/personal/followups?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取跟进记录失败");
  return res.json();
}

/** 记一条个人情况跟进 */
export async function createPersonalFollowup(data: { employee_id: number; follow_date: string; content: string }): Promise<PersonalFollowup> {
  const res = await fetch("/api/employees/personal/followups", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "新增失败");
  return result as PersonalFollowup;
}

/** 删除一条个人情况跟进 */
export async function deletePersonalFollowup(id: number): Promise<void> {
  const res = await fetch("/api/employees/personal/followups", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.error || "删除失败");
  }
}

/** 入职资料清单 */
export async function fetchOnboardingDocs(employeeId: number): Promise<OnboardingDoc[]> {
  const res = await fetch(`/api/employees/onboarding?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取入职清单失败");
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

/** 入职清单逐项勾选已收集/未收集 */
export async function toggleOnboardingDoc(id: number, collected: boolean): Promise<OnboardingDoc> {
  const res = await fetch("/api/employees/onboarding", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, collected }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "更新失败");
  return result as OnboardingDoc;
}

/** 离职交接清单 */
export async function fetchHandover(employeeId: number): Promise<HandoverItem[]> {
  const res = await fetch(`/api/employees/handover?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取交接清单失败");
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

/** 交接清单逐项打勾/取消（done=true 表示已办完） */
export async function toggleHandoverItem(id: number, done: boolean): Promise<HandoverItem> {
  const res = await fetch("/api/employees/handover", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, done }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "更新失败");
  return result as HandoverItem;
}

/** 信息变更申请列表（管理员看全部，员工看自己） */
export async function fetchEmployeeInfoChanges(status?: string): Promise<EmployeeInfoChange[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/employee-info-changes${q}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取变更申请失败");
  return res.json();
}

/** 员工自助提交信息变更申请 */
export async function createEmployeeInfoChange(data: { phone: string; address: string; emergency_name: string; emergency_phone: string; emergency_relation: string }): Promise<EmployeeInfoChange> {
  const res = await fetch("/api/employee-info-changes", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "提交失败");
  return result as EmployeeInfoChange;
}

/** 管理员审核信息变更申请（通过/驳回） */
export async function reviewEmployeeInfoChange(id: number, status: "已通过" | "已驳回", reject_reason?: string): Promise<EmployeeInfoChange> {
  const res = await fetch("/api/employee-info-changes", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, status, reject_reason }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "审核失败");
  return result as EmployeeInfoChange;
}

/** 员工教育履历 */
export async function fetchEducations(employeeId: number): Promise<EmployeeEducation[]> {
  const res = await fetch(`/api/employees/educations?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取教育履历失败");
  return res.json();
}

/** 新增一条学历 */
export async function createEducation(data: { employee_id: number; level: string; school: string; major: string; grad_year: string }): Promise<EmployeeEducation> {
  const res = await fetch("/api/employees/educations", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "新增失败");
  return result as EmployeeEducation;
}

/** 编辑一条学历 */
export async function updateEducation(id: number, data: { level: string; school: string; major: string; grad_year: string }): Promise<EmployeeEducation> {
  const res = await fetch("/api/employees/educations", {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...data }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "编辑失败");
  return result as EmployeeEducation;
}

/** 删除一条学历 */
export async function deleteEducation(id: number): Promise<void> {
  const res = await fetch("/api/employees/educations", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.error || "删除失败");
  }
}

/** 员工档案文件列表 */
export async function fetchEmployeeFiles(employeeId: number): Promise<EmployeeFile[]> {
  const res = await fetch(`/api/employees/files?employee_id=${employeeId}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取文件失败");
  return res.json();
}

/** 上传员工档案文件（multipart） */
export async function uploadEmployeeFile(employeeId: number, category: string, file: File): Promise<EmployeeFile> {
  const fd = new FormData();
  fd.append("employee_id", String(employeeId));
  fd.append("category", category);
  fd.append("file", file);
  const res = await fetch("/api/employees/files", { method: "POST", headers: authHeaders(), body: fd });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "上传失败");
  return result as EmployeeFile;
}

/** 删除员工档案文件 */
export async function deleteEmployeeFile(id: number): Promise<void> {
  const res = await fetch("/api/employees/files", {
    method: "DELETE",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const result = await res.json().catch(() => ({}));
    throw new Error(result.error || "删除失败");
  }
}

/** 订单里出现过的全部客户公司名，供配置客户账号可见范围时选择 */
export async function fetchOrderCustomerNames(): Promise<string[]> {
  const res = await fetch("/api/orders", { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error("获取客户名失败");
  const orders = (await res.json()) as Order[];
  return [...new Set(orders.map((o) => o.customer_name).filter(Boolean))].sort();
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

// ── Influencer phase ──
export async function startPhase(influencerId: number, phase: string) {
  const res = await fetchWithAuth(`/api/influencers/${influencerId}/start-phase`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phase }),
  });
  if (!res.ok) throw new Error("启动阶段失败");
  return res.json();
}
