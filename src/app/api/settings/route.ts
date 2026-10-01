import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getSystemSetting, setSystemSetting, logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";

// GET /api/settings — 读取系统设置（所有登录用户可读，用于侧栏/工作量的显隐判断）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  return NextResponse.json({
    agency_enabled: getSystemSetting("agency_enabled") === "1",
  });
}

// PATCH /api/settings — 修改系统设置（仅管理员）
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const body = await readJson(req);
  if (typeof body.agency_enabled !== "boolean") {
    return NextResponse.json({ error: "缺少 agency_enabled" }, { status: 400 });
  }

  setSystemSetting("agency_enabled", body.agency_enabled ? "1" : "0");
  logOperation(auth.name, "修改系统设置", "setting", "agency_enabled", `机构业务开关 = ${body.agency_enabled ? "开启" : "关闭"}`);
  return NextResponse.json({ agency_enabled: body.agency_enabled });
}
