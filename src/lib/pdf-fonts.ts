import path from "path";
import { existsSync } from "fs";

/**
 * PDF 字体注册。
 *
 * pdfkit 内置的 Helvetica 只有拉丁字形，用它渲染泰文会输出空白/豆腐块——
 * 50ทวิ 证书整份表头都是泰文，等于这份要交给税局的文件不可用。
 * 这里嵌入 Sarabun（泰文 + 拉丁，Google Fonts，OFL 授权，约 160KB）。
 *
 * 中文：Sarabun 不含 CJK 字形，所以另外嵌入了 Noto Sans SC（约 10MB，OFL 授权）
 * 用于渲染中文公司名。缺这个文件时代码会自动降级（中文位置留空并在服务端日志告警），
 * 不会让整份 PDF 失败。
 *
 * ⚠️ 混排注意：两个字体互相没有对方的字形（Sarabun 无中文、NotoSansSC 无泰文），
 * 同一行里如果既有泰文标签又有中文内容，必须分两段渲染：
 *   doc.font(FONT_REGULAR).text("ชื่อบริษัท (Company):  ", { continued: true });
 *   doc.font(fontFor(name, fonts)).text(name);
 * 整行用同一个字体一定会丢掉另一种文字。
 *
 * 字体来源（如需更新）：
 *   npm pack @expo-google-fonts/noto-sans-sc
 *   tar xzf expo-google-fonts-noto-sans-sc-*.tgz package/400Regular/NotoSansSC_400Regular.ttf
 *   mv package/400Regular/NotoSansSC_400Regular.ttf public/fonts/NotoSansSC-Regular.ttf
 */

const FONT_DIR = path.join(process.cwd(), "public", "fonts");

export const FONT_REGULAR = "body";
export const FONT_BOLD = "body-bold";
export const FONT_CJK = "cjk";

export interface RegisteredFonts {
  /** 中文字体是否可用 */
  hasCjk: boolean;
}

/** 判断字符串是否含中日韩字符 */
export function hasCjkChars(s: string): boolean {
  return /[㐀-鿿豈-﫿぀-ヿ]/.test(s || "");
}

/**
 * 给一个 PDFDocument 注册字体。返回哪些字体可用。
 * 字体文件缺失时抛错——宁可让下载报 500，也好过静默产出一份全是方块的税务文件。
 */
export function registerPdfFonts(doc: PDFKit.PDFDocument): RegisteredFonts {
  const regular = path.join(FONT_DIR, "Sarabun-Regular.ttf");
  const bold = path.join(FONT_DIR, "Sarabun-Bold.ttf");

  if (!existsSync(regular) || !existsSync(bold)) {
    throw new Error(
      `缺少泰文字体文件：${regular} / ${bold}。请确认 public/fonts 下的 Sarabun 字体已随代码一起部署。`
    );
  }

  doc.registerFont(FONT_REGULAR, regular);
  doc.registerFont(FONT_BOLD, bold);

  const cjk = path.join(FONT_DIR, "NotoSansSC-Regular.ttf");
  const hasCjk = existsSync(cjk);
  if (hasCjk) doc.registerFont(FONT_CJK, cjk);

  return { hasCjk };
}

/** 按内容自动选字体：含中文且中文字体可用时用中文字体，否则用正文字体 */
export function fontFor(text: string, fonts: RegisteredFonts, bold = false): string {
  if (fonts.hasCjk && hasCjkChars(text)) return FONT_CJK;
  return bold ? FONT_BOLD : FONT_REGULAR;
}
