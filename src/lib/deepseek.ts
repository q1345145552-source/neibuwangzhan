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
