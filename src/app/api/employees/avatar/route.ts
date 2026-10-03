import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/employees/avatar — 员工上传/更换自己的头像（body: { avatar }）
// 任何人只能改自己的头像，管理员也不能在这里替别人改（替别人改走 /api/employees 的编辑入口）
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await readJson(req);
  const avatar = String(body?.avatar ?? "").trim();
  // 空串 = 移除头像；非空则只接受站内上传接口返回的地址，防止任意 URL 注入
  if (avatar && !avatar.startsWith("/api/files/")) return NextResponse.json({ error: "头像地址无效" }, { status: 400 });

  const db = getDb();
  db.prepare("UPDATE employees SET avatar = ? WHERE id = ?").run(avatar, auth.id);
  return NextResponse.json({ success: true, avatar });
}
