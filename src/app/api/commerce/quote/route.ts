import { NextRequest } from "next/server";
import { commerceJson, commerceResponse } from "@/lib/commerce-api";
import { quote } from "@/lib/commerce";
export async function POST(req: NextRequest) {
  return commerceResponse(req,["client"],async (_actor,db) => quote(db,await commerceJson(req)));
}

