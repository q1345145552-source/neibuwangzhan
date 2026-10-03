import { getClientCustomerNames, customerNameFilter } from "@/lib/client-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { isCommerceRefund } from "@/lib/commerce-ledger";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  let sql = "SELECT f.*, o.customer_name, o.business_type_id, bt.name AS business_name FROM finances f JOIN orders o ON f.order_id = o.id LEFT JOIN business_types bt ON o.business_type_id = bt.id";
  const conditions: string[] = [];
  const params: string[] = [];
  if (auth.role === "client") {
    const { names } = getClientCustomerNames(auth.id, auth.name);
    const scope = customerNameFilter(names);
    conditions.push(scope.clause);
    params.push(...scope.params);
  }
  if (type) { conditions.push("f.type = ?"); params.push(type); }
  if (status) { conditions.push("f.status = ?"); params.push(status); }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY f.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return NextResponse.json((rows as { id: number }[]).map(row => ({ ...row, commerce_refund: isCommerceRefund(db, row.id) })));
}
