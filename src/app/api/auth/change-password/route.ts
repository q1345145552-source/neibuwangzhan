import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

/** 弱密码黑名单：初始密码和几个最常见的选择 */
const WEAK = new Set([
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "password", "passw0rd", "abc123", "111111", "000000",
  "qwerty", "qwerty123", "admin", "admin123", "xiangtai", "xiangtai123",
]);

/** 密码强度规则。返回 null 表示通过，否则返回给用户看的中文提示。 */
export function validatePassword(pwd: unknown, current?: string): string | null {
  if (typeof pwd !== "string" || !pwd) return "请输入新密码";
  if (pwd.length < 8) return "新密码至少 8 位";
  const byteLength = new TextEncoder().encode(pwd).byteLength;
  if (byteLength > 72) return "新密码不能超过 72 字节（中文通常每个字占 3 字节）";
  if (WEAK.has(pwd.toLowerCase())) return "这个密码太常见了，换一个";
  // 纯数字或纯字母都太容易猜
  if (/^\d+$/.test(pwd)) return "新密码不能全是数字";
  if (/^[a-zA-Z]+$/.test(pwd)) return "新密码需要包含数字或符号";
  if (current && pwd === current) return "新密码不能和当前密码相同";
  return null;
}

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
