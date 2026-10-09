import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { clearAnnouncementOverdueTodos } from "@/lib/announcement-overdue";

// PATCH /api/announcements/[id]/recall — 管理员撤回自己发的通知
// 撤回后员工那边显示「已撤回」标红，不能再复述；同时清掉该通知的逾期待办。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可撤回通知" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const ann = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  if (ann.created_by !== auth.name) return NextResponse.json({ error: "只能撤回自己发的通知" }, { status: 403 });
  if (ann.recalled) return NextResponse.json({ error: "该通知已撤回" }, { status: 400 });

  db.prepare("UPDATE announcements SET recalled = 1 WHERE id = ?").run(id);
  clearAnnouncementOverdueTodos(Number(id));
  logOperation(auth.name, "撤回通知", "announcement", String(id), String(ann.title));
  return NextResponse.json(db.prepare("SELECT * FROM announcements WHERE id = ?").get(id));
}
