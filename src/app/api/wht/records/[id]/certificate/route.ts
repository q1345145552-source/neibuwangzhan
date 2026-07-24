import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import PDFDocument from "pdfkit";

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
  doc.fontSize(16).font("Helvetica-Bold")
     .text("หนังสือรับรองการหักภาษี ณ ที่จ่าย", { align: "center" });
  doc.fontSize(14)
     .text("(Withholding Tax Certificate)", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(12).font("Helvetica-Bold")
     .text("ภ.ง.ด.53", { align: "center" });
  doc.moveDown(0.5);

  // === Certificate Info ===
  doc.fontSize(10).font("Helvetica");
  doc.text(`เลขที่ (Certificate No.):  ${certNo}`, { continued: false });
  doc.text(`วันที่ (Date):  ${today}`, { continued: false });
  doc.text(`เดือนภาษี (Tax Month):  ${record.year_month}`);
  doc.moveDown(0.5);

  // === Payer (ผู้จ่ายเงิน - the customer) ===
  doc.fontSize(11).font("Helvetica-Bold")
     .text("ผู้จ่ายเงิน (Payer / Withholding Agent)");
  doc.moveDown(0.2);
  doc.fontSize(10).font("Helvetica");
  doc.text(`ชื่อบริษัท (Company):  ${record.company_name}`);
  doc.text(`เลขประจำตัวผู้เสียภาษี (Tax ID):  ${record.tax_id || "—"}`);
  doc.text(`ที่อยู่ (Address):  __________________________________________`);
  doc.moveDown(0.5);

  // === Payee (ผู้ถูกหักภาษี - the收款方) ===
  doc.fontSize(11).font("Helvetica-Bold")
     .text("ผู้ถูกหักภาษี (Payee / Income Earner)");
  doc.moveDown(0.2);
  doc.fontSize(10).font("Helvetica");
  doc.text(`ชื่อบริษัท (Company):  __________________________________________`);
  doc.text(`เลขประจำตัวผู้เสียภาษี (Tax ID):  _________________________________`);
  doc.moveDown(0.5);

  // === Income Details ===
  doc.fontSize(11).font("Helvetica-Bold")
     .text("รายการภาษีหัก ณ ที่จ่าย (Withholding Tax Details)");
  doc.moveDown(0.3);

  // Draw table
  const tableTop = doc.y;
  const colW = [30, 145, 95, 70, 70, 70];
  const headers = ["ลำดับ", "ประเภทเงินได้", "วันที่จ่าย", "จำนวนเงิน (บาท)", "อัตราภาษี (%)", "ภาษีหัก (บาท)"];
  const rowH = 22;

  // Draw header row
  doc.fontSize(8).font("Helvetica-Bold");
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
  const amount = record.amount || 0;
  const taxRate = 3;
  const taxAmount = Math.round(amount * taxRate / 100);

  for (let r = 0; r < 4; r++) {
    const rowTop = headerBottom + r * rowH;
    doc.fontSize(8).font("Helvetica");
    const rowData = r === 0
      ? [(r + 1).toString(), "ค่าบริการ (Service Fee)", today, amount > 0 ? amount.toLocaleString() : "___________", `${taxRate}`, amount > 0 ? taxAmount.toLocaleString() : "___________"]
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

  // === Certification ===
  doc.fontSize(10).font("Helvetica");
  doc.text(
    "ข้าพเจ้าขอรับรองว่า ข้อความและตัวเลขข้างต้นนี้ถูกต้องตามความเป็นจริงทุกประการ",
    { align: "center" }
  );
  doc.moveDown(0.2);
  doc.fontSize(9).font("Helvetica-Oblique");
  doc.text(
    "I hereby certify that the above statements and figures are true and correct in every respect.",
    { align: "center" }
  );
  doc.moveDown(1.5);

  // === Signature ===
  doc.fontSize(10).font("Helvetica");
  doc.text("ลงชื่อ _________________________________  ผู้มีหน้าที่หักภาษี", { align: "right" });
  doc.moveDown(0.3);
  doc.text(`( _________________________________ )`, { align: "right" });
  doc.moveDown(0.3);
  doc.text(`วันที่ (Date):  ________ / ________ / ________`, { align: "right" });

  // === Footer ===
  doc.moveDown(2);
  doc.fontSize(7).font("Helvetica").fillColor("#999");
  doc.text(
    `เอกสารฉบับนี้ออกโดยระบบ auto-generated | Certificate No. ${certNo} | Generated: ${new Date().toISOString().slice(0, 19)}`,
    { align: "center" }
  );

  doc.end();

  const pdfBuffer = await pdfPromise;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="50tawi-${record.company_name}-${record.year_month}.pdf"`,
    },
  });
}
