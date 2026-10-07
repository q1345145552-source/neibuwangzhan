import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { bangkokToday, toThaiTimeOnly } from "@/lib/time";

// GET /api/attendance/anomaly — 首页考勤异常（仅管理员/老板可见）
// 返回：今天迟到的人（曼谷打卡时间晚于 08:00）+ 今天还没打卡（且未请假）的在职员工
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看" }, { status: 403 });

  const db = getDb();
  const today = bangkokToday();

  // 今天所有已打卡记录
  const rows = db.prepare(
    "SELECT employee_name, check_in, type FROM attendance WHERE date = ? AND check_in != ''"
  ).all(today) as { employee_name: string; check_in: string; type: string }[];

  // 计算曼谷打卡时间 "HH:MM"；补签记录存的是曼谷时间，正常打卡存的是 UTC
  const bkkTime = (check_in: string, type: string): string => {
    if (type === "补签") {
      return (check_in.split(" ")[1] || "").slice(0, 5);
    }
    return toThaiTimeOnly(check_in);
  };

  // 迟到：曼谷打卡时间 > 08:00
  const late = rows
    .map((r) => ({ name: r.employee_name, time: bkkTime(r.check_in, r.type) }))
    .filter((r) => r.time && r.time > "08:00")
    .sort((a, b) => a.time.localeCompare(b.time));

  // 还没打卡：在职员工（排除老板/客户，Pop 不参与考勤），今天无打卡记录且未请假
  const employees = db.prepare(
    "SELECT name FROM employees WHERE role = 'employee' AND status = '在职' AND name != 'Pop'"
  ).all() as { name: string }[];
  const notClockedIn: string[] = [];
  for (const emp of employees) {
    const record = db.prepare(
      "SELECT check_in FROM attendance WHERE employee_name = ? AND date = ?"
    ).get(emp.name, today) as { check_in: string } | undefined;
    if (record?.check_in) continue;
    const leave = db.prepare(
      "SELECT id FROM leave_requests WHERE employee_name = ? AND status = '已通过' AND start_date <= ? AND end_date >= ?"
    ).get(emp.name, today, today);
    if (leave) continue;
    notClockedIn.push(emp.name);
  }

  return NextResponse.json({ late, notClockedIn });
}
