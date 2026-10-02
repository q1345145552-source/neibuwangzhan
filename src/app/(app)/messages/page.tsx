"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X, Users, ImagePlus, FileText } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { cn, toThaiTime } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

interface Contact {
  name: string;
  role: string;
  last_at: string | null;
  last_preview: string | null;
  last_sender: string | null;
  unread: number;
}

interface Group {
  id: number;
  name: string;
  owner: string;
  members: string[];
  last_at: string | null;
  last_preview: string | null;
  last_sender: string | null;
  unread: number;
}

interface Message {
  id: number;
  conversation_id: number | null;
  group_id: number | null;
  sender: string;
  receiver: string;
  content: string;
  image_url: string;
  order_id: string;
  is_read: number;
  read_at: string | null;
  created_at: string;
}

// 当前打开的聊天对象：要么是一对一（员工名），要么是群
type ChatTarget =
  | { kind: "direct"; name: string }
  | { kind: "group"; id: number; name: string };

// /api/files 的图片需要带 token（<img> 标签无法带 Authorization 头）
function imgSrc(url: string): string {
  const token = getStoredAuthToken();
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token || "")}`;
}

// 会话列表时间：今天显示 HH:mm，更早显示 MM-DD
function fmtListTime(utc: string | null): string {
  if (!utc) return "";
  const t = toThaiTime(utc);
  if (!t) return "";
  const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split("T")[0];
  if (t.slice(0, 10) === today) return t.slice(11, 16);
  return t.slice(5, 10);
}

export default function MessagesPage() {
  const { user } = useAuth();
  const me = user?.name || "";
  const router = useRouter();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<ChatTarget | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showOrders, setShowOrders] = useState(false);
  const [orders, setOrders] = useState<{ id: string; customer_name: string }[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // 建群弹窗
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 联系人列表：在职员工（不含自己），带最后消息和未读
  const loadContacts = useCallback(() => {
    fetchWithAuth("/api/chat/contacts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setContacts(d); })
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, []);

  // 群列表
  const loadGroups = useCallback(() => {
    fetchWithAuth("/api/chat/groups", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setGroups(d); })
      .catch(() => {});
  }, []);

  // 初次加载 + 每 3 秒轮询：新消息/新群/已读 都会实时更新会话列表排序、预览和未读
  useEffect(() => {
    loadContacts();
    loadGroups();
    const id = setInterval(() => { loadContacts(); loadGroups(); }, 3000);
    return () => clearInterval(id);
  }, [loadContacts, loadGroups]);

  // 会话列表：一对一 + 群聊 合并，按最后一条消息时间倒序（没消息的沉底）
  const conversationList = useMemo(() => {
    const items = [
      ...contacts.map((c) => ({
        kind: "direct" as const,
        id: c.name,
        name: c.name,
        lastAt: c.last_at,
        lastSender: c.last_sender,
        lastPreview: c.last_preview,
        unread: c.unread || 0,
      })),
      ...groups.map((g) => ({
        kind: "group" as const,
        id: String(g.id),
        name: g.name,
        lastAt: g.last_at,
        lastSender: g.last_sender,
        lastPreview: g.last_preview,
        unread: 0,
      })),
    ];
    return items.sort((a, b) => {
      const ta = a.lastAt || "";
      const tb = b.lastAt || "";
      if (ta !== tb) return ta > tb ? -1 : 1;
      return a.name.localeCompare(b.name, "zh");
    });
  }, [contacts, groups]);

  // 合并消息（按 id 去重 + 升序），并推进游标
  const mergeIncoming = useCallback((incoming: Message[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const map = new Map<number, Message>(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.id - b.id);
    });
    const maxId = incoming.reduce((m, x) => Math.max(m, x.id), 0);
    cursorRef.current = Math.max(cursorRef.current, maxId);
  }, []);

  // 把我发出去、对方已读的消息标记为已读（发送方显示「已读」）
  const applyReadIds = useCallback((ids: number[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => (set.has(m.id) && m.is_read !== 1 ? ((changed = true), { ...m, is_read: 1 }) : m));
      return changed ? next : prev;
    });
  }, []);

  // 打开一对一会话
  const openDirect = useCallback((name: string) => {
    setSelected({ kind: "direct", name });
    setMessages([]);
    setInput("");
    setError(null);
    cursorRef.current = 0;
    fetchWithAuth(`/api/chat?other=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.messages)) mergeIncoming(d.messages);
        if (d && Array.isArray(d.readMessageIds)) applyReadIds(d.readMessageIds);
      })
      .catch(() => {});
  }, [mergeIncoming, applyReadIds]);

  // 打开群会话
  const openGroup = useCallback((id: number, name: string) => {
    setSelected({ kind: "group", id, name });
    setMessages([]);
    setInput("");
    setError(null);
    cursorRef.current = 0;
    fetchWithAuth(`/api/chat/group-messages?group_id=${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.messages)) mergeIncoming(d.messages); })
      .catch(() => {});
  }, [mergeIncoming]);

  // 实时轮询：每 1 秒拉取游标之后的新消息（文字/图片都实时）
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const tick = async () => {
      try {
        const url = selected.kind === "direct"
          ? `/api/chat?other=${encodeURIComponent(selected.name)}&after=${cursorRef.current}`
          : `/api/chat/group-messages?group_id=${selected.id}&after=${cursorRef.current}`;
        const r = await fetchWithAuth(url, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (active) {
          if (Array.isArray(d.messages)) mergeIncoming(d.messages);
          if (Array.isArray(d.readMessageIds)) applyReadIds(d.readMessageIds);
        }
      } catch { /* 轮询失败静默，下一轮重试 */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { active = false; clearInterval(id); };
  }, [selected, mergeIncoming, applyReadIds]);

  // 新消息自动滚到底部
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 发一条消息（文字或图片），自己发出去的立刻上屏
  const postMessage = async (content: string, imageUrl: string, orderId: string): Promise<boolean> => {
    if (!selected) return false;
    const isDirect = selected.kind === "direct";
    const url = isDirect ? "/api/chat" : "/api/chat/group-messages";
    const body = isDirect
      ? { other: selected.name, content, image_url: imageUrl, order_id: orderId }
      : { group_id: selected.id, content, image_url: imageUrl, order_id: orderId };
    try {
      const r = await fetchWithAuth(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.message) {
        const msg = d.message as Message;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].sort((a, b) => a.id - b.id)));
        cursorRef.current = Math.max(cursorRef.current, msg.id);
        return true;
      }
      setError(d?.error || "发送失败");
      return false;
    } catch {
      setError("发送失败");
      return false;
    }
  };

  const sendText = async () => {
    const text = input.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setError(null);
    const ok = await postMessage(text, "", "");
    setSending(false);
    if (ok) setInput("");
  };

  // 选图片 → 上传 → 作为图片消息发出
  const handleImagePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !selected || sending) return;
    if (!file.type.startsWith("image/")) { setError("只能发送图片"); return; }
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.url) {
        await postMessage("", d.url, "");
      } else {
        setError(d?.error || "图片上传失败");
      }
    } catch {
      setError("图片上传失败");
    } finally {
      setSending(false);
    }
  };

  const toggleMember = (name: string) => {
    setSelectedMembers((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  // 打开订单选择器
  const openOrderPicker = () => {
    setShowOrders(true);
    setOrdersLoading(true);
    setOrdersError(null);
    fetchWithAuth("/api/orders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d)) setOrders(d.map((o: any) => ({ id: o.id, customer_name: o.customer_name })));
        else setOrders([]);
      })
      .catch(() => setOrdersError("加载订单失败"))
      .finally(() => setOrdersLoading(false));
  };

  // 发一条订单卡片消息
  const sendOrder = async (orderId: string) => {
    setShowOrders(false);
    setSending(true);
    setError(null);
    await postMessage("", "", orderId);
    setSending(false);
  };

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) { setCreateError("请填写群名称"); return; }
    if (selectedMembers.length === 0) { setCreateError("请至少勾选一名成员"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetchWithAuth("/api/chat/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, members: selectedMembers }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.group) {
        setShowCreate(false);
        setGroupName("");
        setSelectedMembers([]);
        loadGroups();
        openGroup(d.group.id, d.group.name);
      } else {
        setCreateError(d?.error || "创建失败");
      }
    } catch {
      setCreateError("创建失败");
    } finally {
      setCreating(false);
    }
  };

  const isGroup = selected?.kind === "group";
  const isDirect = selected?.kind === "direct";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">消息</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">内部聊天</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* 左侧：群聊 + 员工列表 */}
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
            <h2 className="text-sm font-medium text-[var(--foreground)]">会话</h2>
            <button
              onClick={() => { setShowCreate(true); setCreateError(null); }}
              className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
            >
              新建群聊
            </button>
          </div>
          <div className="max-h-[40vh] overflow-y-auto p-2 lg:max-h-[70vh]">
            {contactsLoading ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : conversationList.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无会话</p>
            ) : (
              conversationList.map((item) => {
                const active = item.kind === "direct"
                  ? selected?.kind === "direct" && selected.name === item.id
                  : selected?.kind === "group" && selected.id === Number(item.id);
                return (
                  <button
                    key={item.kind + item.id}
                    onClick={() => item.kind === "direct" ? openDirect(item.id) : openGroup(Number(item.id), item.name)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "text-[var(--foreground)] hover:bg-[var(--muted)]"
                    )}
                  >
                    <span className={cn(
                      "flex size-9 shrink-0 items-center justify-center text-sm font-medium",
                      item.kind === "group" ? "rounded-lg" : "rounded-full",
                      active ? "bg-[var(--primary-foreground)]/20 text-[var(--primary-foreground)]" : "bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-[var(--primary)]"
                    )}>
                      {item.kind === "group" ? <Users className="size-4" /> : item.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{item.name}</span>
                        <span className={cn("shrink-0 text-[0.65rem]", active ? "text-[var(--primary-foreground)]/70" : "text-[var(--muted-foreground)]")}>{fmtListTime(item.lastAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-xs", active ? "text-[var(--primary-foreground)]/80" : "text-[var(--muted-foreground)]")}>
                          {item.lastPreview ? `${item.lastSender === me ? "我" : item.lastSender}: ${item.lastPreview}` : "暂无消息"}
                        </span>
                        {item.unread > 0 && (
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
                            {item.unread > 99 ? "99+" : item.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧：聊天窗口 */}
        <div className="flex h-[70vh] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-sm font-medium text-[var(--primary)]">
                  {isGroup ? <Users className="size-4" /> : selected.name.charAt(0)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{selected.name}</p>
                  {isGroup && (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {groups.find((g) => g.id === selected.id)?.members.length ?? 0} 人
                    </p>
                  )}
                </div>
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
                    const isImage = !!m.image_url;
                    const isOrder = !!m.order_id;
                    const showRead = isDirect && mine;
                    return (
                      <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div className="max-w-[75%]">
                          {isGroup && !mine && (
                            <p className="mb-0.5 text-[0.65rem] text-[var(--muted-foreground)]">{m.sender}</p>
                          )}
                          {isOrder ? (
                            <button
                              onClick={() => router.push(`/orders/${m.order_id}`)}
                              className="block w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-left transition-colors hover:border-[var(--primary)]"
                            >
                              <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--muted-foreground)]">
                                <FileText className="size-3.5" /> 订单
                              </span>
                              <span className="mt-1 block truncate text-sm font-medium text-[var(--foreground)]">{m.order_id}</span>
                              <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">{m.content || "—"}</span>
                            </button>
                          ) : (
                            <div
                              className={cn(
                                "rounded-lg text-sm",
                                mine ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--muted)] text-[var(--foreground)]",
                                isImage ? "p-1.5" : "px-3 py-2"
                              )}
                            >
                              {isImage ? (
                                <button
                                  onClick={() => setLightbox(m.image_url)}
                                  className="block max-w-full"
                                  title="查看大图"
                                >
                                  <img
                                    src={imgSrc(m.image_url)}
                                    alt="图片消息"
                                    className="max-h-60 max-w-full cursor-zoom-in rounded-md object-contain"
                                  />
                                </button>
                              ) : (
                                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                              )}
                              <p className={cn("mt-1 text-[0.6rem]", mine ? "text-[var(--primary-foreground)]/70" : "text-[var(--muted-foreground)]")}>
                                {toThaiTime(m.created_at) || "—"}
                                {showRead && <span className="ml-1">{m.is_read ? "已读" : "未读"}</span>}
                              </p>
                            </div>
                          )}
                          {isOrder && (
                            <p className={cn("mt-1 text-[0.6rem] text-[var(--muted-foreground)]", mine ? "text-right" : "text-left")}>
                              {toThaiTime(m.created_at) || "—"}
                              {showRead && <span className="ml-1">{m.is_read ? "已读" : "未读"}</span>}
                            </p>
                          )}
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
                      sendText();
                    }
                  }}
                  placeholder={`发消息给 ${selected.name}`}
                  className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  title="发送图片"
                  className="shrink-0 rounded-md border border-[var(--border)] px-2.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  <ImagePlus className="size-5" />
                </button>
                <button
                  onClick={openOrderPicker}
                  disabled={sending}
                  title="分享订单"
                  className="shrink-0 rounded-md border border-[var(--border)] px-2.5 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  <FileText className="size-5" />
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
                <button
                  onClick={sendText}
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
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">选择一个员工或群开始聊天</p>
            </div>
          )}
        </div>
      </div>

      {/* 建群弹窗 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!creating) setShowCreate(false); }}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">新建群聊</h3>
              <button onClick={() => setShowCreate(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">群名称</label>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：运营协作群"
              className="mb-3 h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
            />

            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">选择成员（创建后你自动成为群主）</label>
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-[var(--border)] p-2">
              {contacts.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-[var(--muted-foreground)]">暂无员工</p>
              ) : (
                contacts.map((c) => (
                  <label key={c.name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--muted)]">
                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(c.name)}
                      onChange={() => toggleMember(c.name)}
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="text-sm text-[var(--foreground)]">{c.name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">{c.role === "admin" ? "管理员" : "员工"}</span>
                  </label>
                ))
              )}
            </div>

            {createError && <p className="mt-2 text-xs text-red-500">{createError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)]">取消</button>
              <button
                onClick={createGroup}
                disabled={creating}
                className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {creating ? "创建中…" : "创建群聊"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 大图预览 */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:text-white"
            aria-label="关闭大图"
          >
            <X className="size-6" />
          </button>
          <img
            src={imgSrc(lightbox)}
            alt="大图"
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 选择订单 */}
      {showOrders && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowOrders(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">分享订单</h3>
              <button onClick={() => setShowOrders(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            {ordersLoading ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : orders.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无订单</p>
            ) : (
              <div className="space-y-1.5">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => sendOrder(o.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[var(--primary)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--foreground)]">{o.id}</span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">{o.customer_name || "—"}</span>
                    </span>
                    <span className="ml-3 shrink-0 text-xs font-medium text-[var(--primary)]">发送</span>
                  </button>
                ))}
              </div>
            )}
            {ordersError && <p className="mt-2 text-xs text-red-500">{ordersError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
