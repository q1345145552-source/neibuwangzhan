import path from "node:path";
import { existsSync } from "node:fs";
import PDFDocument from "pdfkit";
import { getDb } from "@/lib/db";
import { registerPdfFonts, fontFor, FONT_BOLD, FONT_REGULAR, FONT_CJK } from "@/lib/pdf-fonts";
import { zodiacFromBirthDate } from "@/lib/utils";
import { uploadsDir } from "@/lib/uploads";

export interface EmployeePdfResult {
  buffer: Buffer;
  filename: string;
  asciiName: string;
}

/** 生成某员工档案 PDF；员工不存在返回 null */
export async function generateEmployeePdf(employeeId: number): Promise<EmployeePdfResult | null> {
  const db = getDb();
  const emp = db.prepare(
    "SELECT id, name, email, role, status, hire_date, gender, birth_date, phone, address, id_number, department, position, contract_term, bank_name, bank_account, emergency_name, emergency_phone, emergency_relation, education, skills, notes, bazi, fortune, passport_number, social_security_number, tax_number, work_permit_number, work_permit_expiry, visa_expiry FROM employees WHERE id = ?"
  ).get(employeeId) as Record<string, string | number> | undefined;
  if (!emp) return null;

  const records = db.prepare(
    "SELECT id, type, points, content, created_by, created_at FROM employee_records WHERE employee_id = ? ORDER BY created_at DESC, id DESC"
  ).all(employeeId) as { type: string; points: number; content: string; created_by: string; created_at: string }[];

  const files = db.prepare(
    "SELECT id, category, filename, original_name, mime_type, size FROM employee_files WHERE employee_id = ? ORDER BY created_at DESC, id DESC"
  ).all(employeeId) as { category: string; filename: string; original_name: string; mime_type: string; size: number }[];

  const educations = db.prepare(
    "SELECT level, school, major, grad_year FROM employee_educations WHERE employee_id = ? ORDER BY id DESC"
  ).all(employeeId) as { level: string; school: string; major: string; grad_year: string }[];

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 50, bottom: 50, left: 50, right: 50 },
    info: { Title: `员工档案 - ${emp.name}`, Author: "Internal System" },
  });

  let fonts: ReturnType<typeof registerPdfFonts>;
  try {
    fonts = registerPdfFonts(doc);
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "字体加载失败");
  }

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const labelFont = fonts.hasCjk ? FONT_CJK : FONT_REGULAR;
  const v = (x: unknown) => (x === null || x === undefined || String(x).trim() === "" ? "—" : String(x));

  function field(label: string, value: unknown) {
    doc.font(labelFont).fontSize(10);
    doc.text(`${label}：`, { continued: true });
    doc.font(fontFor(v(value), fonts)).fontSize(10);
    doc.text(v(value), { continued: false });
  }

  function sectionTitle(title: string) {
    doc.moveDown(0.4);
    doc.font(FONT_BOLD).fontSize(12).text(title, { underline: false });
    doc.moveDown(0.1);
    doc.font(FONT_REGULAR).fontSize(10);
  }

  // === 标题 ===
  doc.font(labelFont).fontSize(18).text("员工档案", { align: "center" });
  doc.moveDown(0.3);
  doc.font(labelFont).fontSize(12).text(`姓名：${v(emp.name)}`, { align: "center" });
  doc.moveDown(0.3);

  // === 基本信息 ===
  sectionTitle("基本信息");
  field("性别", emp.gender);
  field("出生日期", emp.birth_date);
  field("星座", zodiacFromBirthDate(String(emp.birth_date || "")));
  field("电话", emp.phone);
  field("地址", emp.address);
  field("身份证号 / 护照号", emp.id_number);

  // === 工作信息 ===
  sectionTitle("工作信息");
  field("部门", emp.department);
  field("职位", emp.position);
  field("合同期限", emp.contract_term);

  // === 银行信息 ===
  sectionTitle("银行信息");
  field("开户银行", emp.bank_name);
  field("银行账号", emp.bank_account);

  // === 紧急联系人 ===
  sectionTitle("紧急联系人");
  field("姓名", emp.emergency_name);
  field("电话", emp.emergency_phone);
  field("关系", emp.emergency_relation);

  // === 泰国合规 ===
  sectionTitle("泰国合规");
  field("护照号", emp.passport_number);
  field("社保号", emp.social_security_number);
  field("税号", emp.tax_number);
  field("工作证号", emp.work_permit_number);
  field("工作证到期日", emp.work_permit_expiry);
  field("签证到期日", emp.visa_expiry);

  // === 教育履历 ===
  sectionTitle("教育履历");
  if (educations.length === 0) {
    doc.font(FONT_REGULAR).fontSize(10).text("无记录");
  } else {
    for (const e of educations) {
      const line = [e.level, e.school, e.major, e.grad_year ? `${e.grad_year}届` : ""].filter(Boolean).join(" · ");
      doc.font(labelFont).fontSize(10).text(line);
    }
  }

  // === 其他 ===
  sectionTitle("其他");
  field("技能", emp.skills);
  field("生辰八字", emp.bazi);
  field("算命", emp.fortune);
  field("备注", emp.notes);

  // === 扣分 / 记优点 ===
  sectionTitle("扣分 / 记优点");
  if (records.length === 0) {
    doc.font(FONT_REGULAR).fontSize(10).text("无记录");
  } else {
    for (const r of records) {
      const sign = r.type === "demerit" ? "-" : "+";
      const badge = r.type === "demerit" ? "扣分" : "记优点";
      const date = String(r.created_at || "").slice(0, 10);
      doc.font(labelFont).fontSize(10).text(`${badge}  ${sign}${r.points}分`, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).text(`    ${r.content}    (${date})`);
    }
  }

  // === 档案文件 ===
  sectionTitle("档案文件");
  if (files.length === 0) {
    doc.font(FONT_REGULAR).fontSize(10).text("无文件");
  } else {
    for (const f of files) {
      doc.font(labelFont).fontSize(10).text(`[${f.category}]`, { continued: true });
      doc.font(FONT_REGULAR).fontSize(10).text(`  ${f.original_name || f.filename}`);
      if (f.mime_type === "image/jpeg" || f.mime_type === "image/png") {
        const fp = path.join(uploadsDir, path.basename(f.filename));
        if (existsSync(fp)) {
          try {
            doc.moveDown(0.2);
            doc.image(fp, { fit: [400, 300], align: "center" });
            doc.moveDown(0.2);
          } catch (e) {
            console.warn("[员工档案PDF] 图片嵌入失败:", f.filename, e);
          }
        }
      }
    }
  }

  doc.end();
  const pdfBuffer = await pdfPromise;

  return {
    buffer: pdfBuffer,
    filename: `员工档案-${emp.name}.pdf`,
    asciiName: `employee-profile-${employeeId}.pdf`,
  };
}
