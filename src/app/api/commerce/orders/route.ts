import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { checkout, listSales } from "@/lib/commerce";
export async function GET(req: NextRequest) {
  return commerceResponse(req,["client","admin","employee"],(actor,db) => listSales(db,actor));
}
export async function POST(req: NextRequest) {
  return commerceResponse(req,["client"],async (actor,db) => checkout(db,actor,await commerceJson(req)),201);
}

