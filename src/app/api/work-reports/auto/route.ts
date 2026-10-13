import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { bangkokDayRange } from "@/lib/time";

// 曼谷日期往前推 n 天（纯日历运算）
function dateMinusOne(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
}

// 一条操作日志 → 一句能看懂的话
function toSentence(action: string, targetId: string): string {
  let s = String(action || "操作").trim();
  const tid = String(targetId || "").trim();
  if (tid) s += ` ${tid}${/^\d+$/.test(tid) ? "号" : ""}`;
  return s;
}

const ORDER_TYPES = ["order", "step", "step_note", "step_document", "document", "finance", "certificate"];

// 订单子记录 → 归属订单 id
function resolveOrderId(db: ReturnType<typeof getDb>, tt: string, tid: string): string {
  if (tt === "order") return tid;
  const tableMap: Record<string, string> = {
    step: "order_steps", step_note: "step_notes", step_document: "step_documents",
    document: "documents", finance: "finances", certificate: "certificates",
  };
  const table = tableMap[tt];
  if (!table) return "";
  const row = db.prepare(`SELECT order_id FROM ${table} WHERE id = ?`).get(Number(tid)) as { order_id: string } | undefined;
  let orderId = row?.order_id || "";
  if (!orderId && tt === "document") orderId = tid; // document 的 target_id 有时直接是订单号
  return orderId;
}

// 「其他」类跳转地址
function otherHref(tt: string, tid: string): string {
  if (tt === "problem") return `/problems/${tid}`;
  if (tt === "customer") return `/customers/${tid}`;
  if (tt === "project") return `/projects/${tid}`;
  if (tt === "influencer") return `/agency/influencers/${tid}`;
  if (tt === "logistics" || tt === "logistics_note") return `/logistics/${tid}`;
  if (tt === "wht") return `/wht/${tid}`;
  if (tt === "vat_record" || tt === "vat") return `/vat`;
  return "";
}

// GET /api/work-reports/auto?date=YYYY-MM-DD — 自动带出：当天系统操作（分四类）+ 前一天的明日计划
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const date = (searchParams.get("date") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日期格式不对" }, { status: 400 });

  const db = getDb();
  const { start, end } = bangkokDayRange(date);

  // 该员工当天的系统操作（排除考勤/请假/日报本身这类非业务动作）
  const logs = db.prepare(
    `SELECT action, target_type, target_id, detail FROM audit_logs
     WHERE actor = ? AND created_at >= ? AND created_at < ?
       AND target_type NOT IN ('attendance', 'attendance_request', 'leave', 'work_report')
       AND action != '系统' AND action != ''
     ORDER BY created_at ASC, id ASC`
  ).all(auth.name, start, end) as { action: string; target_type: string; target_id: string; detail: string }[];

  const orderMap = new Map<string, { type: string; id: string; title: string; subtitle: string; href: string; responsible: string; businessType: string }>();
  const todoMap = new Map<string, { type: string; id: string; title: string; subtitle: string; href: string }>();
  const issueMap = new Map<string, { type: string; id: string; title: string; subtitle: string; href: string }>();
  const otherMap = new Map<string, { type: string; id: string; title: string; subtitle: string; href: string }>();

  for (const l of logs) {
    const tt = l.target_type;
    const tid = String(l.target_id || "");

    if (ORDER_TYPES.includes(tt)) {
      const oid = resolveOrderId(db, tt, tid);
      if (oid && !orderMap.has(oid)) {
        const order = db.prepare("SELECT customer_name, responsible_person, business_type_id FROM orders WHERE id = ?").get(oid) as { customer_name: string; responsible_person: string; business_type_id: number } | undefined;
        const biz = order ? db.prepare("SELECT name FROM business_types WHERE id = ?").get(order.business_type_id) as { name: string } | undefined : undefined;
        orderMap.set(oid, {
          type: "order", id: oid, title: `订单 ${oid}`,
          subtitle: order?.customer_name || "",
          href: `/orders/${oid}`,
          responsible: order?.responsible_person || "",
          businessType: biz?.name || "待分类",
        });
      }
    } else if (tt === "todo") {
      if (tid && !todoMap.has(tid)) {
        const todo = db.prepare("SELECT content, status FROM todos WHERE id = ?").get(Number(tid)) as { content: string; status: string } | undefined;
        todoMap.set(tid, { type: "todo", id: tid, title: todo?.content || `待办 ${tid}`, subtitle: todo?.status || "", href: `/todos?todo=${tid}` });
      }
    } else if (tt === "issue") {
      if (tid && !issueMap.has(tid)) {
        const issue = db.prepare("SELECT description, status FROM issue_tickets WHERE id = ?").get(Number(tid)) as { description: string; status: string } | undefined;
        issueMap.set(tid, { type: "issue", id: tid, title: issue?.description || `工单 ${tid}`, subtitle: issue?.status || "", href: `/issues?open=${tid}` });
      }
    } else {
      const sentence = toSentence(l.action, tid);
      const key = `${tt}|${tid}|${l.action}`;
      if (sentence && key && !otherMap.has(key)) {
        otherMap.set(key, { type: "other", id: tid, title: sentence, subtitle: l.detail || "", href: otherHref(tt, tid) });
      }
    }
  }

  // 当天提交的会议心得 → 归入「其他」带出一条
  const meetingRows = db.prepare(
    `SELECT m.id, m.title
     FROM meeting_reflections r
     JOIN meetings m ON m.id = r.meeting_id
     WHERE r.employee_name = ? AND r.created_at >= ? AND r.created_at < ?
     GROUP BY m.id
     ORDER BY MIN(r.created_at) ASC`
  ).all(auth.name, start, end) as { id: number; title: string }[];
  for (const m of meetingRows) {
    const title = `参加了 ${m.title} 这场会议 并提交了会议心得`;
    const key = `meeting|${m.id}`;
    if (!otherMap.has(key)) {
      otherMap.set(key, { type: "other", id: String(m.id), title, subtitle: "", href: "/meetings" });
    }
  }

  const groups = [
    { type: "order", label: "订单", items: [...orderMap.values()] },
    { type: "todo", label: "待办", items: [...todoMap.values()] },
    { type: "issue", label: "工单", items: [...issueMap.values()] },
    { type: "other", label: "其他", items: [...otherMap.values()] },
  ];

  // 前一天的明日计划，给员工对照「昨天计划的今天做了没」
  const prevDate = dateMinusOne(date);
  const prev = db.prepare("SELECT tomorrow_plan FROM work_reports WHERE employee_name = ? AND report_date = ?").get(auth.name, prevDate) as { tomorrow_plan: string } | undefined;
  const prev_plan = prev?.tomorrow_plan || "";

  return NextResponse.json({ prev_plan, groups });
}
