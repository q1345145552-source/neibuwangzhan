import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toThaiTime(utcStr: string | null | undefined): string {
  if (!utcStr) return "";
  const str = utcStr.includes("Z") || utcStr.includes("+") || (utcStr.match(/-/g) || []).length > 2 ? utcStr : utcStr + "Z";
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  const bangkok = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = bangkok.getUTCFullYear();
  const m = String(bangkok.getUTCMonth() + 1).padStart(2, "0");
  const day = String(bangkok.getUTCDate()).padStart(2, "0");
  const h = String(bangkok.getUTCHours()).padStart(2, "0");
  const min = String(bangkok.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

export function formatCurrency(amount: number | undefined | null, currency?: string): string {
  const sym = currency === "THB" ? "฿" : "¥";
  return `${sym}${(amount ?? 0).toLocaleString()}`;
}
