import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb } from "@/lib/db";

// POST /api/vat/records/batch
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const body = await readJson(req);
  const { action, record_ids } = body;

  if (!Array.isArray(record_ids) || record_ids.length === 0) {
    return NextResponse.json({ error: "请选择至少一条记录" }, { status: 400 });
  }

  const db = getDb();
  const placeholders = record_ids.map(() => "?").join(",");

  if (action === "urge") {
    // 批量标记"已催交资料"
    // Update the first pending step to have a note about being urged
    db.transaction(() => {
      for (const rid of record_ids) {
        const firstPending = db.prepare(
          "SELECT id FROM vat_record_steps WHERE record_id = ? AND status = '待处理' ORDER BY step_order LIMIT 1"
        ).get(rid) as { id: number } | undefined;
        if (firstPending) {
          db.prepare("INSERT INTO vat_step_notes (record_id, step_id, content, created_by) VALUES (?, ?, ?, ?)").run(
            rid, firstPending.id, "⏰ 已催交资料", auth.name || "系统"
          );
        }
      }
  
    })();
    db.prepare(`UPDATE vat_records SET updated_at = datetime('now') WHERE id IN (${placeholders})`).run(...record_ids);
    return NextResponse.json({ success: true, message: `已催交 ${record_ids.length} 条记录` });
  }

  if (action === "notify") {
    // 批量发确认通知 — 在第三步添加确认通知备注
    db.transaction(() => {
      for (const rid of record_ids) {
        const step3 = db.prepare(
          "SELECT id FROM vat_record_steps WHERE record_id = ? AND step_order = 3"
        ).get(rid) as { id: number } | undefined;
        if (step3) {
          db.prepare("INSERT INTO vat_step_notes (record_id, step_id, content, created_by) VALUES (?, ?, ?, ?)").run(
            rid, step3.id, "📧 已发客户确认通知", auth.name || "系统"
          );
        }
      }
  
    })();
    return NextResponse.json({ success: true, message: `已发送 ${record_ids.length} 条确认通知` });
  }

  if (action === "pause") {
    // 批量暂停客户：启用 → 暂停
    const customerIds = db.prepare(
      `SELECT DISTINCT customer_id FROM vat_records WHERE id IN (${placeholders})`
    ).all(...record_ids) as { customer_id: number }[];

    const custPlaceholders = customerIds.map(() => "?").join(",");
    let paused = 0;
    if (customerIds.length > 0) {
      // 只暂停当前是「启用」的客户，避免把已终止/已软删的客户也改成暂停
      const res = db.prepare(
        `UPDATE vat_customers SET status = '暂停', updated_at = datetime('now')
         WHERE id IN (${custPlaceholders}) AND status = '启用' AND COALESCE(deleted, 0) = 0`
      ).run(...customerIds.map(c => c.customer_id));
      paused = res.changes;
    }
    return NextResponse.json({ success: true, message: `已暂停 ${paused} 个客户` });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
