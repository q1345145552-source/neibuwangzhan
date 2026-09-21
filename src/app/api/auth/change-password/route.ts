import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

import { validatePassword } from "@/lib/password-policy";

/**
 * POST /api/auth/change-password
 * body: { current_password, new_password }
 *
 * 系统原本没有任何修改密码的入口，导致 12 个账号至今全是初始密码 123456。
 * 这个接口配合 employees.must_change_password 使用：
 * 还在用初始密码的账号登录后会被要求先改密码。
 */
export async function POST(req: NextRequest) {
  // 必须改密的受限凭证只能通过这个入口使用，其他业务接口仍由 verifyAuth 拦截。
  const auth = await verifyAuth(req, { allowPasswordChangeRequired: true });
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { current_password, new_password } = await readJson(req);
  if (!current_password) return NextResponse.json({ error: "请输入当前密码" }, { status: 400 });

  const err = validatePassword(new_password, current_password);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const db = getDb();
  const user = db
    .prepare("SELECT id, password FROM employees WHERE id = ?")
    .get(auth.id) as { id: number; password: string } | undefined;
  if (!user) return NextResponse.json({ error: "账号不存在" }, { status: 404 });

  // 必须验证当前密码：否则拿到 token 就能直接改密码锁死账号
  const valid = await bcrypt.compare(current_password, user.password);
  if (!valid) return NextResponse.json({ error: "当前密码不正确" }, { status: 401 });

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare(
    "UPDATE employees SET password = ?, must_change_password = 0, auth_version = auth_version + 1 WHERE id = ?"
  ).run(hash, user.id);

  // 只记录"改过密码"这件事，不记录任何密码内容
  logOperation(auth.name, "修改密码", "employee", String(user.id));

  return NextResponse.json({ success: true });
}
