import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildWorkflowCatalog } from "@/lib/workflow-catalog";
import { isWorkflowImported } from "@/lib/workflow-templates";

// GET /api/workflows — 流程设置清单（每套流程现在用的样子；导入后可编辑。仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可看" }, { status: 403 });
  const db = getDb();
  // 在职员工名单给编辑经办人的下拉用
  // 在岗员工（在职、试用期、待离职）给编辑经办人的下拉用；离职、停薪留职的单独列出来，页面标红
  const staff = (db.prepare("SELECT name FROM employees WHERE role IN ('admin','employee') AND status NOT IN ('离职','停薪留职') AND name <> '' ORDER BY id").all() as { name: string }[]).map((e) => e.name);
  const gone = (db.prepare("SELECT name FROM employees WHERE role IN ('admin','employee') AND status IN ('离职','停薪留职') AND name <> ''").all() as { name: string }[]).map((e) => e.name);
  return NextResponse.json({ entries: buildWorkflowCatalog(db), imported: isWorkflowImported(db), staff, gone });
}
