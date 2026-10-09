// DeepSeek 大模型调用封装（OpenAI 兼容接口）
// 用途：把一段聊天记录发给大模型，总结成四块内容（话题/结论/待办/承诺）。
// 模型供应商 / API Key / 模型名 / 接口地址 全部从系统设置表读取（每次调用即时读取，改完即生效）。

import { getSystemSetting } from "./db";

export interface ChatSummary {
  topics: string;
  conclusions: string;
  todos: string;
  commitments: string;
}

/** 请假 AI 分析结果 */
export interface LeaveAnalysis {
  judgment: "建议批准" | "谨慎" | "建议不批准";
  /** 简短理由（一句话，用于列表标签） */
  reason: string;
  /** 详细分析（为什么这么判断、结合了哪些情况） */
  detail: string;
}

/** 员工状态评估结果 */
export interface EmployeeStatusAssessment {
  level: "稳定" | "需关注" | "高风险";
  reason: string;
}

const SYSTEM_PROMPT = `你是湘泰内部管理系统的聊天记录总结助手。请把下面这段聊天记录总结成四块内容，并且只输出一个 JSON 对象，字段固定为：
- topics：聊了什么话题
- conclusions：有什么结论（达成的共识或决定）
- todos：待办事项（谁要做什么）
- commitments：承诺约定（谁答应了什么）

要求：
1. 只输出一个 JSON 对象，不要输出任何其它文字，也不要包在 markdown 代码块里。
2. 每个字段用中文；没有相关内容时填「无」。
3. 内容精炼，用短句或要点（换行分隔），不要照抄原文。`;

// 把模型的任意返回值规整成字符串（支持模型返回 string / array / number）
function toString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((x) => String(x)).join("\n").trim();
  if (v == null) return "";
  return String(v).trim();
}

// 读取 AI 模型配置（聊天总结、翻译共用同一套配置，每次即时读取）
function getAiConfig() {
  const apiKey = getSystemSetting("ai_api_key").trim();
  if (!apiKey) throw new Error("未配置 AI Key，请到「系统设置 → AI 配置」填写后重试");
  return {
    apiKey,
    apiBase: getSystemSetting("ai_api_base").trim() || "https://api.deepseek.com/chat/completions",
    model: getSystemSetting("ai_model").trim() || "deepseek-chat",
  };
}

/** 把一段文字翻译成目标语言（中文 / 泰语），返回翻译结果文本 */
export async function translateText(text: string, target: "中文" | "泰语"): Promise<string> {
  const { apiKey, apiBase, model } = getAiConfig();
  const res = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `你是一个翻译助手。把用户发来的文字翻译成${target}。只输出翻译结果本身，不要输出任何解释、注释、引号或原文。` },
        { role: "user", content: text },
      ],
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`DeepSeek 调用失败（${res.status}）：${t.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  const raw: unknown = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek 返回内容为空");
  return raw.trim();
}

/** 把一段纯文本聊天记录发给大模型，返回四块总结 */
export async function summarizeChatTranscript(transcript: string): Promise<ChatSummary> {
  const { apiKey, apiBase, model } = getAiConfig();

  const res = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek 调用失败（${res.status}）：${text.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => null);
  const raw: unknown = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek 返回内容为空");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 兜底：模型偶尔会把 JSON 包在 ```json ... ``` 里
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  return {
    topics: toString(obj.topics) || "无",
    conclusions: toString(obj.conclusions) || "无",
    todos: toString(obj.todos) || "无",
    commitments: toString(obj.commitments) || "无",
  };
}

const LEAVE_ANALYSIS_PROMPT = `你是湘泰内部管理系统的请假审批分析助手。请根据员工的本次请假理由、请假日期、历史请假记录、个人情况和团队人手情况，给出三档审批建议，并给出简短理由和详细分析。

三档建议：
- 建议批准：请假理由合理、历史记录正常、个人情况吻合、该时段人手不紧张，可以批准。
- 谨慎：有条件批准，可以批但要注意一些情况（例如理由不够充分、历史请假偏多、个人存在风险因素、或该时段团队已有多人请假导致人手紧张等），建议批准时留意或补充说明。
- 建议不批准：理由含糊或前后矛盾、历史请假明显异常、存在较大风险，建议不批准。

团队人手情况：会给出这次请假日期范围内已有多少人的请假是「已通过」状态；人数越多说明该时段越可能人手紧张，越要谨慎。

判断参考：
- 历史请假频率是否异常（如每周五都请事假、频繁周一/周五请假、总是连着节假日请假）。
- 请假理由是否含糊、前后矛盾或过于笼统。
- 是否与个人情况吻合（如家庭有事、感情不稳定、父母需照顾、工作压力大等）。
- 日期是否可疑（如节假日前后、发薪日、周末前后等）。
- 团队人手：该时段已通过请假的人数，人多则要谨慎。

要求：
1. 只输出一个 JSON 对象，字段固定为：
   - judgment：判断结果，只能是「建议批准」或「谨慎」或「建议不批准」
   - reason：简短理由（中文，一句话，用于列表标签）
   - detail：详细分析（中文，2-4 句话，说明为什么这么判断、结合了哪些情况，包括历史请假频率、个人情况、请假日期、团队人手等）
