import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { listProducts, saveProduct } from "@/lib/commerce";
export async function GET(req: NextRequest) {
  return commerceResponse(req,["client","admin","employee"],(actor,db) => listProducts(db,actor));
}
export async function POST(req: NextRequest) {
  return commerceResponse(req,["admin"],async (actor,db) => saveProduct(db,actor,await commerceJson(req)),201);
}

