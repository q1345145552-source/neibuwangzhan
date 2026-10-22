export const HEIC_TYPES = ["image/heic", "image/heif"];
export const SCREENSHOT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", ...HEIC_TYPES];
export const SCREENSHOT_ACCEPT = SCREENSHOT_TYPES.join(",") + ",.heic,.heif";
export const UPLOAD_MAX_SIZE = 10 * 1024 * 1024;

/** HEIF 的 ftyp 主品牌或兼容品牌；不按文件名信任文件内容。 */
export function hasHeicSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 16 || String.fromCharCode(...bytes.subarray(4, 8)) !== "ftyp") return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < 16) return false;
  const brands = [8];
  for (let i = 16; i + 4 <= Math.min(size, bytes.length); i += 4) brands.push(i);
  return brands.some(offset => ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(String.fromCharCode(...bytes.subarray(offset, offset + 4))));
}

/** 仅在用户选择 HEIC 时下载解码器，浏览器内转为可预览的 JPG 再上传。 */
export async function prepareShopScreenshot(file: File): Promise<File> {
  if (file.size > UPLOAD_MAX_SIZE) throw new Error("文件不能超过 10MB");
  const regular = SCREENSHOT_TYPES.slice(0, 4);
  if (regular.includes(file.type)) {
    // 有些手机已转换图片内容，但仍保留 .HEIC 文件名。
    if (/\.hei[cf]$/i.test(file.name)) {
      const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
      const extension = extensions[file.type];
      return new File([file], file.name.replace(/\.hei[cf]$/i, "." + extension), { type: file.type, lastModified: file.lastModified });
    }
    return file;
  }
  if (!HEIC_TYPES.includes(file.type) && !/\.hei[cf]$/i.test(file.name)) throw new Error("请上传 JPG、PNG、WebP、GIF 或 HEIC 图片截图");
  if (!hasHeicSignature(new Uint8Array(await file.slice(0, 128).arrayBuffer()))) throw new Error("文件内容与类型不匹配");
  let converted: Blob;
  try {
    const { heicTo } = await import("heic-to/csp");
    converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.85 });
  } catch {
    throw new Error("HEIC 图片转换失败，请重新选择照片或改用 JPG 图片");
  }
  if (!converted.size) throw new Error("HEIC 图片转换失败，请重试");
  if (converted.size > UPLOAD_MAX_SIZE) throw new Error("转换后的图片超过 10MB，请缩小后上传");
  return new File([converted], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
}
