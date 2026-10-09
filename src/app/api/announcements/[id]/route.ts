import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/announcements/[id] — 通知详情；员工打开即把「待读」改成「已读待复述」
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const announcement = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!announcement) return NextResponse.json({ error: "通知不存在" }, { status: 404 });

  let myRecipient: any = null;
  if (auth.role === "employee") {
    myRecipient = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, auth.name) as any;
    if (myRecipient && myRecipient.status === "待读") {
      db.prepare("UPDATE announcement_recipients SET status = '已读待复述', updated_at = datetime('now') WHERE id = ?").run(myRecipient.id);
      myRecipient = db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(myRecipient.id);
    }
  }

  const recipients = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? ORDER BY id ASC").all(id) as any[];

  return NextResponse.json({ ...announcement, my_recipient: myRecipient, recipients });
}
