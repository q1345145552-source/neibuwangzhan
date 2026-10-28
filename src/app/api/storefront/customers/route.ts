import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb, logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";
import { accountLogin, createStorefrontCustomer, customerLoginLink, searchStorefrontCustomers, StorefrontPushError, type StorefrontAccount } from "@/lib/storefront-push";
import { checkGroupName, groupNamesOf, groupNameTaken, GroupNameError, rememberGroupName, searchLinkedAccounts } from "@/lib/storefront-accounts";

// 客户在业务系统的账号：找、开（2026-10-28 老板：内部直接开账号——登录名、密码、客户群名；建单直接挂到账号下）。员工都能用。

function failure(error: unknown, what: string) {
  if (error instanceof StorefrontPushError || error instanceof GroupNameError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[storefront/customers] ${what}:`, error);
  return NextResponse.json({ error: `${what}，请稍后再试` }, { status: 500 });
}

// GET /api/storefront/customers?q= — 按客户群名、登录名、名字、手机号、邮箱找客户账号（群名只在内部，带在结果里）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const q = new URL(req.url).searchParams.get("q") || "";
  try {
    const db = getDb();
    // 业务系统连不上也别让员工建不了单：照样列出内部记过群名的账号（建单时推不过去，订单照样建好，之后在订单页再推）
    let remote: StorefrontAccount[] = [];
    let warning = "";
    try { remote = await searchStorefrontCustomers(q); }
    catch (error) {
      if (!(error instanceof StorefrontPushError)) throw error;
      warning = `${error.message}。下面只列内部记过客户群名的账号，现在开不了新账号`;
    }
    const seen = new Set(remote.map(a => a.id));
    // 群名搜到、业务系统按名字手机号没搜到的账号，用内部记的登录名补上（业务系统停用的账号推单时会报出来）
    const local: StorefrontAccount[] = searchLinkedAccounts(db, q, !!warning).filter(l => !seen.has(l.account_id))
      .map(l => ({ id: l.account_id, name: "", phone: "", email: l.login }));
    const all = [...local, ...remote];
    const groups = groupNamesOf(db, all.map(a => a.id));
    return NextResponse.json({ customers: all.map(a => ({ ...a, group_name: groups.get(a.id) || "" })), ...(warning ? { warning } : {}) });
  } catch (error) { return failure(error, "查客户账号失败"); }
}

// POST /api/storefront/customers — 替客户开业务系统账号：{ login（手机号、邮箱或登录名）, password, group_name（客户群名，只有内部看得到）}
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  try {
    const body = await readJson(req);
    const db = getDb();
    const login = String(body.login ?? "").trim();
    if (!login) throw new StorefrontPushError("请填登录名");
    const groupName = checkGroupName(body.group_name);
    // 群名先查：别等业务系统开好了账号才发现群名重了
    const taken = groupNameTaken(db, groupName);
    if (taken) throw new GroupNameError(`客户群名「${taken.group_name}」已经有账号了（登录名 ${taken.login || "-"}），直接选那个账号，或者换个群名`, 409);
    const account = await createStorefrontCustomer({ login, password: body.password });
    const saveLogin = accountLogin(account);
    // 业务系统那边账号已经开好了：群名这一步出问题（同时有人用了同一个群名）也要把账号交回去，不然初始密码就丢了
    let saved = groupName, groupWarning = "";
    try { rememberGroupName(db, { account_id: account.id, group_name: groupName, login: saveLogin }, auth.name || ""); }
    catch (error) {
      if (!(error instanceof GroupNameError)) throw error;
      saved = ""; groupWarning = `账号开好了，但客户群名「${groupName}」刚被别的账号用了，没记上。建单时选这个账号，再补一个群名`;
    }
    logOperation(auth.name, "替客户建业务系统账号", "storefront_account", account.id, `客户群名 ${saved || "（没记上）"}，登录名 ${saveLogin}`);
    return NextResponse.json({ ...account, login: saveLogin, group_name: saved, ...(groupWarning ? { group_warning: groupWarning } : {}), login_url: customerLoginLink() }, { status: 201 });
  } catch (error) { return failure(error, "开客户账号失败"); }
}
