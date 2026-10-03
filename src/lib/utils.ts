import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toThaiTime as _toThai, toThaiDate as _toThaiDate, bangkokDateStr } from "@/lib/time";
import { getStoredAuthToken } from "@/lib/auth-storage";

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
  const token = getStoredAuthToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

// 出生日期（YYYY-MM-DD）对应的西方星座，自动算
export function zodiacFromBirthDate(birthDate: string): string {
  const m = (birthDate || "").match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const month = Number(m[1]);
  const day = Number(m[2]);
  const boundaries: [number, number, string][] = [
    [1, 20, "水瓶座"], [2, 19, "双鱼座"], [3, 21, "白羊座"], [4, 20, "金牛座"],
    [5, 21, "双子座"], [6, 21, "巨蟹座"], [7, 23, "狮子座"], [8, 23, "处女座"],
    [9, 23, "天秤座"], [10, 23, "天蝎座"], [11, 22, "射手座"], [12, 22, "摩羯座"],
  ];
  let zodiac = "摩羯座";
  for (const [bm, bd, name] of boundaries) {
    if (month > bm || (month === bm && day >= bd)) zodiac = name;
  }
  return zodiac;
}
