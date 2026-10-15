/** 读取主题 JSON 或数组，去除空主题、首尾空白和重复项。 */
export function parseMeetingTopics(raw: unknown): string[] {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((topic): topic is string => typeof topic === "string")
    .map((topic) => topic.trim()).filter(Boolean))];
}
