import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

export async function GET(req: NextRequest) {
  // 这里原先整个 GET 没有鉴权（同文件其他方法有，按文件粒度扫描会漏掉），未登录即可拉全部客户名单
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

  // deleted = 1 为软删除（见 DELETE），列表不展示，但历史归档记录仍能 JOIN 出公司名
  const rows = db.prepare("SELECT * FROM wht_customers WHERE deleted = 0 ORDER BY status, company_name").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await readJson(req);

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
  const _ec = validateEnums({ "wht_customers.status": status });
  if (_ec) return NextResponse.json({ error: _ec }, { status: 400 });
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
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await readJson(req);
  const { id, company_name, tax_id, contact, status } = body;
  const _e = validateEnums({ "wht_customers.status": status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });
  if (!company_name?.trim()) return NextResponse.json({ error: "请输入公司名称" }, { status: 400 });

  const db = getDb();
  db.prepare(
    "UPDATE wht_customers SET company_name=?, tax_id=?, contact=?, status=?, updated_at=datetime('now') WHERE id=?"
  ).run(company_name.trim(), tax_id || "", contact || "", status || "启用", id);
  const row = db.prepare("SELECT * FROM wht_customers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

// 软删除，理由同 VAT：物理删除 + 全局关外键会让并发请求失去外键保护，
// 且历史申报记录会因 customer_id 悬空而在列表里彻底消失。
// 另外原实现把已归档记录也一并删了，和 VAT 的行为不一致，这里统一为「保留归档」。
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可删除客户" }, { status: 403 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少客户 ID" }, { status: 400 });

  const db = getDb();
  const customer = db.prepare("SELECT id FROM wht_customers WHERE id = ?").get(id);
  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  let archivedKept = 0;
  db.transaction(() => {
    const nonArchived = db.prepare(
      "SELECT id FROM wht_records WHERE customer_id = ? AND progress != '归档'"
    ).all(id) as { id: number }[];

    if (nonArchived.length > 0) {
      const ph = nonArchived.map(() => "?").join(",");
      const ids = nonArchived.map(r => r.id);
      db.prepare(`DELETE FROM wht_step_notes WHERE record_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM wht_record_documents WHERE record_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM wht_record_steps WHERE record_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM wht_records WHERE id IN (${ph})`).run(...ids);
    }

    db.prepare("DELETE FROM wht_reconciliation WHERE customer_id = ?").run(id);

    archivedKept = (db.prepare(
      "SELECT COUNT(*) as c FROM wht_records WHERE customer_id = ?"
    ).get(id) as { c: number }).c;

    db.prepare(
      "UPDATE wht_customers SET deleted = 1, status = '已终止', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
  })();

  logOperation(auth.name, "删除WHT客户", "wht_customer", String(id), `保留归档记录 ${archivedKept} 条`);
  return NextResponse.json({ success: true, archived_kept: archivedKept });
}
