import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toThaiTime as _toThai, toThaiDate as _toThaiDate, bangkokDateStr } from "@/lib/time";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// toThaiTime / toThaiDate / bangkokDateStr 统一委托给 @/lib/time
export { _toThai as toThaiTime, _toThaiDate as toThaiDate, bangkokDateStr };

export function formatCurrency(amount: number | undefined | null, currency?: string): string {
  const sym = currency === "THB" ? "฿" : "¥";
  return `${sym}${(amount ?? 0).toLocaleString()}`;
}

// /api/files/* 现在需要鉴权，浏览器直接用 <img src>/<a href>/window.open 打开时
// 没法带 Authorization header，所以在 URL 上附带当前登录 token 作为查询参数。
export function fileUrl(url: string | null | undefined): string {
  if (!url) return "";
  if (!url.startsWith("/api/files/")) return url;
  if (typeof window === "undefined") return url;
  const token = localStorage.getItem("authToken");
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
