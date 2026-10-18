import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { acknowledgeBossSubmission } from "@/lib/boss-submissions";
import { reportSubmissionRevision, reflectionSubmissionRevision } from "@/lib/boss-submission-types";

// 只有详情中实际展示的提交版本才记已阅；读消息、读列表不影响待处理清单。
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可记录已阅" }, { status: 403 });
  const { category, items } = await readJson(req);
  if (!["report", "meeting"].includes(category) || !Array.isArray(items) || items.length > 1000 || items.some(item => !Number.isSafeInteger(item?.id) || item.id <= 0 || typeof item.revision !== "string")) {
    return NextResponse.json({ error: "无效的已阅记录" }, { status: 400 });
  }
  const db = getDb();
  let marked = 0;
  db.transaction(() => {
    for (const item of items) {
      const row = db.prepare(category === "report" ? "SELECT * FROM work_reports WHERE id=? AND status='已提交'" : "SELECT * FROM meeting_reflections WHERE id=? AND status='已提交'").get(item.id) as { submitted_at: string; created_at: string; updated_at: string; content: string; images: string } | undefined;
      if (!row) continue;
      const revision = category === "report" ? reportSubmissionRevision(row) : reflectionSubmissionRevision(row);
      if (revision !== item.revision) continue;
      acknowledgeBossSubmission(db, category, item.id, auth.name, revision); marked++;
    }
  })();
  return NextResponse.json({ success: true, marked });
}
