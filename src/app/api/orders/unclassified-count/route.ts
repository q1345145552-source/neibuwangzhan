import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** 侧栏「待分类（待领取）」角标：还没人认领（负责人为空）、没办完也没取消的待分类单数（2026-10-15） */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth) || auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const row = getDb().prepare(`
    SELECT COUNT(*) AS c FROM orders o JOIN business_types b ON b.id = o.business_type_id
    WHERE (b.name = '待分类' OR o.sub_service_type = 'storefront-unclassified')
      AND o.status NOT IN ('已完成','客户取消') AND trim(COALESCE(o.responsible_person,'')) = ''`).get() as { c: number };
  return NextResponse.json({ count: row.c });
}
