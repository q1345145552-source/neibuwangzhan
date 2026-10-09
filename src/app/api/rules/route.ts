import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/rules — 规则库列表（员工只读，管理员看全部 + 待覆盖更新进度）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  const rules = db.prepare("SELECT * FROM rules ORDER BY updated_at DESC, id DESC").all() as any[];

  const result = rules.map((r) => {
    let pending: any = null;
    if (isAdmin) {
      const p = db.prepare("SELECT id, title, deadline FROM announcements WHERE rule_id = ? ORDER BY id DESC LIMIT 1").get(r.id) as any;
      if (p) {
        const total = (db.prepare("SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ?").get(p.id) as any).c;
        const confirmed = (db.prepare("SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ? AND status = '已确认'").get(p.id) as any).c;
        pending = { announcement_id: p.id, title: p.title, deadline: p.deadline, confirmed, total };
      }
    }
    return { ...r, pending };
  });
  return NextResponse.json(result);
}
