"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/components/auth-provider";
import type { BossPendingItem } from "./boss-submissions";
import type { BossPendingCategory } from "./boss-submission-types";

interface PendingData {
  generated_at: string;
  total: number;
  counts: Record<BossPendingCategory, number>;
  items: BossPendingItem[];
}
interface Snapshot { data: PendingData | null; loading: boolean; error: string }
const EMPTY: Snapshot = { data: null, loading: false, error: "" };
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;
const noRefresh = async () => {};

// 侧栏和看板共享同一份结果和在途请求，避免重复轮询整份清单；按登录凭证隔离。
function createStore(token: string) {
  let snapshot = EMPTY;
  let request: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const update = (next: Snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const refresh = (): Promise<void> => {
    if (request) return request;
    const run = ++generation;
    controller = new AbortController();
    update({ ...snapshot, loading: true, error: "" });
    request = fetch("/api/boss-supervision/pending", { cache: "no-store", signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "加载待处理清单失败，请重试");
        if (!Number.isSafeInteger(body.total) || body.total < 0 || !Array.isArray(body.items)) throw new Error("待处理清单格式异常，请重试");
        if (run === generation) update({ data: body as PendingData, loading: false, error: "" });
      })
      .catch(error => {
        if (run === generation) update({ ...snapshot, loading: false, error: error instanceof Error ? error.message : "加载待处理清单失败，请重试" });
      })
      .finally(() => { if (run === generation) request = null; });
    return request;
  };
  const whenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void refresh();
        timer = setInterval(whenVisible, 30_000);
        window.addEventListener("focus", whenVisible);
        document.addEventListener("visibilitychange", whenVisible);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearInterval(timer);
          window.removeEventListener("focus", whenVisible);
          document.removeEventListener("visibilitychange", whenVisible);
          ++generation;
          controller?.abort();
          request = null;
          snapshot = { ...snapshot, loading: false };
        }
      };
    },
  };
}
const stores = new Map<string, ReturnType<typeof createStore>>();

export function useBossPending() {
  const { user, token } = useAuth();
  const store = useMemo(() => {
    if (user?.role !== "admin" || !token) return null;
    if (!stores.has(token)) stores.set(token, createStore(token));
    return stores.get(token)!;
  }, [user?.role, token]);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return { ...snapshot, refresh: store?.refresh ?? noRefresh };
}
