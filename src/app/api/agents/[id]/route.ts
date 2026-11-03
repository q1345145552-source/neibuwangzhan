import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";
import { AGENT_UPDATE_FAILED, requireAdmin } from "@/lib/agents";
import { StorefrontPushError, updateStorefrontAgent, type StorefrontAgent } from "@/lib/storefront-push";

// PATCH /api/agents/:id：停用、启用、重置密码、改名字。先调业务系统，成功才改内部
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await readJson(req);
  const patch: { status?: string; password?: string; name?: string } = {};
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") return NextResponse.json({ error: "状态不对" }, { status: 400 });
    patch.status = body.status;
  }
  if (body.password !== undefined) {
    if (typeof body.password !== "string" || body.password.length < 6 || body.password.length > 72) return NextResponse.json({ error: "密码要 6～72 位" }, { status: 400 });
    patch.password = body.password;
  }
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 50) return NextResponse.json({ error: "名字必填，最长 50 个字" }, { status: 400 });
    patch.name = name;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "没有要改的内容" }, { status: 400 });
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM agents WHERE account_id = ?").get(id)) return NextResponse.json({ error: "代理账号不存在" }, { status: 404 });

  let updated: StorefrontAgent;
  try {
    updated = await updateStorefrontAgent(id, patch);
  } catch (error) {
    if (error instanceof StorefrontPushError && error.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: AGENT_UPDATE_FAILED }, { status: error instanceof StorefrontPushError && error.status === 404 ? 404 : 502 });
  }
  if (updated?.id !== id || typeof updated.name !== "string" || typeof updated.login !== "string" || !["active", "disabled"].includes(updated.status)) {
    return NextResponse.json({ error: AGENT_UPDATE_FAILED }, { status: 502 });
  }
  db.prepare("UPDATE agents SET name = ?, login = ?, status = ? WHERE account_id = ?").run(updated.name, updated.login, updated.status, id);
  const done = [patch.status === "disabled" ? "停用" : patch.status === "active" ? "启用" : "", patch.password ? "重置密码" : "", patch.name ? "改名字" : ""].filter(Boolean).join("、");
  logOperation(auth.name, "改代理账号", "agent", id, done);
  return NextResponse.json({ agent: { account_id: id, name: updated.name, login: updated.login, status: updated.status } });
}