2. 不要输出任何其它文字，也不要包在 markdown 代码块里。`;

/** 分析一次请假：三档审批建议（输入含请假理由/日期/历史/个人情况/团队人手） */
export async function analyzeLeaveRequest(input: {
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string;
  history: string;
  personal: string;
  team: string;
}): Promise<LeaveAnalysis> {
  const { apiKey, apiBase, model } = getAiConfig();

  const userContent = [
    `员工：${input.employeeName}`,
    `本次请假：${input.leaveType}，${input.startDate} ~ ${input.endDate}，理由：${input.reason || "无"}`,
    ``,
    `历史请假记录：`,
    input.history || "（无历史记录）",
    ``,
    `员工个人情况：`,
    input.personal || "（无记录）",
    ``,
    `团队人手情况：`,
    input.team || "（无信息）",
  ].join("\n");

  const res = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: LEAVE_ANALYSIS_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek 调用失败（${res.status}）：${text.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => null);
  const raw: unknown = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek 返回内容为空");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const judgmentRaw = toString(obj.judgment);
  const judgment: "建议批准" | "谨慎" | "建议不批准" =
    judgmentRaw.includes("不批准") ? "建议不批准" :
    judgmentRaw.includes("谨慎") ? "谨慎" : "建议批准";
  return {
    judgment,
    reason: toString(obj.reason) || judgment,
    detail: toString(obj.detail) || toString(obj.reason) || "（无详细说明）",
  };
}

const STATUS_ASSESSMENT_PROMPT = `你是湘泰内部管理系统的员工状态评估助手。请根据员工的家庭情况、感情情况、健康情况、工作情况以及请假记录，评估这个员工当前的状态，输出分级和评估理由。

分级标准：
- 稳定：各方面正常，没有明显风险因素。
- 需关注：存在需要关注的因素（如感情不稳定、伴侣无业、家庭经济困难、近期请假偏多等）。
- 高风险：存在较严重的风险因素（如多重负面因素叠加、健康问题严重、频繁请假、情绪/家庭危机等）。

要求：
1. 只输出一个 JSON 对象，字段固定为：
   - level：只能是「稳定」或「需关注」或「高风险」
   - reason：评估理由（中文，说明判断依据并给出建议，例如「该员工感情不稳定、伴侣无业、近期请假偏多，建议多关心沟通」）
2. 不要输出任何其它文字，也不要包在 markdown 代码块里。`;

/** 评估员工状态：稳定 / 需关注 / 高风险（输入家庭/感情/健康/工作/请假） */
export async function assessEmployeeStatus(input: {
  employeeName: string;
  family: string;
  relationship: string;
  health: string;
  work: string;
  leave: string;
}): Promise<EmployeeStatusAssessment> {
  const { apiKey, apiBase, model } = getAiConfig();

  const userContent = [
    `员工：${input.employeeName}`,
    ``,
    `家庭情况：${input.family || "无"}`,
    `感情情况：${input.relationship || "无"}`,
    `健康情况：${input.health || "无"}`,
    `工作情况：${input.work || "无"}`,
    ``,
    `请假记录：${input.leave || "无"}`,
  ].join("\n");

  const res = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: STATUS_ASSESSMENT_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek 调用失败（${res.status}）：${text.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => null);
  const raw: unknown = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek 返回内容为空");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const levelRaw = toString(obj.level);
  const level: "稳定" | "需关注" | "高风险" = levelRaw.includes("高风险") ? "高风险" : levelRaw.includes("关注") ? "需关注" : "稳定";
  return {
    level,
    reason: toString(obj.reason) || (level === "稳定" ? "各方面正常" : level === "需关注" ? "存在需要关注的因素" : "存在高风险因素"),
  };
}

/** 通知复述比对结果 */
export interface RetellCompareResult {
  conclusion: string;
}

const RETELL_COMPARE_PROMPT = `你是湘泰内部管理系统的通知理解比对助手。请对比「通知原文」和「员工的中文复述」，判断员工是否准确理解了通知要求，并给出简明的比对结论。

要求：
1. 用简洁中文，逐条列出：
   - 理解有偏差的地方（员工理解错了什么）
   - 有遗漏的地方（通知里要求了、但员工没提到）
2. 如果理解准确、没有偏差和遗漏，就输出「理解准确，无明显偏差或遗漏」。
3. 直接输出文字，不要 JSON，不要 markdown 代码块，2-5 条以内，每条简短。`;

/** 比对通知原文和员工中文复述，返回理解偏差/遗漏的结论 */
export async function compareRetell(noticeBody: string, retellZh: string): Promise<RetellCompareResult> {
  const { apiKey, apiBase, model } = getAiConfig();
  const userContent = [
    `通知原文：`,
    noticeBody || "（空）",
    ``,
    `员工的中文复述：`,
    retellZh || "（空）",
  ].join("\n");

  const res = await fetch(apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: RETELL_COMPARE_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek 调用失败（${res.status}）：${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  const raw: unknown = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DeepSeek 返回内容为空");
  return { conclusion: raw.trim() };
}
