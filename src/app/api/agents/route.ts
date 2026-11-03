import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";
import { AGENT_CREATE_FAILED, agentLoginTaken, isPlaceholderLogin, listAgents, requireAdmin } from "@/lib/agents";
import { createStorefrontAgent, StorefrontPushError, type StorefrontAgent } from "@/lib/storefront-push";

// GET /api/agents：所有代理和各自的合计
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ agents: listAgents(getDb()) });
}

// POST /api/agents：开代理账号。账号和密码建在业务系统，成功了内部才记（不存密码）
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await readJson(req);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const login = typeof body.login === "string" ? body.login.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!name || name.length > 50) return NextResponse.json({ error: "名字必填，最长 50 个字" }, { status: 400 });
  if (!login || login.length > 254) return NextResponse.json({ error: "请填登录名" }, { status: 400 });
  if (password.length < 6 || password.length > 72) return NextResponse.json({ error: "密码要 6～72 位" }, { status: 400 });
  if (isPlaceholderLogin(login)) return NextResponse.json({ error: "这个登录名不能用，换一个" }, { status: 400 });
  const db = getDb();
  if (agentLoginTaken(db, login)) return NextResponse.json({ error: "这个登录名已被占用，换一个" }, { status: 409 });

  let created: StorefrontAgent;
  try {
    created = await createStorefrontAgent({ login, name, password });
  } catch (error) {
    if (error instanceof StorefrontPushError && (error.status === 400 || error.status === 409)) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: AGENT_CREATE_FAILED }, { status: 502 });
  }
  if (typeof created?.id !== "string" || !created.id || created.id.length > 64 || typeof created.name !== "string" || typeof created.login !== "string" || !["active", "disabled"].includes(created.status)) {
    return NextResponse.json({ error: AGENT_CREATE_FAILED }, { status: 502 });
  }
  // 上次超时后重试：业务系统认回同一个账号，这里也按同一个 id 记
  db.prepare(`INSERT INTO agents (account_id, name, login, status, created_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET name = excluded.name, login = excluded.login, status = excluded.status`)
    .run(created.id, created.name, created.login, created.status, auth.name || "");
  logOperation(auth.name, "开代理账号", "agent", created.id, `名字:${created.name}`);
  return NextResponse.json({ agent: { account_id: created.id, name: created.name, login: created.login, status: created.status } });
}
