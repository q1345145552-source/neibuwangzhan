import { NextRequest } from "next/server";
import { commerceResponse } from "@/lib/commerce-api";
import { salePage } from "@/lib/commerce-pages";
export async function GET(req:NextRequest) {
  return commerceResponse(req,["client","admin","employee"],(actor,db)=>salePage(db,actor,req.nextUrl.searchParams));
}
