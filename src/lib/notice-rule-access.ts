import { NextResponse } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import { getDb } from "@/lib/db";

export interface EmployeeNotice {
  id: number; title: string; body: string; type: string; published_at: string;
  employee_name: string; printed: number; printed_at: string | null;
  submitted_at: string | null; review_status: string;
}

/** 落实、打印、PDF 都只能操作本人接收的记录，不接受请求指定员工。 */
export function ownEmployeeNotice(auth: TokenPayload, rawId: string) {
  if (auth.role !== "employee") return { error: NextResponse.json({ error: "仅接收通知的员工可操作" }, { status: 403 }) };
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: NextResponse.json({ error: "无效的通知编号" }, { status: 400 }) };
  const notice = getDb().prepare(`SELECT n.id, n.title, n.body, n.type, n.published_at,
    r.employee_name, r.printed, r.printed_at, r.submitted_at, r.review_status
    FROM notice_rules n JOIN notice_rule_implementations r ON r.notice_id=n.id
    WHERE n.id=? AND r.employee_id=?`).get(id, auth.id) as EmployeeNotice | undefined;
  if (!notice) return { error: NextResponse.json({ error: "通知不存在或未发送给你" }, { status: 404 }) };
  return { notice };
}
