import { NextRequest, NextResponse } from "next/server";
import { getDb, generateProblemNumber, logOperation, sendNotification } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { validateEnums } from "@/lib/enums";

// GET /api/problems — 问题列表（紧急的排前面）
// 支持筛选：status / problem_type / priority / assignee，可组合
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const problemType = searchParams.get("problem_type");
  const priority = searchParams.get("priority");
  const assignee = searchParams.get("assignee");
  const companyName = searchParams.get("company_name");

  let sql = "SELECT * FROM problems";
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) { conditions.push("status = ?"); params.push(status); }
  if (problemType) { conditions.push("problem_type = ?"); params.push(problemType); }
  if (priority) { conditions.push("priority = ?"); params.push(priority); }
  if (assignee) { conditions.push("assignee = ?"); params.push(assignee); }
  if (companyName) { conditions.push("company_name = ?"); params.push(companyName); }

  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY CASE priority WHEN '紧急' THEN 0 ELSE 1 END, created_at DESC";

  const rows = db.prepare(sql).all(...params);
  return NextResponse.json(rows);
}

// POST /api/problems — 新建问题（自动生成问题编号）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const { company_name, problem_type, assignee, priority, description, source, customer_requirement, deadline } = body;

  if (!company_name?.trim()) return NextResponse.json({ error: "请填写公司名" }, { status: 400 });
  if (!description?.trim()) return NextResponse.json({ error: "请填写问题描述" }, { status: 400 });
  if (!assignee?.trim()) return NextResponse.json({ error: "请选择负责人" }, { status: 400 });
  if (!source?.trim()) return NextResponse.json({ error: "请选择来源" }, { status: 400 });

  const enumErr = validateEnums({
    "problems.problem_type": problem_type,
    "problems.priority": priority,
    "problems.source": source,
  });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  const problemNumber = generateProblemNumber();
  const result = db.prepare(
    "INSERT INTO problems (problem_number, company_name, problem_type, status, assignee, priority, source, description, customer_requirement, deadline, created_by) VALUES (?, ?, ?, '待处理', ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    problemNumber,
    company_name.trim(),
    problem_type || "税务问题",
    assignee.trim(),
    priority || "普通",
    source.trim(),
    description.trim(),
    customer_requirement || "",
    deadline || "",
    auth.name
  );

  const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "新建问题", "problem", String(result.lastInsertRowid), `编号:${problemNumber}`);

  // 通知联动：指派问题给员工时，自动给该员工发通知
  if (assignee.trim() !== auth.name) {
    sendNotification(
      "problem_assigned",
      "新问题指派",
      `问题 ${problemNumber}（${company_name.trim()}）已指派给你，请尽快跟进`,
      assignee.trim(),
      String(result.lastInsertRowid),
      "problem"
    );
  }

  return NextResponse.json(problem, { status: 201 });
}
