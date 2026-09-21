import { NextRequest } from "next/server";
import { commerceResponse } from "@/lib/commerce-api";
import { readSale } from "@/lib/commerce";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return commerceResponse(req,["client","admin","employee"],async (actor,db) => readSale(db,actor,(await params).id));
}

