// 聊天监控敏感词：涉及钱和人事的词，出现在聊天里要标记出来方便老板快速定位

export const SENSITIVE_WORDS = ["报价", "金额", "价格", "客户", "合同", "离职", "提成", "回扣"];

/** 文本里是否包含任一敏感词 */
export function containsSensitiveWord(text: string | null | undefined): boolean {
  const t = text || "";
  return SENSITIVE_WORDS.some((w) => t.includes(w));
}
