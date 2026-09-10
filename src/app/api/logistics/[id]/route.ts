import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

// GET /api/logistics/[id]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const order = db.prepare("SELECT * FROM shipping_orders WHERE id = ?").get(id);
  if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 404 });

  const steps = db.prepare("SELECT * FROM shipping_steps WHERE order_id = ? ORDER BY step_order").all(id);

  const stepNotes: Record<number, any[]> = {};
  const allNotes = db.prepare(
    "SELECT * FROM shipping_step_notes WHERE order_id = ? ORDER BY created_at"
  ).all(id) as any[];
  for (const n of allNotes) {
    // step_id=0 是旧的订单级文件备注，已迁移到 shipping_order_files，这里跳过（备注仍保留，但不再作为文件读取）
    if (n.step_id === 0) continue;
    if (!stepNotes[n.step_id]) stepNotes[n.step_id] = [];
    stepNotes[n.step_id].push(n);
  }

  // 订单级文件直接从独立文件表查
  const orderFiles = db.prepare(
    "SELECT id, name, url, uploaded_by as created_by, created_at FROM shipping_order_files WHERE order_id = ? ORDER BY created_at"
  ).all(id) as { id: number; name: string; url: string; created_by: string; created_at: string }[];

  return NextResponse.json({ ...(order as object), steps, stepNotes, orderFiles });
}


// DELETE /api/logistics/[id] — 删除整个柜号订单（含步骤、备注、文件）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { id } = await params;
  const db = getDb();

  const order = db.prepare("SELECT * FROM shipping_orders WHERE id = ?").get(id) as any;
  if (!order) return NextResponse.json({ error: "柜号订单不存在" }, { status: 404 });

  // 权限：管理员可删所有人，员工只能删自己创建的
  if (auth.role !== "admin" && order.creator !== auth.name) {
    return NextResponse.json({ error: "没有权限删除别人的柜号订单" }, { status: 403 });
  }

  // 收集文件 URL（独立文件表 + 备注表），删除磁盘上的实际文件
  const uploadDirs = [path.join(process.cwd(), "uploads"), path.join(os.tmpdir(), "xiangtai-uploads")];
  const safeNames = new Set<string>();
  // 1) 独立文件表里的订单级文件
  const orderFiles = db.prepare("SELECT url FROM shipping_order_files WHERE order_id = ?").all(id) as { url: string }[];
  for (const f of orderFiles) {
    const m = (f.url || "").match(/\/api\/files\/([A-Za-z0-9._-]+)/);
    if (m) safeNames.add(m[1]);
  }
  // 2) 备注里的步骤级文件（沿用原正则，兼容 [标签] /api/files/xxx 等格式）
  const allNotes = db.prepare(
    "SELECT content FROM shipping_step_notes WHERE order_id = ?"
  ).all(id) as { content: string }[];
  for (const n of allNotes) {
    const matches = (n.content || "").matchAll(/\/api\/files\/([A-Za-z0-9._-]+)/g);
    for (const m of matches) {
      safeNames.add(m[1]);
    }
  }

  // 事务删除：文件表 → 备注 → 步骤 → 订单
  db.transaction(() => {
    db.prepare("DELETE FROM shipping_order_files WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_step_notes WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_steps WHERE order_id = ?").run(id);
    db.prepare("DELETE FROM shipping_orders WHERE id = ?").run(id);
  })();

  // 删除磁盘文件（放在事务成功后，避免文件先删数据库失败）
  for (const safeName of safeNames) {
    const base = path.basename(safeName);
    for (const dir of uploadDirs) {
      const fp = path.join(dir, base);
      if (existsSync(fp)) {
        try { unlinkSync(fp); } catch (e) { console.error("[物流删除] 删除文件失败", fp, e); }
      }
    }
  }

  return NextResponse.json({ success: true, deletedFiles: safeNames.size });
}
