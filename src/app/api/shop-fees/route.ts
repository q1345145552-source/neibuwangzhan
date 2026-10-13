import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

const BUSINESS_TYPES = ["卖店铺", "外购店铺", "SIM卡", "邮箱", "扫描验证", "注册"] as string[];
const FEE_TYPES = ["收入", "支出"] as string[];
const CURRENCIES = ["CNY", "THB"] as string[];

// GET /api/shop-fees — 收付款列表
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare("SELECT * FROM shop_fees ORDER BY id DESC").all();
  return NextResponse.json(rows);
}

// POST /api/shop-fees — 录入收入或支出（截图必填）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { fee_type, business_type, amount, currency, note, screenshot } = body;

  if (!FEE_TYPES.includes(String(fee_type))) return NextResponse.json({ error: "请选择收入或支出" }, { status: 400 });
  if (!BUSINESS_TYPES.includes(String(business_type))) return NextResponse.json({ error: "请选择业务类型" }, { status: 400 });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) return NextResponse.json({ error: "请填写有效金额" }, { status: 400 });
  if (!CURRENCIES.includes(String(currency))) return NextResponse.json({ error: "请选择币种" }, { status: 400 });
  if (!screenshot || !String(screenshot).trim()) return NextResponse.json({ error: "请上传截图" }, { status: 400 });

  // 收入默认待核对，支出默认待处理
  const status = fee_type === "收入" ? "待核对" : "待处理";

  const result = db.prepare(
    "INSERT INTO shop_fees (fee_type, business_type, amount, currency, note, screenshot, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(String(fee_type), String(business_type), amt, String(currency), String(note || "").trim(), String(screenshot).trim(), status, auth.name);

  logOperation(auth.name, "录入店铺收付款", "shop_fee", String(result.lastInsertRowid), `${fee_type} ${business_type} ${amt}${currency}`);
  return NextResponse.json(db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
