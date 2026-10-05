import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { uploadsDir } from "@/lib/uploads";
import { utcNowStr, bangkokToday } from "@/lib/time";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 10 * 1024 * 1024;

const FIELDS = "leave_id, institution, doctor, cert_number, issue_date, sick_days, photo1, photo2, photo3, photo4, authorization, created_by, updated_by, updated_at, created_at";

function canAccess(auth: { role: string; name: string }, leave: { employee_name: string }): boolean {
  return auth.role === "admin" || leave.employee_name === auth.name;
}

// 员工本年度请病假累计次数（含已通过和待审批）
function sickCountInYear(db: ReturnType<typeof getDb>, employeeName: string): number {
  const year = bangkokToday().slice(0, 4);
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM leave_requests WHERE employee_name = ? AND leave_type = '病假' AND start_date LIKE ? AND status IN ('已通过','待审批')"
  ).get(employeeName, year + "%") as { c: number };
  return row.c;
}

function withUrls(row: any) {
  const u = (f: string) => (f ? `/api/files/${f}` : "");
  return {
    ...row,
    photo1_url: u(row.photo1),
    photo2_url: u(row.photo2),
    photo3_url: u(row.photo3),
    photo4_url: u(row.photo4),
  };
}

// GET /api/leave/medical-proof?leave_id=X — 四合一就医凭证（管理员或本人可见），含 need_authorization
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const leaveId = Number(new URL(req.url).searchParams.get("leave_id"));
  if (!Number.isInteger(leaveId) || leaveId <= 0) return NextResponse.json({ error: "缺少请假ID" }, { status: 400 });

  const leave = db.prepare("SELECT id, employee_name, leave_type FROM leave_requests WHERE id = ?").get(leaveId) as { id: number; employee_name: string; leave_type: string } | undefined;
  if (!leave) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });
  if (!canAccess(auth, leave)) return NextResponse.json({ error: "无权限" }, { status: 403 });

  const row = db.prepare(`SELECT ${FIELDS} FROM leave_medical_proofs WHERE leave_id = ?`).get(leaveId) as any;
  const needAuthorization = sickCountInYear(db, leave.employee_name) >= 3;
  return NextResponse.json(row ? { ...withUrls(row), need_authorization: needAuthorization } : { leave_id: leaveId, need_authorization: needAuthorization });
}

