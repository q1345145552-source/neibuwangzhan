import type Database from "better-sqlite3";

/**
 * 客户在业务系统的账号 ↔ 客户群名（2026-10-28 老板：「直接在内部系统创建业务系统的客户端账号，
 * 然后直接在内部系统新建订单挂到那个客户端名下。登陆名，客户群名（内部系统才能看见），密码」）。
 * 客户群名只存在内部，业务系统不知道，客户看不到；一个群名只对一个账号，免得建单挂错人。
 * 建单时订单上的客户名称就是客户群名，客户管理里没有就跟订单一起录进去（成交、客户状态照原来按名字算）。
 */
export type LinkedAccount = { account_id: string; group_name: string; login: string };

export class GroupNameError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const MAX_GROUP = 100;

/** 去掉前后空格、中间连续空格并成一个、去掉看不见的字符 */
export function cleanGroupName(raw: unknown): string {
  return String(raw ?? "").replace(/[\u0000-\u001f\u007f​-‍⁠﻿]/g, " ").replace(/\s+/g, " ").trim();
}

export function checkGroupName(raw: unknown): string {
  const name = cleanGroupName(raw);
  if (!name) throw new GroupNameError("请填客户群名");
  if (name.length > MAX_GROUP) throw new GroupNameError(`客户群名最多 ${MAX_GROUP} 个字`);
  return name;
}

export function linkedAccount(db: Database.Database, accountId: string): LinkedAccount | null {
  return (db.prepare("SELECT account_id, group_name, login FROM storefront_accounts WHERE account_id = ?").get(accountId) as LinkedAccount | undefined) ?? null;
}

/** 这个群名是不是已经给了别的账号（不分大小写） */
export function groupNameTaken(db: Database.Database, groupName: string, exceptAccountId = ""): LinkedAccount | null {
  return (db.prepare("SELECT account_id, group_name, login FROM storefront_accounts WHERE lower(group_name) = lower(?) AND account_id <> ?")
    .get(groupName, exceptAccountId) as LinkedAccount | undefined) ?? null;
}

/** 记下账号的客户群名；已经有群名的账号不改（建单时只补没有群名的老账号） */
export function rememberGroupName(db: Database.Database, account: { account_id: string; group_name: string; login: string }, actor: string): LinkedAccount {
  const existing = linkedAccount(db, account.account_id);
  if (existing) return existing;
  const taken = groupNameTaken(db, account.group_name, account.account_id);
  if (taken) throw new GroupNameError(`客户群名「${taken.group_name}」已经给了账号 ${taken.login || taken.account_id}，换一个名字，或者直接选那个账号`, 409);
  db.prepare("INSERT INTO storefront_accounts (account_id, group_name, login, created_by) VALUES (?, ?, ?, ?)")
    .run(account.account_id, account.group_name, account.login, actor);
  return { account_id: account.account_id, group_name: account.group_name, login: account.login };
}

/** 按客户群名或登录名在内部找（业务系统那边不知道群名，搜群名只能在这里搜）；recent：没输字时列最近的 */
export function searchLinkedAccounts(db: Database.Database, q: string, recent = false): LinkedAccount[] {
  const term = q.trim().slice(0, 50);
  if (!term) return recent ? db.prepare("SELECT account_id, group_name, login FROM storefront_accounts ORDER BY created_at DESC LIMIT 20").all() as LinkedAccount[] : [];
  const like = `%${term.replace(/[\\%_]/g, c => "\\" + c)}%`;
  return db.prepare("SELECT account_id, group_name, login FROM storefront_accounts WHERE group_name LIKE ? ESCAPE '\\' OR login LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 20")
    .all(like, like) as LinkedAccount[];
}

/** 一批账号的客户群名 */
export function groupNamesOf(db: Database.Database, accountIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!accountIds.length) return map;
  const rows = db.prepare(`SELECT account_id, group_name FROM storefront_accounts WHERE account_id IN (${accountIds.map(() => "?").join(",")})`).all(...accountIds) as { account_id: string; group_name: string }[];
  for (const r of rows) map.set(r.account_id, r.group_name);
  return map;
}
