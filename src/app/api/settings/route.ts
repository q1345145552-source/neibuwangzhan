import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getSystemSetting, setSystemSetting, logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";

// API Key 只显示最后几位，前面用星号遮挡
function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return "****" + key.slice(-4);
}

// GET /api/settings — 读取系统设置（所有登录用户可读；AI 配置仅管理员可见，Key 已打码）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const result: Record<string, unknown> = {
    agency_enabled: getSystemSetting("agency_enabled") === "1",
  };
  if (auth.role === "admin") {
    const key = getSystemSetting("ai_api_key");
    result.ai = {
      provider: getSystemSetting("ai_provider"),
      model: getSystemSetting("ai_model"),
      api_base: getSystemSetting("ai_api_base"),
      api_key_masked: maskApiKey(key),
      has_key: !!key,
    };
  }
  return NextResponse.json(result);
}

// PATCH /api/settings — 修改系统设置（仅管理员）
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const body = await readJson(req);
  const updated: Record<string, unknown> = {};

  if (typeof body.agency_enabled === "boolean") {
    setSystemSetting("agency_enabled", body.agency_enabled ? "1" : "0");
    logOperation(auth.name, "修改系统设置", "setting", "agency_enabled", `机构业务开关 = ${body.agency_enabled ? "开启" : "关闭"}`);
    updated.agency_enabled = body.agency_enabled;
  }

  if (body.ai && typeof body.ai === "object") {
    const { provider, api_key, model, api_base } = body.ai as Record<string, unknown>;
    if (provider !== undefined) setSystemSetting("ai_provider", String(provider).trim());
    if (model !== undefined) setSystemSetting("ai_model", String(model).trim());
    if (api_base !== undefined) setSystemSetting("ai_api_base", String(api_base).trim());
    // Key 留空 = 不覆盖已保存的；填了新值才覆盖
    if (api_key !== undefined && String(api_key).trim() !== "") {
      setSystemSetting("ai_api_key", String(api_key).trim());
    }
    logOperation(auth.name, "修改系统设置", "setting", "ai", "AI 模型配置");
    updated.ai = { saved: true };
  }

  if (Object.keys(updated).length === 0) {
    return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  }
  return NextResponse.json(updated);
}
