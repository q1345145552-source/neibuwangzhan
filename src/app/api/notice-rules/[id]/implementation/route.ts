import { publishBossSubmission } from "@/lib/boss-submissions";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { ownEmployeeNotice } from "@/lib/notice-rule-access";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const result = ownEmployeeNotice(auth, (await params).id);
  if (result.error) return result.error;
  const body = await readJson(req);
  const statement = typeof body.statement === "string" ? body.statement.trim() : "";
  const photo = typeof body.photo === "string" ? body.photo : "";
  if (!photo) return NextResponse.json({ error: "请上传打印纸的照片" }, { status: 400 });
  if (!statement) return NextResponse.json({ error: "请填写一句话说明" }, { status: 400 });
  // 只允许当前员工经系统上传的照片，不接受外链、他人的文件或 PDF。
  const filename = /^\/api\/files\/([a-zA-Z0-9._-]+)$/.exec(photo)?.[1];
  const db = getDb();
  const upload = filename ? db.prepare("SELECT mime_type FROM file_uploads WHERE filename=? AND uploaded_by_id=? AND uploaded_by_role='employee'").get(filename, auth.id) as { mime_type: string } | undefined : undefined;
  if (!upload || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(upload.mime_type)) {
    return NextResponse.json({ error: "请上传你自己的有效照片文件" }, { status: 400 });
  }
  // 条件更新同时校验打印和可提交状态，防止重复提交覆盖正在验收的内容。
  const saved = db.transaction(() => {
    const updated = db.prepare(`UPDATE notice_rule_implementations SET photos=?, statement=?,
    photos_uploaded_at=(SELECT created_at FROM file_uploads WHERE filename=?),
    statement_at=strftime('%Y-%m-%d %H:%M:%f','now'), submitted_at=strftime('%Y-%m-%d %H:%M:%f','now'), review_status='还没处理', boss_comment='',
    reviewed_at=NULL, updated_at=datetime('now')
    WHERE notice_id=? AND employee_id=? AND printed=1 AND (submitted_at IS NULL OR review_status='打回')`)
    .run(JSON.stringify([photo]), statement, filename!, result.notice.id, auth.id);
    if (updated.changes) {
      const record = db.prepare("SELECT id FROM notice_rule_implementations WHERE notice_id=? AND employee_id=?").get(result.notice.id, auth.id) as { id: number };
      publishBossSubmission(db, "notice", record.id, auth.name, `提交了通知/规则「${result.notice.title}」的落实照片和说明`);
    }
    return updated;
  })();
  if (!saved.changes) return NextResponse.json({ error: result.notice.printed ? "已经提交，请等待老板验收" : "请先点击打印，再提交照片和说明" }, { status: 409 });
  return NextResponse.json({ success: true, status: "已提交、等老板验收" });
}
