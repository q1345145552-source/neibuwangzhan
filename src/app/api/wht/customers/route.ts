import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  const db = getDb();

  // Template download
  if (action === "template") {
    const csvHeaders = "公司名称,税号,联系方式";
    const csvExample = "示例科技有限公司,1234567890,xxx@email.com";
    const BOM = "\ufeff";
    const NL = "\n";
    const csv = BOM + csvHeaders + NL + csvExample + NL;
    const encoded = new TextEncoder().encode(csv);
    return new NextResponse(encoded, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename*=UTF-8''%E9%A2%84%E6%89%A3%E7%A8%8E%E5%AE%A2%E6%88%B7%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.csv",
      },
    });
  }

  const rows = db.prepare("SELECT * FROM wht_customers ORDER BY status, company_name").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();

  // Batch import from CSV
  if (body.action === "batch_import") {
    const { csv_text } = body;
    if (!csv_text?.trim()) return NextResponse.json({ error: "请上传CSV文件内容" }, { status: 400 });

    const lines = csv_text.trim().split(/\r?\n/);
    if (lines.length < 2) return NextResponse.json({ error: "CSV文件为空或只有表头" }, { status: 400 });

    const headerLine = lines[0].replace(/^\uFEFF/, "");
    const headers = headerLine.split(",").map((h: string) => h.trim());

    const fieldMap: Record<string, string> = {
      "公司名称": "company_name",
      "税号": "tax_id",
      "联系方式": "contact",
    };

    const db = getDb();
    const errors: string[] = [];
    let successCount = 0;
    const skipped: string[] = [];

    // Parse CSV lines handling quoted fields
    const parseCsvLine = (line: string): string[] => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      result.push(current.trim());
      return result;
    };

    for (let i = 1; i < lines.length; i++) {
      const lineNum = i + 1;
      const raw = lines[i].trim();
      if (!raw) continue;

      const values = parseCsvLine(raw);
      if (values.length < 1 || !values[0]) {
        errors.push(`第${lineNum}行: 公司名称为空`);
        continue;
      }

      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        const dbField = fieldMap[headers[j]];
        if (dbField && j < values.length) {
          row[dbField] = values[j];
        }
      }

      const companyName = row.company_name;
      if (!companyName) {
        errors.push(`第${lineNum}行: 缺少公司名称`);
        continue;
      }

      // Check duplicate
      const exists = db.prepare("SELECT id FROM wht_customers WHERE company_name = ?").get(companyName);
      if (exists) {
        skipped.push(`第${lineNum}行: "${companyName}" 已存在`);
        continue;
      }

      try {
        db.prepare(
          "INSERT INTO wht_customers (company_name, tax_id, contact, status) VALUES (?, ?, ?, '启用')"
        ).run(companyName, row.tax_id || "", row.contact || "");
        successCount++;
      } catch (e: any) {
        errors.push(`第${lineNum}行: ${e.message || "导入失败"}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported: successCount,
      skipped: skipped.length,
      errors,
      skippedRows: skipped,
      total: lines.length - 1,
    });
  }

  // Single customer add
  const { company_name, tax_id, contact, status } = body;
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  const result = db.prepare(
    "INSERT INTO wht_customers (company_name, tax_id, contact, status) VALUES (?, ?, ?, ?)"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用");
  const row = db.prepare("SELECT * FROM wht_customers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await req.json();
  const { id, company_name, tax_id, contact, status } = body;
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  db.prepare(
    "UPDATE wht_customers SET company_name=?, tax_id=?, contact=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用", id);
  const row = db.prepare("SELECT * FROM wht_customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  db.pragma("foreign_keys = OFF");
  db.prepare("DELETE FROM wht_record_steps WHERE record_id IN (SELECT id FROM wht_records WHERE customer_id = ?)").run(id);
  db.prepare("DELETE FROM wht_records WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM wht_reconciliation WHERE customer_id = ?").run(id);
  db.prepare("DELETE FROM wht_customers WHERE id = ?").run(id);
  db.pragma("foreign_keys = ON");
  return NextResponse.json({ success: true });
}
