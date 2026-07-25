import { fetchWithAuth } from "./api";

/**
 * 带错误提示的写请求封装。
 *
 * 项目里有二十多处写操作是这么写的：
 *   await fetchWithAuth(url, {...});
 *   reload();
 * 既不看 res.ok 也不 catch —— 后端返回 400/403（比如"仅管理员可审批请假"、
 * "无效的状态值"）时，页面上什么都不会发生，用户只知道"点了没反应"。
 *
 * 用法：
 *   const ok = await apiCall("/api/leave", { method: "PATCH", body: {...} });
 *   if (ok) reload();
 *
 * 失败时默认弹出后端返回的 error 文案。要接页面自己的错误条就传 onError。
 */
export async function apiCall(
  url: string,
  options: { method?: string; body?: unknown; onError?: (msg: string) => void } = {}
): Promise<boolean> {
  const { method = "POST", body, onError } = options;
  try {
    const res = await fetchWithAuth(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data?.error || `操作失败（HTTP ${res.status}）`;
      if (onError) onError(msg);
      else alert(msg);
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误，请重试";
    if (onError) onError(msg);
    else alert(msg);
    return false;
  }
}
