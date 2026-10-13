import crypto from "crypto";

// 资产敏感字段加密：AES-256-GCM，密钥来自环境变量 ASSET_SECRET。
// 密钥没配置时（现在就是留空的）：加密/解密都原样返回明文，不报错不崩，
// 等后面在 .env 里填上 ASSET_SECRET 后，新录入的字段会自动走加密。

const ALGO = "aes-256-gcm";
const PREFIX = "enc:";

// 从任意长度的 ASSET_SECRET 派生稳定的 32 字节密钥
function getKey(): Buffer | null {
  const secret = process.env.ASSET_SECRET;
  if (!secret) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

/** 加密敏感字段；密钥未配置时返回原文 */
export function encryptAssetSecret(plain: string): string {
  if (!plain) return "";
  const key = getKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** 解密敏感字段；密钥未配置或值不是加密格式时返回原文 */
export function decryptAssetSecret(stored: string): string {
  if (!stored) return "";
  const key = getKey();
  if (!key) return stored;
  if (!stored.startsWith(PREFIX)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return stored;
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const enc = Buffer.from(parts[2], "base64");
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return stored;
  }
}
