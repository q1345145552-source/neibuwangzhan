import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const factory = db.prepare("SELECT * FROM factories WHERE id = ?").get(id);
  if (!factory) return NextResponse.json({ error: "工厂不存在" }, { status: 404 });
  
  const influencers = db.prepare(
    "SELECT inf.*, i.name AS influencer_name, i.tiktok_link, i.status AS influencer_status FROM influencer_factories inf JOIN influencers i ON inf.influencer_id = i.id WHERE inf.factory_id = ? ORDER BY inf.created_at DESC"
  ).all(id);
  
  return NextResponse.json({ ...factory, influencers });
}
