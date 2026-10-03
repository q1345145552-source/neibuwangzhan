import type { NextRequest } from "next/server";
import { commerceResponse } from "@/lib/commerce-api";
import { readImportedCatalog } from "@/lib/commerce-imported-catalog";
export async function GET(req:NextRequest) {
  return commerceResponse(req,["client","admin","employee"],(actor,db)=>readImportedCatalog(db,actor));
}
