import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { encryptAssetSecret, decryptAssetSecret } from "@/lib/asset-crypto";
import { syncAssetExpiryReminders } from "@/lib/asset-sync";

export const ASSET_TYPES = ["账号密码", "套餐会员", "邮箱", "设备", "证件执照", "身份证", "域名", "客户委托账号", "SIM卡手机号"] as string[];
const OWNERSHIPS = ["公司自有", "客户委托"] as string[];

// GET /api/assets?type=&q= — 老板看全部资产；员工只看自己上传的（敏感字段列表里不返回明文）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = (searchParams.get("type") || "").trim();
  const q = (searchParams.get("q") || "").trim().toLowerCase();

  const db = getDb();
  const isAdmin = auth.role === "admin";

  // 顺带触发资产到期提醒同步：7 天内到期的资产给老板发通知
  try { syncAssetExpiryReminders(); } catch {}
  let rows = (isAdmin
    ? db.prepare("SELECT * FROM assets ORDER BY id DESC").all()
    : db.prepare("SELECT * FROM assets WHERE uploaded_by = ? ORDER BY id DESC").all(auth.name)) as any[];

  // 分类筛选
  if (type) rows = rows.filter((r) => r.asset_type === type);
  // 搜索：按名称 + 账号（账号加密，服务端解密后匹配，不回传明文）
  if (q) {
    rows = rows.filter((r) => {
      const name = String(r.name || "").toLowerCase();
      const account = decryptAssetSecret(r.account).toLowerCase();
      return name.includes(q) || account.includes(q);
    });
  }

  // 列表接口不下发明文敏感字段
  const list = rows.map((r) => ({ ...r, account: "", password: "", phone: "", id_number: "", payment_account: "" }));
  return NextResponse.json(list);
}

// POST /api/assets — 录入资产（敏感字段自动加密）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const {
    asset_type, asset_subtype, name, account, password, phone, id_number, payment_account,
    url, ownership, customer_name, expiry_date,
    device_type, brand_model, serial_number, device_owner, device_status, remark,
  } = body;

  if (!asset_type || !ASSET_TYPES.includes(String(asset_type))) {
    return NextResponse.json({ error: "请选择资产类型" }, { status: 400 });
  }
  const ownershipVal = String(ownership || "公司自有").trim();
  if (!OWNERSHIPS.includes(ownershipVal as any)) {
    return NextResponse.json({ error: "归属只能是公司自有或客户委托" }, { status: 400 });
  }
  const customerVal = String(customer_name || "").trim();
  if (ownershipVal === "客户委托" && !customerVal) {
    return NextResponse.json({ error: "客户委托需要选择客户" }, { status: 400 });
  }

  const result = db.prepare(
    `INSERT INTO assets (asset_type, asset_subtype, name, account, password, phone, id_number, payment_account,
      url, ownership, customer_name, expiry_date, device_type, brand_model, serial_number, device_owner, device_status, remark, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(asset_type),
    String(asset_subtype || "").trim(),
    String(name || "").trim(),
    encryptAssetSecret(String(account || "").trim()),
    encryptAssetSecret(String(password || "").trim()),
    encryptAssetSecret(String(phone || "").trim()),
    encryptAssetSecret(String(id_number || "").trim()),
    encryptAssetSecret(String(payment_account || "").trim()),
    String(url || "").trim(),
    ownershipVal,
    customerVal,
    String(expiry_date || "").trim(),
    String(device_type || "").trim(),
    String(brand_model || "").trim(),
    String(serial_number || "").trim(),
    String(device_owner || "").trim(),
    String(device_status || "").trim(),
    String(remark || "").trim(),
    auth.name
  );

  logOperation(auth.name, "录入资产", "asset", String(result.lastInsertRowid), String(name || asset_type));
  return NextResponse.json(db.prepare("SELECT * FROM assets WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
