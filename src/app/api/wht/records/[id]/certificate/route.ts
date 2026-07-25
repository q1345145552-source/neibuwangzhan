import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import PDFDocument from "pdfkit";
import { registerPdfFonts, fontFor, hasCjkChars, FONT_REGULAR, FONT_BOLD } from "@/lib/pdf-fonts";
import { bangkokToday } from "@/lib/time";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const record = db.prepare(`
    SELECT r.*, c.company_name, c.tax_id, c.contact
    FROM wht_records r
    JOIN wht_customers c ON r.customer_id = c.id
    WHERE r.id = ?
  `).get(id) as any;

  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  if (record.subtype !== "ภ.ง.ด.53") {
    return NextResponse.json({ error: "仅 ภ.ง.ด.53 支持下载 50ทวิ" }, { status: 400 });
  }

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: {
      Title: `50ทวิ - ${record.company_name}`,
      Author: "Internal System",
    },
  });

  // 注册泰文字体（Sarabun）。缺字体时直接失败，好过产出一份全是方块的税务文件
  let fonts;
  try {
    fonts = registerPdfFonts(doc);
  } catch (e) {
    console.error("[50ทวิ] 字体注册失败:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "字体加载失败" }, { status: 500 });
  }
  if (!fonts.hasCjk && hasCjkChars(record.company_name || "")) {
    console.warn(`[50ทวิ] 公司名「${record.company_name}」含中文，但未安装中文字体，该字段可能显示为空白。详见 src/lib/pdf-fonts.ts`);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const today = new Date().toLocaleDateString("th-TH", {
    year: "numeric", month: "long", day: "numeric",
  });
  const certNo = `WHT-${record.year_month.replace("-", "")}-${String(record.id).padStart(4, "0")}`;

  // === Header ===
  doc.fontSize(16).font(FONT_BOLD)
     .text("หนังสือรับรองการหักภาษี ณ ที่จ่าย", { align: "center" });
  doc.fontSize(14)
     .text("(Withholding Tax Certificate)", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(12).font(FONT_BOLD)
     .text("ภ.ง.ด.53", { align: "center" });
  doc.moveDown(0.5);

  // === Certificate Info ===
  doc.fontSize(10).font(FONT_REGULAR);
  doc.text(`เลขที่ (Certificate No.):  ${certNo}`, { continued: false });
  doc.text(`วันที่ (Date):  ${today}`, { continued: false });
  doc.text(`เดือนภาษี (Tax Month):  ${record.year_month}`);
  doc.moveDown(0.5);

  // === Payer (ผู้จ่ายเงิน - the customer) ===
  doc.fontSize(11).font(FONT_BOLD)
     .text("ผู้จ่ายเงิน (Payer / Withholding Agent)");
  doc.moveDown(0.2);
  doc.fontSize(10).font(FONT_REGULAR);
  // 泰文标签和中文公司名必须分两段渲染：
  // Sarabun 没有中文字形、NotoSansSC 没有泰文字形，整行用同一个字体必丢一半。
  // continued: true 让两段接在同一行上。
  doc.font(FONT_REGULAR).text("ชื่อบริษัท (Company):  ", { continued: true });
  doc.font(fontFor(record.company_name || "", fonts)).text(String(record.company_name || "—"));
  doc.font(FONT_REGULAR);
  doc.text(`เลขประจำตัวผู้เสียภาษี (Tax ID):  ${record.tax_id || "—"}`);
  doc.text(`ที่อยู่ (Address):  __________________________________________`);
  doc.moveDown(0.5);

  // === Payee (ผู้ถูกหักภาษี - the收款方) ===
  doc.fontSize(11).font(FONT_BOLD)
     .text("ผู้ถูกหักภาษี (Payee / Income Earner)");
  doc.moveDown(0.2);
  doc.fontSize(10).font(FONT_REGULAR);
  doc.text(`ชื่อบริษัท (Company):  __________________________________________`);
  doc.text(`เลขประจำตัวผู้เสียภาษี (Tax ID):  _________________________________`);
  doc.moveDown(0.5);

  // === Income Details ===
  doc.fontSize(11).font(FONT_BOLD)
     .text("รายการภาษีหัก ณ ที่จ่าย (Withholding Tax Details)");
  doc.moveDown(0.3);

  // Draw table
  const tableTop = doc.y;
  const colW = [30, 145, 95, 70, 70, 70];
  const headers = ["ลำดับ", "ประเภทเงินได้", "วันที่จ่าย", "จำนวนเงิน (บาท)", "อัตราภาษี (%)", "ภาษีหัก (บาท)"];
  const rowH = 22;

  // Draw header row
  doc.fontSize(8).font(FONT_BOLD);
  let x = 50;
  headers.forEach((h, i) => {
    doc.text(h, x + 2, tableTop + 5, { width: colW[i] - 4, align: "center" });
    x += colW[i];
  });
  doc.moveDown(0.2);

  // Draw header lines
  const headerBottom = tableTop + rowH;
  doc.rect(50, tableTop, colW.reduce((a, b) => a + b, 0), rowH).stroke();
  x = 50;
  for (let i = 0; i < colW.length - 1; i++) {
    x += colW[i];
    doc.moveTo(x, tableTop).lineTo(x, headerBottom).stroke();
  }

  // Draw data rows
  // 注意字段语义：wht_records.amount 是「应扣税额」（对账表里写进 tax_payable），
  // 不是收入额。旧实现把它当收入额再乘 3%，等于对税额又收了一次 3%，数字完全错。
  const taxAmount = record.amount || 0;
  const taxRate = record.tax_rate > 0 ? record.tax_rate : 3;
  // 收入额优先用录入值；没录入时按税率反算，并在备注里标明是推算值
  const incomeAmount = record.income_amount > 0
    ? record.income_amount
    : (taxAmount > 0 ? Math.round(taxAmount * 100 / taxRate) : 0);
  const incomeIsDerived = !(record.income_amount > 0) && taxAmount > 0;
  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  for (let r = 0; r < 4; r++) {
    const rowTop = headerBottom + r * rowH;
    doc.fontSize(8).font(FONT_REGULAR);
    const rowData = r === 0
      ? [
          (r + 1).toString(),
          "ค่าบริการ (Service Fee)",
          today,
          incomeAmount > 0 ? fmt(incomeAmount) : "___________",
          `${taxRate}`,
          taxAmount > 0 ? fmt(taxAmount) : "___________",
        ]
      : [(r + 1).toString(), "", "", "", "", ""];

    let rx = 50;
    rowData.forEach((val, i) => {
      doc.text(val, rx + 2, rowTop + 5, { width: colW[i] - 4, align: i >= 3 ? "right" : "left" });
      rx += colW[i];
    });

    // Row lines
    const rowBottom = rowTop + rowH;
    doc.rect(50, rowTop, colW.reduce((a, b) => a + b, 0), rowH).stroke();
    rx = 50;
    for (let i = 0; i < colW.length - 1; i++) {
      rx += colW[i];
      doc.moveTo(rx, rowTop).lineTo(rx, rowBottom).stroke();
    }
  }

  doc.moveDown(1);

  // 收入额是反算出来的时候要标明，避免被当成已核对的申报数据
  if (incomeIsDerived) {
    doc.fontSize(7).fillColor("#666").font(FONT_REGULAR);
    doc.text(`* จำนวนเงินได้คำนวณย้อนกลับจากภาษีหัก ณ ที่จ่ายที่อัตรา ${taxRate}% (Income amount derived from withholding tax at ${taxRate}%)`, { align: "left" });
    doc.fillColor("#000");
    doc.moveDown(0.3);
  }

  // === Certification ===
  doc.fontSize(10).font(FONT_REGULAR);
  doc.text(
    "ข้าพเจ้าขอรับรองว่า ข้อความและตัวเลขข้างต้นนี้ถูกต้องตามความเป็นจริงทุกประการ",
    { align: "center" }
  );
  doc.moveDown(0.2);
  doc.fontSize(9).font(FONT_REGULAR);
  doc.text(
    "I hereby certify that the above statements and figures are true and correct in every respect.",
    { align: "center" }
  );
  doc.moveDown(1.5);

  // === Signature ===
  doc.fontSize(10).font(FONT_REGULAR);
  doc.text("ลงชื่อ _________________________________  ผู้มีหน้าที่หักภาษี", { align: "right" });
  doc.moveDown(0.3);
  doc.text(`( _________________________________ )`, { align: "right" });
  doc.moveDown(0.3);
  doc.text(`วันที่ (Date):  ________ / ________ / ________`, { align: "right" });

  // === Footer ===
  doc.moveDown(2);
  doc.fontSize(7).font(FONT_REGULAR).fillColor("#999");
  doc.text(
    `เอกสารฉบับนี้ออกโดยระบบ auto-generated | Certificate No. ${certNo} | Generated: ${new Date().toISOString().slice(0, 19)}`,
    { align: "center" }
  );

  doc.end();

  const pdfBuffer = await pdfPromise;

  // 文件名含中文/泰文时不能直接放进 filename=（非 ASCII 会导致部分浏览器下载失败或乱码），
  // 按 RFC 5987 给出 filename*，同时保留一个纯 ASCII 的 filename 作为老浏览器回退
  const rawName = `50tawi-${record.company_name}-${record.year_month}.pdf`;
  const asciiName = `50tawi-${String(record.id)}-${record.year_month}.pdf`;
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`,
    },
  });
}
