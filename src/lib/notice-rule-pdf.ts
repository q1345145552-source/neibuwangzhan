import PDFDocument from "pdfkit";
import { registerPdfFonts, FONT_CJK, FONT_REGULAR } from "@/lib/pdf-fonts";
import type { EmployeeNotice } from "@/lib/notice-rule-access";
import { NOTICE_COMPANY_NAME, NOTICE_PRINT_INSTRUCTION } from "@/lib/notice-rule-print";
import { toThaiDate } from "@/lib/time";

export async function generateNoticeRulePdf(notice: EmployeeNotice): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: notice.title, Author: NOTICE_COMPANY_NAME } });
  const fonts = registerPdfFonts(doc);
  if (!fonts.hasCjk) throw new Error("缺少中文 PDF 字体");
  const chunks: Buffer[] = [];
  const ready = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", chunk => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 108;
  // 按显式换行和词边界排版；不用 continued 跨字体续写，避免 PDFKit 吞掉换行。
  const words = new Intl.Segmenter("th", { granularity: "word" });
  const graphemes = new Intl.Segmenter("th", { granularity: "grapheme" });
  const runs = (text: string) => text.split(/([\u0e00-\u0e7f]+)/).filter(Boolean);
  const font = (text: string) => /[\u0e00-\u0e7f]/.test(text) ? FONT_REGULAR : FONT_CJK;
  function paragraph(text: string, size: number, align: "left" | "center" = "left", bold = false) {
    doc.fontSize(size).fillColor("#111827").strokeColor("#111827").lineWidth(bold ? 0.22 : 0);
    const lineHeight = Math.max(doc.font(FONT_CJK).currentLineHeight(true), doc.font(FONT_REGULAR).currentLineHeight(true)) + 5;
    const measure = (value: string) => runs(value).reduce((total, run) => total + doc.font(font(run)).widthOfString(run), 0);
    function draw(line: string) {
      if (doc.y + lineHeight > doc.page.height - 54) doc.addPage();
      const y = doc.y;
      let x = 54 + (align === "center" ? (width - measure(line)) / 2 : 0);
      for (const run of runs(line)) {
        doc.font(font(run)).text(run, x, y, { lineBreak: false, ...(bold ? { stroke: true, fill: true } : {}) });
        x += doc.widthOfString(run);
      }
      doc.x = 54;
      doc.y = y + lineHeight;
    }
    for (const explicitLine of text.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "";
      for (const { segment } of words.segment(explicitLine)) {
        if (measure(line + segment) <= width) { line += segment; continue; }
        if (line) { draw(line); line = ""; }
        // 超长网址/连续文字也必须在 A4 页内换行。
        for (const { segment: character } of graphemes.segment(segment)) {
          if (line && measure(line + character) > width) { draw(line); line = ""; }
          line += character;
        }
      }
      draw(line);
    }
  }
  function rule() {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.moveDown(0.6);
    doc.strokeColor("#9ca3af").lineWidth(0.6).moveTo(54, doc.y).lineTo(doc.page.width - 54, doc.y).stroke();
    doc.y += 16;
  }
  paragraph(NOTICE_COMPANY_NAME, 24, "center", true);
  doc.moveDown(0.6);
  paragraph(notice.title, 20, "center", true);
  doc.moveDown(0.5);
  paragraph(`【${notice.type}】    发布日期：${toThaiDate(notice.published_at)}`, 10);
  rule();
  paragraph(notice.body, 12);
  // 分隔线、姓名和说明作为一个收尾区块，避免末页只剩姓名而分隔线留在前页。
  if (doc.y + 115 > doc.page.height - 54) doc.addPage();
  rule();
  paragraph(`送达员工：${notice.employee_name}`, 12);
  doc.moveDown(0.7);
  paragraph(NOTICE_PRINT_INSTRUCTION, 9);
  doc.end();
  return ready;
}
