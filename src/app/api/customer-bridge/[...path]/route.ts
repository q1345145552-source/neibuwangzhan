import { NextRequest } from "next/server";
import { customerBridgeRequest } from "@/lib/customer-bridge-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{path:string[]}>};
async function handle(req:NextRequest,ctx:Context){return customerBridgeRequest(req,(await ctx.params).path);}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
