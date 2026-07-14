import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(_req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const factory = db.prepare("SELECT * FROM factories WHERE id = ?").get(id);
  if (!factory) return NextResponse.json({ error: "工厂不存在" }, { status: 404 });
  
  const influencers = db.prepare(
    "SELECT inf.*, i.name AS influencer_name, i.tiktok_link, i.status AS influencer_status FROM influencer_factories inf JOIN influencers i ON inf.influencer_id = i.id WHERE inf.factory_id = ? ORDER BY inf.created_at DESC"
  ).all(id);
  
  return NextResponse.json({ ...factory, influencers });
}
