import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const businessLine = searchParams.get("business");

  try {
    let rows;
    if (businessLine) {
      rows = db.prepare(`
        SELECT d.*, o.customer_name, bt.name as business_line_name
        FROM documents d
        LEFT JOIN orders o ON d.order_id = o.id
        LEFT JOIN business_types bt ON o.business_type_id = bt.id
        WHERE bt.name = ?
        ORDER BY d.created_at DESC
      `).all(businessLine);
    } else {
      rows = db.prepare(`
        SELECT d.*, o.customer_name, bt.name as business_line_name
        FROM documents d
        LEFT JOIN orders o ON d.order_id = o.id
        LEFT JOIN business_types bt ON o.business_type_id = bt.id
        ORDER BY d.created_at DESC
      `).all();
    }
    return NextResponse.json(rows);
  } catch (err) {
    console.error("Failed to fetch documents:", err);
    return NextResponse.json({ error: "获取文档列表失败" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const db = getDb();
  try {
    const body = await req.json();
    const { name, file_type, uploaded_by, file_url, order_id } = body;
    if (!name) return NextResponse.json({ error: "请提供文档名称" }, { status: 400 });

    const result = db.prepare(
      "INSERT INTO documents (order_id, name, file_type, status, uploaded_by, file_url) VALUES (?, ?, ?, '待审核', ?, ?)"
    ).run(order_id || "", name, file_type || "", uploaded_by || "", file_url || "");

    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    console.error("Failed to create document:", err);
    return NextResponse.json({ error: "创建文档失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const db = getDb();
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "请提供文档ID" }, { status: 400 });

    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete document:", err);
    return NextResponse.json({ error: "删除文档失败" }, { status: 500 });
  }
}
