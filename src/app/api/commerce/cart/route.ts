import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { readCart, saveCart } from "@/lib/commerce";
export async function GET(req: NextRequest) {
  return commerceResponse(req,["client"],(actor,db) => readCart(db,actor));
}
export async function PUT(req: NextRequest) {
  return commerceResponse(req,["client"],async (actor,db) => saveCart(db,actor,await commerceJson(req)));
}
