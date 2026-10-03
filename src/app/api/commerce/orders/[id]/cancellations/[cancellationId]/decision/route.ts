import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { decideCancellation } from "@/lib/commerce-aftercare";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string; cancellationId:string}>}) {
  return commerceResponse(req,["admin"],async(actor,db)=>{
    const route=await params;
    return decideCancellation(db,actor,route.id, route.cancellationId,await commerceJson(req));
  },201);
}
