import { NextRequest, NextResponse } from "next/server";
import { getDb, generateProblemNumber, logOperation } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { validateEnums } from "@/lib/enums";

// GET /api/problems — 问题列表（紧急的排前面）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM problems ORDER BY CASE priority WHEN '紧急' THEN 0 ELSE 1 END, created_at DESC"
  ).all();
  return NextResponse.json(rows);
}

// POST /api/problems — 新建问题（自动生成问题编号）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const { company_name, problem_type, assignee, priority, description } = body;

  if (!company_name?.trim()) return NextResponse.json({ error: "请填写公司名" }, { status: 400 });

  const enumErr = validateEnums({
    "problems.problem_type": problem_type,
    "problems.priority": priority,
  });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  const problemNumber = generateProblemNumber();
  const result = db.prepare(
    "INSERT INTO problems (problem_number, company_name, problem_type, status, assignee, priority, description, created_by) VALUES (?, ?, ?, '待处理', ?, ?, ?, ?)"
  ).run(
    problemNumber,
    company_name.trim(),
    problem_type || "税务问题",
    assignee || "",
    priority || "普通",
    description || "",
    auth.name
  );

  const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(result.lastInsertRowid);
  logOperation(auth.name, "新建问题", "problem", String(result.lastInsertRowid), `编号:${problemNumber}`);
  return NextResponse.json(problem, { status: 201 });
}
