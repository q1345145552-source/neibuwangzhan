import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";
import { createStorefrontCustomer, customerLoginLink, searchStorefrontCustomers, StorefrontPushError } from "@/lib/storefront-push";

// 线下单推到业务系统时找/建客户在业务系统的账号（2026-10-22 老板选 B）：只给管理员

function failure(error: unknown, what: string) {
  if (error instanceof StorefrontPushError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[storefront/customers] ${what}:`, error);
  return NextResponse.json({ error: `${what}，请稍后再试` }, { status: 500 });
}

// GET /api/storefront/customers?q= — 按名字、手机号、邮箱找客户账号
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能推单" }, { status: 403 });
  try {
    return NextResponse.json({ customers: await searchStorefrontCustomers(new URL(req.url).searchParams.get("q") || "") });
  } catch (error) { return failure(error, "查客户账号失败"); }
}

// POST /api/storefront/customers — 替客户建账号（名字、手机号或邮箱、初始密码）；推单弹框和订单管理页「开客户账号」共用（2026-10-26 老板选 A：没有订单也能开）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "只有管理员能建客户账号" }, { status: 403 });
  try {
    const account = await createStorefrontCustomer(await readJson(req));
    logOperation(auth.name, "替客户建业务系统账号", "storefront_account", account.id, `${account.name} ${account.phone || account.email}`);
    return NextResponse.json({ ...account, login_url: customerLoginLink() }, { status: 201 });
  } catch (error) { return failure(error, "建客户账号失败"); }
}
