import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { adjustBill } from "@/lib/commerce-aftercare";
export async function POST(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
  return commerceResponse(req,["admin"],async(actor,db)=>{
    const route=await params;
    return adjustBill(db,actor,route.id,await commerceJson(req));
  },201);
}
