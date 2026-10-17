import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownEmployeeNotice } from "@/lib/notice-rule-access";
import { NOTICE_COMPANY_NAME } from "@/lib/notice-rule-print";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const result = ownEmployeeNotice(auth, (await params).id);
  if (result.error) return result.error;
  // 用户打开打印页即记下打印操作，重复打开保留首次时间。
  getDb().prepare(`UPDATE notice_rule_implementations SET printed=1,
    printed_at=COALESCE(printed_at, datetime('now')), updated_at=datetime('now')
    WHERE notice_id=? AND employee_id=?`).run(result.notice.id, auth.id);
  return NextResponse.json({ ...result.notice, employee_name: auth.name, company_name: NOTICE_COMPANY_NAME }, { headers: { "Cache-Control": "no-store" } });
}
