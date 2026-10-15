import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { translateText } from "@/lib/deepseek";
import { normalizeCompletedItems, completedItemText } from "@/lib/work-report-items";

const cacheColumns = {
  completed_items: "completed_items_zh",
  summary: "summary_zh",
  tomorrow_plan: "tomorrow_plan_zh",
  problems: "problems_zh",
} as const;
type Field = keyof typeof cacheColumns;
type Report = { id: number; employee_name: string; related_objects: string; submitted_at: string }
  & Record<Field | typeof cacheColumns[Field], string | null>;

function businessContext(raw: string): string | undefined {
  try {
    const objects: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(objects)) return;
    const labels: Record<string, string> = { project: "项目", customer: "客户", order: "订单" };
    const names = objects.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { type, name } = item;
      if (typeof type !== "string" || !Object.hasOwn(labels, type) || typeof name !== "string" || !name.trim()) return [];
      return [`${labels[type]}：${name.trim().slice(0, 300)}`];
    }).slice(0, 20);
    return names.length ? `这条日报关联的业务对象（用于理解业务术语）：\n${names.join("\n")}` : undefined;
  } catch { return; }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "无效的日报ID" }, { status: 400 });
  const body = await readJson(req);
  if (typeof body.field !== "string" || !Object.hasOwn(cacheColumns, body.field)) {
    return NextResponse.json({ error: "请选择有效的翻译字段" }, { status: 400 });
  }
  const field = body.field as Field;
  const cacheColumn = cacheColumns[field];
  const db = getDb();
  const report = db.prepare("SELECT * FROM work_reports WHERE id = ?").get(id) as Report | undefined;
  if (!report) return NextResponse.json({ error: "日报不存在" }, { status: 404 });
  if (auth.role !== "admin" && report.employee_name !== auth.name) {
    return NextResponse.json({ error: "只能翻译自己的日报" }, { status: 403 });
  }
  if (report[cacheColumn]?.trim()) {
    return NextResponse.json({ [cacheColumn]: report[cacheColumn], cached: true });
  }
  const text = report[field] || "";
  const items = field === "completed_items" ? normalizeCompletedItems(text) : [];
  if (field === "completed_items" ? !items.length : !text.trim()) {
    return NextResponse.json({ error: "该字段没有可翻译的内容" }, { status: 400 });
  }

  try {
    const context = businessContext(report.related_objects);
    let zh: string;
    if (field === "completed_items") {
      const translated = [];
      for (const item of items) {
        const translatedText = await translateText(completedItemText(item), "中文", context);
        translated.push(typeof item === "string" ? translatedText : { ...item, text: translatedText });
      }
      zh = JSON.stringify(translated);
    } else {
      zh = await translateText(text, "中文", context);
    }
    // 列名仅来自白名单；若翻译期间日报被重交，不回写旧版本译文。
    const result = db.prepare(`UPDATE work_reports SET ${cacheColumn} = ? WHERE id = ?
      AND completed_items IS ? AND summary IS ? AND tomorrow_plan IS ? AND problems IS ?
      AND related_objects IS ? AND submitted_at IS ?`).run(
      zh, id, report.completed_items, report.summary, report.tomorrow_plan, report.problems,
      report.related_objects, report.submitted_at
    );
    if (!result.changes) return NextResponse.json({ error: "日报已更新，请刷新后重试" }, { status: 409 });
    return NextResponse.json({ [cacheColumn]: zh, cached: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败，请重试" }, { status: 502 });
  }
}
