import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { activeAgents, agentErrorResponse, attachOrderAgent, orderAgentForStaff, orderRebateView, removeOrderRebate, requireAdmin, requireStaff, saveOrderRebate } from "@/lib/agents";

type Ctx = { params: Promise<{ id: string }> };

// GET：这张单挂了谁、返点多少，和能选的代理。员工只拿到代理名字和能选的代理
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireStaff(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id = ?").get(id)) return NextResponse.json({ error: "订单不存在" }, { status: 404 });
  if (auth.role !== "admin") return NextResponse.json({ attached: orderAgentForStaff(db, id), agents: activeAgents(db) });
  return NextResponse.json({ rebate: orderRebateView(db, id), agents: activeAgents(db) });
}

// POST：只挂代理不填返点（员工用），已经挂了就 409
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireStaff(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await readJson(req);
  const db = getDb();
  try {
    attachOrderAgent(db, id, body, auth.name || "");
  } catch (error) {
    return agentErrorResponse(error);
  }
  return NextResponse.json({ attached: orderAgentForStaff(db, id) });
}

// PUT：挂、换、改金额
export async function PUT(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await readJson(req);
  const db = getDb();
  try {
    saveOrderRebate(db, id, body, auth.name || "");
  } catch (error) {
    return agentErrorResponse(error);
  }
  return NextResponse.json({ rebate: orderRebateView(db, id) });
}

// DELETE：解除
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const db = getDb();
  try {
    removeOrderRebate(db, id, auth.name || "");
  } catch (error) {
    return agentErrorResponse(error);
  }
  return NextResponse.json({ rebate: null });
}
