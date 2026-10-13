import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { decryptAssetSecret } from "@/lib/asset-crypto";

function decryptRow(r: any): any {
  return {
    ...r,
    account: decryptAssetSecret(r.account),
    password: decryptAssetSecret(r.password),
    phone: decryptAssetSecret(r.phone),
    id_number: decryptAssetSecret(r.id_number),
    payment_account: decryptAssetSecret(r.payment_account),
  };
}

// GET /api/assets/[id] — 资产详情：敏感字段返回明文（仅老板 或 上传人本人可看）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as any;
  if (!row) return NextResponse.json({ error: "资产不存在" }, { status: 404 });

  // 只有老板，或上传这条资产的员工本人，能看明文
  if (auth.role !== "admin" && row.uploaded_by !== auth.name) {
    return NextResponse.json({ error: "无权查看该资产" }, { status: 403 });
  }

  return NextResponse.json(decryptRow(row));
}
