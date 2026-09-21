import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { requestCancellation } from "@/lib/commerce-aftercare";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  return commerceResponse(req,["client"],async(actor,db)=>{
    const route=await params;
    return requestCancellation(db,actor,route.id,await commerceJson(req));
  },201);
}
