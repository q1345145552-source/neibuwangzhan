"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { cn, toThaiTime } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

interface Contact {
  name: string;
  role: string;
}

interface Message {
  id: number;
  conversation_id: number | null;
  group_id: number | null;
  sender: string;
  receiver: string;
  content: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
}

export default function MessagesPage() {
  const { user } = useAuth();
  const me = user?.name || "";

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 联系人列表：在职员工（不含自己）
  useEffect(() => {
    let active = true;
    fetchWithAuth("/api/chat/contacts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active && Array.isArray(d)) setContacts(d); })
      .catch(() => {})
      .finally(() => { if (active) setContactsLoading(false); });
    return () => { active = false; };
  }, []);

  // 打开会话：拉取历史消息，并把游标归零
  const openChat = useCallback((name: string) => {
    setSelected(name);
    setMessages([]);
    setInput("");
    setError(null);
    cursorRef.current = 0;
    fetchWithAuth(`/api/chat?other=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.messages)) {
          setMessages(d.messages);
          cursorRef.current = d.messages.reduce((m: number, x: Message) => Math.max(m, x.id), 0);
        }
      })
      .catch(() => {});
  }, []);

  // 实时轮询：每 1 秒拉取游标之后的新消息，对方发来无需刷新即可看到
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await fetchWithAuth(
          `/api/chat?other=${encodeURIComponent(selected)}&after=${cursorRef.current}`,
          { cache: "no-store" }
        );
        if (!r.ok) return;
        const d = await r.json();
        if (active && Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages((prev) => {
            const map = new Map<number, Message>(prev.map((m) => [m.id, m]));
            for (const m of d.messages as Message[]) map.set(m.id, m);
            return [...map.values()].sort((a, b) => a.id - b.id);
          });
          const maxId = (d.messages as Message[]).reduce((m, x) => Math.max(m, x.id), 0);
          cursorRef.current = Math.max(cursorRef.current, maxId);
        }
      } catch { /* 轮询失败静默，下一轮重试 */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { active = false; clearInterval(id); };
  }, [selected]);

  // 新消息自动滚到底部
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 发送文字消息：自己发出去的立刻上屏
  const send = async () => {
    const text = input.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetchWithAuth("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ other: selected, content: text }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.message) {
        const msg = d.message as Message;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].sort((a, b) => a.id - b.id)));
        cursorRef.current = Math.max(cursorRef.current, msg.id);
        setInput("");
      } else {
        setError(d?.error || "发送失败");
      }
    } catch {
      setError("发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">消息</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">内部聊天</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* 联系人列表 */}
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-medium text-[var(--foreground)]">员工</h2>
          </div>
          <div className="max-h-[40vh] overflow-y-auto p-2 lg:max-h-[70vh]">
            {contactsLoading ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : contacts.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无员工</p>
            ) : (
              contacts.map((c) => (
                <button
                  key={c.name}
                  onClick={() => openChat(c.name)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    selected === c.name
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                      selected === c.name
                        ? "bg-[var(--primary-foreground)]/20 text-[var(--primary-foreground)]"
                        : "bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-[var(--primary)]"
                    )}
                  >
                    {c.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className={cn("block text-xs", selected === c.name ? "opacity-80" : "text-[var(--muted-foreground)]")}>
                      {c.role === "admin" ? "管理员" : "员工"}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 聊天窗口 */}
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-sm font-medium text-[var(--primary)]">
                  {selected.charAt(0)}
                </span>
                <p className="text-sm font-medium text-[var(--foreground)]">{selected}</p>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <MessageSquare className="size-8 text-[var(--muted-foreground)]/40" />
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">还没有消息，发一句打个招呼吧</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender === me;
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                            mine
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                              : "bg-[var(--muted)] text-[var(--foreground)]"
                          )}
                        >
                          <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          <p className={cn("mt-1 text-[0.6rem]", mine ? "text-[var(--primary-foreground)]/70" : "text-[var(--muted-foreground)]")}>
                            {toThaiTime(m.created_at) || "—"}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && <p className="px-4 pt-2 text-xs text-red-500">{error}</p>}

              <div className="flex gap-2 border-t border-[var(--border)] p-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={`发消息给 ${selected}`}
                  className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="shrink-0 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity disabled:opacity-50"
                >
                  {sending ? "发送中…" : "发送"}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <MessageSquare className="size-10 text-[var(--muted-foreground)]/40" />
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">选择一个员工开始聊天</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
