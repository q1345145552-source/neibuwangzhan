"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { notifyOpenChat, type ChatOpenTarget } from "@/lib/chat-nav";

interface Toast {
  id: number;
  title: string;
  body: string;
  target: ChatOpenTarget;
}

let toastSeq = 0;

// 消息提示音（叮咚）：放在 public/sounds 下，随应用静态资源一起部署
const MESSAGE_SOUND_URL = "/sounds/message.wav";
let messageAudio: HTMLAudioElement | null = null;

// 播放「叮咚」提示音；浏览器未放行自动播放时静默失败（用户点过页面后即可正常响）
function playMessageSound(): void {
  if (typeof window === "undefined") return;
  try {
    if (!messageAudio) messageAudio = new Audio(MESSAGE_SOUND_URL);
    messageAudio.currentTime = 0;
    void messageAudio.play().catch(() => {});
  } catch { /* 忽略不支持的环境 */ }
}

// 全局消息提醒：轮询联系人 + 群，检测「别人发来的新消息」，
// 在页面右下角弹气泡 + 发浏览器系统通知 + 播放提示音（首次会请求通知权限）。
export function ChatNotifier() {
  const { user } = useAuth();
  const me = user?.name || "";
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const initializedRef = useRef(false);
  const prevUnreadRef = useRef<Map<string, number>>(new Map());
  const prevGroupKeyRef = useRef<Map<number, string>>(new Map());
  const permRequestedRef = useRef(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // 跳转：先发「打开会话」信号，再确保在消息页（已在消息页则直接切换，否则跳过去）
  const jumpTo = useCallback(
    (target: ChatOpenTarget) => {
      notifyOpenChat(target);
      router.push("/messages");
    },
    [router]
  );

  const pushToast = useCallback((title: string, body: string, target: ChatOpenTarget) => {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, title, body, target }]);
    // 几秒后自动消失
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timersRef.current.delete(timer);
    }, 5000);
    timersRef.current.add(timer);
  }, []);

  const closeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 首次请求浏览器通知权限（浏览器弹原生「允许 / 阻止」）
  const ensurePermission = useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default" && !permRequestedRef.current) {
      permRequestedRef.current = true;
      try {
        Notification.requestPermission().catch(() => {});
      } catch { /* 忽略不支持的环境 */ }
    }
  }, []);

  const fireSystemNotification = useCallback(
    (title: string, body: string, target: ChatOpenTarget) => {
      if (typeof window === "undefined" || !("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body });
        n.onclick = () => {
          window.focus();
          jumpTo(target);
          n.close();
        };
      } catch { /* 忽略 */ }
    },
    [jumpTo]
  );

  // 卸载时清掉还没到期的自动消失定时器
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // 首次用户交互时「解锁」音频自动播放（播放策略：交互前可能被浏览器拦截）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      try {
        if (!messageAudio) messageAudio = new Audio(MESSAGE_SOUND_URL);
        messageAudio.muted = true;
        void messageAudio.play()
          .then(() => {
            if (messageAudio) {
              messageAudio.pause();
              messageAudio.currentTime = 0;
              messageAudio.muted = false;
            }
          })
          .catch(() => {});
      } catch { /* 忽略 */ }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // 轮询联系人 + 群：检测新消息并弹提醒
  useEffect(() => {
    if (!me) return;
    ensurePermission();
    let active = true;

    const poll = async () => {
      try {
        const [cRes, gRes] = await Promise.all([
          fetchWithAuth("/api/chat/contacts", { cache: "no-store" }),
          fetchWithAuth("/api/chat/groups", { cache: "no-store" }),
        ]);
        if (!active) return;
        const contacts: any[] = cRes.ok ? await cRes.json().catch(() => []) : [];
        const groups: any[] = gRes.ok ? await gRes.json().catch(() => []) : [];

        if (!initializedRef.current) {
          // 首次只记录基线，不把「历史未读」当成新消息弹一屏
          prevUnreadRef.current = new Map(contacts.map((c) => [c.name, c.unread || 0]));
          prevGroupKeyRef.current = new Map(groups.map((g) => [g.id, `${g.last_at}|${g.last_sender}`]));
          initializedRef.current = true;
          return;
        }

        // 1:1 新消息：该联系人未读数增加
        for (const c of contacts) {
          const prev = prevUnreadRef.current.get(c.name) ?? 0;
          const cur = c.unread || 0;
          if (cur > prev) {
            const title = `${c.name} 给你发来消息`;
            const body = c.last_preview || "";
            const target: ChatOpenTarget = { kind: "direct", name: c.name };
            pushToast(title, body, target);
            fireSystemNotification(title, body, target);
            playMessageSound();
          }
          prevUnreadRef.current.set(c.name, cur);
        }

        // 群新消息：群最后一条消息变化，且不是自己发的；免打扰的群不弹提醒/不响铃
        for (const g of groups) {
          const key = `${g.last_at}|${g.last_sender}`;
          const prevKey = prevGroupKeyRef.current.get(g.id);
          const isNew = prevKey !== undefined && prevKey !== key && g.last_sender && g.last_sender !== me;
          if (isNew && !g.muted) {
            const title = `群「${g.name}」：${g.last_sender} 发来消息`;
            const body = g.last_preview || "";
            const target: ChatOpenTarget = { kind: "group", id: Number(g.id), name: g.name };
            pushToast(title, body, target);
            fireSystemNotification(title, body, target);
            playMessageSound();
          }
          prevGroupKeyRef.current.set(g.id, key);
        }
      } catch { /* 轮询失败静默，下一轮重试 */ }
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [me, ensurePermission, pushToast, fireSystemNotification]);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 shadow-lg"
        >
          <button
            onClick={() => jumpTo(t.target)}
            className="min-w-0 flex-1 text-left"
            title="点击查看聊天"
          >
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{t.title}</p>
            {t.body && <p className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">{t.body}</p>}
          </button>
          <button
            onClick={() => closeToast(t.id)}
            aria-label="关闭提醒"
            className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