// POST /api/leave/medical-proof — 提交/更新四合一凭证（multipart，管理员或本人），四张照片都必传；
// 本年度病假累计 >= 3 次时须勾选同意授权（agreed=true）才能提交，记录「已签署」；也可 refuse=true 记录「拒绝授权」。
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  try {
    const formData = await req.formData();
    const leaveId = Number(formData.get("leave_id"));

    if (!Number.isInteger(leaveId) || leaveId <= 0) return NextResponse.json({ error: "缺少请假ID" }, { status: 400 });
    const leave = db.prepare("SELECT id, employee_name, leave_type FROM leave_requests WHERE id = ?").get(leaveId) as { id: number; employee_name: string; leave_type: string } | undefined;
    if (!leave) return NextResponse.json({ error: "请假记录不存在" }, { status: 404 });
    if (!canAccess(auth, leave)) return NextResponse.json({ error: "无权限" }, { status: 403 });

    const refuse = String(formData.get("refuse") || "") === "true" || String(formData.get("refuse") || "") === "1";

    // 拒绝授权：只记录授权状态为「拒绝授权」，不要求填信息和照片
    if (refuse) {
      db.prepare(
        `INSERT INTO leave_medical_proofs (leave_id, authorization, created_by, updated_by, updated_at)
         VALUES (?, '拒绝授权', ?, ?, ?)
         ON CONFLICT(leave_id) DO UPDATE SET authorization = excluded.authorization, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(leaveId, auth.name, auth.name, utcNowStr());
      logOperation(auth.name, "拒绝病假就医授权", "leave", String(leaveId), "拒绝授权");
      const row = db.prepare(`SELECT ${FIELDS} FROM leave_medical_proofs WHERE leave_id = ?`).get(leaveId) as any;
      return NextResponse.json(withUrls(row));
    }

    const institution = String(formData.get("institution") || "").trim();
    const doctor = String(formData.get("doctor") || "").trim();
    const cert_number = String(formData.get("cert_number") || "").trim();
    const issue_date = String(formData.get("issue_date") || "").trim();
    const sick_days = Number(formData.get("sick_days"));
    const agreed = String(formData.get("agreed") || "") === "true" || String(formData.get("agreed") || "") === "1";

    if (!institution) return NextResponse.json({ error: "请填写医疗机构名称" }, { status: 400 });
    if (!doctor) return NextResponse.json({ error: "请填写医师姓名及执照号" }, { status: 400 });
    if (!cert_number) return NextResponse.json({ error: "请填写医疗证明编号" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issue_date)) return NextResponse.json({ error: "请填写开具日期（YYYY-MM-DD）" }, { status: 400 });
    if (!Number.isInteger(sick_days) || sick_days <= 0) return NextResponse.json({ error: "请填写病假天数（正整数）" }, { status: 400 });

    const needAuthorization = sickCountInYear(db, leave.employee_name) >= 3;
    if (needAuthorization && !agreed) {
      return NextResponse.json({ error: "本年度病假已累计 3 次及以上，需先勾选同意授权公司核查医疗证明真伪才能提交" }, { status: 400 });
    }

    const photos = ["photo1", "photo2", "photo3", "photo4"];
    const files: Record<string, File> = {};
    for (const p of photos) {
      const f = formData.get(p) as File | null;
      if (!f) return NextResponse.json({ error: "四张照片缺一不可，请上传完整" }, { status: 400 });
      if (!ALLOWED_TYPES.includes(f.type)) return NextResponse.json({ error: "照片仅支持图片格式" }, { status: 400 });
      if (f.size > MAX_SIZE) return NextResponse.json({ error: "照片不能超过 10MB" }, { status: 400 });
      files[p] = f;
    }

    await mkdir(uploadsDir, { recursive: true });
    const existing = db.prepare(`SELECT ${FIELDS} FROM leave_medical_proofs WHERE leave_id = ?`).get(leaveId) as any;

    const saved: Record<string, string> = {};
    const newPaths: string[] = [];
    for (const p of photos) {
      const f = files[p];
      const name = `${randomUUID()}_${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const fp = path.join(uploadsDir, name);
      await writeFile(fp, Buffer.from(await f.arrayBuffer()), { flag: "wx" });
      saved[p] = name;
      newPaths.push(fp);
    }

    const authorization = needAuthorization ? "已签署" : "";

    try {
      db.prepare(
        `INSERT INTO leave_medical_proofs (leave_id, institution, doctor, cert_number, issue_date, sick_days, photo1, photo2, photo3, photo4, authorization, created_by, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(leave_id) DO UPDATE SET institution = excluded.institution, doctor = excluded.doctor, cert_number = excluded.cert_number, issue_date = excluded.issue_date, sick_days = excluded.sick_days, photo1 = excluded.photo1, photo2 = excluded.photo2, photo3 = excluded.photo3, photo4 = excluded.photo4, authorization = excluded.authorization, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(leaveId, institution, doctor, cert_number, issue_date, sick_days, saved.photo1, saved.photo2, saved.photo3, saved.photo4, authorization, auth.name, auth.name, utcNowStr());

      if (existing) {
        for (const p of photos) {
          const old = existing[p];
          if (old && old !== saved[p]) {
            const oldFp = path.join(uploadsDir, path.basename(old));
            if (existsSync(oldFp)) await unlink(oldFp).catch(() => {});
          }
        }
      }

      logOperation(auth.name, "补交病假就医凭证", "leave", String(leaveId), `${institution} ${doctor}`);
    } catch (error) {
      for (const fp of newPaths) await unlink(fp).catch(() => {});
      throw error;
    }

    const row = db.prepare(`SELECT ${FIELDS} FROM leave_medical_proofs WHERE leave_id = ?`).get(leaveId) as any;
    return NextResponse.json(withUrls(row));
  } catch (err) {
    console.error("[请假] 提交就医凭证失败:", err);
    return NextResponse.json({ error: "提交失败" }, { status: 500 });
  }
}
