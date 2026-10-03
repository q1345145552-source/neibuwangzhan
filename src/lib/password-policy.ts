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

