import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { confirmPayment } from "@/lib/commerce";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return commerceResponse(req,["admin"],async (actor,db) => confirmPayment(db,actor,(await params).id,await commerceJson(req)));
}

