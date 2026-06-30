import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT id, name FROM business_types ORDER BY id").all();
  return NextResponse.json(rows);
}
