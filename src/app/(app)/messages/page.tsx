"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, X, Users, ImagePlus, FileText, Search, Download, Sparkles, Eye, ListChecks, ChevronLeft, Palette, Megaphone, Pin, Languages, Smile, Plus, Bell, BellOff, Archive, PanelLeftClose, Pencil, LogOut, Trash2, MoreVertical } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { cn, toThaiTime, toThaiDate } from "@/lib/utils";
import { bangkokToday, bangkokDayRange, utcSecondBefore, utcNowStr } from "@/lib/time";
import { containsSensitiveWord } from "@/lib/sensitive-words";
import { useAuth } from "@/components/auth-provider";
import { subscribeOpenChat, takePendingChatTarget, type ChatOpenTarget } from "@/lib/chat-nav";

interface Contact {
  name: string;
  role: string;
  avatar: string;
  last_at: string | null;
  last_preview: string | null;
  last_sender: string | null;
  unread: number;
}

interface Group {
  id: number;
  name: string;
  owner: string;
  background: string;
  announcement: string;
  avatar: string;
  muted: boolean;
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
  recalled: number;
  reply_to: number | null;
  reply_preview: string;
  created_at: string;
  read_members?: string[];
  mentioned_members?: string[];
}

// 会话列表条目（一对一/群聊统一结构，用于分组展示）
interface ConversationItem {
  kind: "direct" | "group";
  id: string;
  name: string;
  avatar: string;
  muted: boolean;
  lastAt: string | null;
  lastSender: string | null;
  lastPreview: string | null;
  unread: number;
}

// 当前打开的聊天对象：要么是一对一（员工名），要么是群
type ChatTarget =
  | { kind: "direct"; name: string }
  | { kind: "group"; id: number; name: string };

interface SearchResult {
  id: number;
  kind: "direct" | "group";
  title: string;
  target_id: string;
  sender: string;
  content: string;
  created_at: string;
}

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

// 消息是否在两分钟内（用于显示撤回按钮）
function within2Min(createdAt: string): boolean {
  const t = new Date(createdAt.replace(" ", "T") + "Z").getTime();
  return !isNaN(t) && Date.now() - t < 2 * 60 * 1000;
}

// ── 分享卡片（订单/待办/项目/客户/VAT/预扣税/问题）──
type CardKind = "order" | "todo" | "project" | "customer" | "vat" | "wht" | "problem";

interface CardInfo {
  kind: CardKind;
  id: string;
  title: string;
  subtitle: string;
}

// 卡片类型 → 展示标签 + 点击跳转的目标详情页
const CARD_META: Record<CardKind, { label: string; href: (id: string) => string }> = {
  order:    { label: "订单", href: (id) => `/orders/${id}` },
  todo:     { label: "待办", href: () => "/todos" },
  project:  { label: "项目", href: (id) => `/projects/${id}` },
  customer: { label: "客户", href: (id) => `/customers/${id}` },
  vat:      { label: "VAT申报", href: (id) => `/vat/${id}` },
  wht:      { label: "预扣税", href: (id) => `/wht/${id}` },
  problem:  { label: "问题", href: (id) => `/problems/${id}` },
};

// 解析消息里的分享卡片：新格式 order_id = "类型:id"、content = JSON{title,subtitle}；
// 兼容旧的订单卡片（order_id 直接是订单号、content 是客户名）
function parseCard(m: Message): CardInfo | null {
  if (!m.order_id) return null;
  const idx = m.order_id.indexOf(":");
  if (idx > 0) {
    const kind = m.order_id.slice(0, idx) as CardKind;
    const id = m.order_id.slice(idx + 1);
    if (!CARD_META[kind]) return null;
    let title = id;
    let subtitle = "";
    try {
      const data = JSON.parse(m.content || "{}");
      if (data && typeof data.title === "string") title = data.title;
      if (data && typeof data.subtitle === "string") subtitle = data.subtitle;
    } catch { /* 旧数据容错 */ }
    return { kind, id, title, subtitle };
  }
  return { kind: "order", id: m.order_id, title: m.order_id, subtitle: m.content || "" };
}

// 引用回复时，被引用消息的原文缩略（不含发送人）
function quotePreview(m: Message): string {
  if (m.recalled) return "已撤回";
  if (m.image_url) return "[图片]";
  const card = parseCard(m);
  if (card) return `[${CARD_META[card.kind].label}] ${card.title}`;
  return (m.content || "").slice(0, 50);
}

// 分享弹窗里的分类
const SHARE_CATEGORIES: { key: CardKind; label: string }[] = [
  { key: "order", label: "订单" },
  { key: "todo", label: "待办" },
  { key: "project", label: "项目" },
  { key: "customer", label: "客户" },
  { key: "vat", label: "VAT申报" },
  { key: "wht", label: "预扣税申报" },
  { key: "problem", label: "问题跟踪" },
];

// 各分类接口返回的条目 → 统一的 { id, title, subtitle }
function mapShareItem(cat: string, x: any): { id: string; title: string; subtitle: string } {
  if (cat === "order") return { id: String(x.id), title: String(x.id), subtitle: x.customer_name || "" };
  if (cat === "todo") return { id: String(x.id), title: x.content || "", subtitle: "" };
  if (cat === "project") return { id: String(x.id), title: x.name || "", subtitle: x.current_phase ? `当前阶段：${x.current_phase}` : "" };
  if (cat === "customer") return { id: String(x.id), title: x.company_name || "", subtitle: "" };
  if (cat === "vat") return { id: String(x.id), title: x.company_name || "", subtitle: x.year_month ? `申报月份：${x.year_month}` : "" };
  if (cat === "wht") return { id: String(x.id), title: x.company_name || "", subtitle: x.year_month ? `申报月份：${x.year_month}` : "" };
  if (cat === "problem") return { id: String(x.id), title: x.problem_number || "", subtitle: x.company_name || "" };
  return { id: "", title: "", subtitle: "" };
}

// ── AI 总结：时间档位 ──
type SummaryRangeOption = "today" | "yesterday" | "7d" | "30d";

const SUMMARY_RANGES: { key: SummaryRangeOption; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "yesterday", label: "昨天" },
  { key: "7d", label: "最近七天" },
  { key: "30d", label: "最近三十天" },
];

// 聊天监控的时间档位（今天 / 最近七天 / 最近三十天）
const MONITOR_RANGES: { key: SummaryRangeOption; label: string }[] = [
  { key: "today", label: "今天" },
  { key: "7d", label: "最近七天" },
  { key: "30d", label: "最近三十天" },
];

// 把 "YYYY-MM-DD" 日历日期平移 N 天（纯日历运算，不涉及时区）
function shiftDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().split("T")[0];
}

// 总结时间档位 → 存 UTC 的 from/to 闭区间（messages.created_at 存 UTC）
function summaryTimeRange(option: SummaryRangeOption): { from: string; to: string } {
  const today = bangkokToday();
  if (option === "today") {
    return { from: bangkokDayRange(today).start, to: utcNowStr() };
  }
  if (option === "yesterday") {
    const y = shiftDateStr(today, -1);
    const r = bangkokDayRange(y);
    return { from: r.start, to: utcSecondBefore(r.end) };
  }
  if (option === "30d") {
    return { from: bangkokDayRange(shiftDateStr(today, -29)).start, to: utcNowStr() };
  }
  return { from: bangkokDayRange(shiftDateStr(today, -6)).start, to: utcNowStr() };
}

// 历史总结列表里的一条
interface SummaryHistoryItem {
  id: number;
  from_at: string;
  to_at: string;
  topics: string;
  conclusions: string;
  todos: string;
  commitments: string;
  created_at: string;
}

// 聊天监控里的一条会话（谁跟谁、多少条、最后聊了什么）
interface MonitorConversation {
  id: number;
  user_a: string;
  user_b: string;
  message_count: number;
  last_sender: string;
  last_at: string;
  last_preview: string;
  has_sensitive: boolean;
}

// 员工活跃度：某个员工最近聊了几个人、总共多少条
interface MonitorActivity {
  employee: string;
  partner_count: number;
  message_count: number;
}

// 总结板块里的一条会话总结
interface SummaryBoardItem {
  conversation_id: number;
  user_a: string;
  user_b: string;
  message_count: number;
  topics: string;
  conclusions: string;
  todos: string;
  commitments: string;
  cached: boolean;
}

// 把总结里的待办/承诺文本按行拆成一条条（去掉圆点/编号前缀）
function splitSummaryItems(text: string): string[] {
  if (!text || text.trim() === "无") return [];
  return text
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[-•*·]+\s*/, "").replace(/^\s*\d+[.、)]\s*/, "").trim())
    .filter(Boolean);
}

// 渲染四块总结内容（生成结果 / 历史详情共用）。
// 传入 onConvert 时，「待办事项」「承诺约定」每一条后面带「转待办」按钮。
function SummaryBlocks({
  data,
  onConvert,
  converted,
}: {
  data: { topics: string; conclusions: string; todos: string; commitments: string };
  onConvert?: (kind: "todos" | "commitments", text: string) => void;
  converted?: Set<string>;
}) {
  const blocks: { key: string; label: string; content: string }[] = [
    { key: "topics", label: "聊了什么话题", content: data.topics },
    { key: "conclusions", label: "有什么结论", content: data.conclusions },
    { key: "todos", label: "待办事项", content: data.todos },
    { key: "commitments", label: "承诺约定", content: data.commitments },
  ];
  return (
    <div className="space-y-2.5">
      {blocks.map((b) => {
        const convertible = onConvert && (b.key === "todos" || b.key === "commitments");
        const items = convertible ? splitSummaryItems(b.content) : [];
        return (
          <div key={b.key} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
            <p className="text-xs font-semibold text-[var(--foreground)]">{b.label}</p>
            {convertible ? (
              items.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">无</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {items.map((item, i) => {
                    const key = `${b.key}:${item}`;
                    const done = converted?.has(key);
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]/90">{item}</span>
                        <button
                          onClick={() => onConvert(b.key as "todos" | "commitments", item)}
                          disabled={done}
                          className={cn(
                            "shrink-0 rounded-md border px-2 py-0.5 text-[0.65rem] transition-colors",
                            done
                              ? "border-transparent text-[var(--muted-foreground)]"
                              : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]"
                          )}
                        >
                          {done ? "已转" : "转待办"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--foreground)]/90">{b.content || "无"}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 转待办时的负责人选择（留空 = 默认自己）
function AssigneeSelect({ value, onChange, contacts }: { value: string; onChange: (v: string) => void; contacts: Contact[] }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="shrink-0 text-xs text-[var(--muted-foreground)]">负责人</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
      >
        <option value="">默认（自己）</option>
        {contacts.map((c) => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

// 聊天背景预设（浅色渐变/纯色，保证气泡文字可读）
const CHAT_BACKGROUND_PRESETS: { key: string; label: string; style: string }[] = [
  { key: "green", label: "清新绿", style: "linear-gradient(160deg, #e2f7e6 0%, #bfe7c9 100%)" },
  { key: "blue", label: "天空蓝", style: "linear-gradient(160deg, #e3f1ff 0%, #bcd9ff 100%)" },
  { key: "orange", label: "暖橙", style: "linear-gradient(160deg, #fff0e2 0%, #ffd8bd 100%)" },
  { key: "purple", label: "粉紫", style: "linear-gradient(160deg, #f4e6ff 0%, #dcc9ff 100%)" },
  { key: "gray", label: "浅灰", style: "linear-gradient(160deg, #f2f3f5 0%, #e3e6ea 100%)" },
];

// 表情反应可选的表情
const REACTION_EMOJIS = [
  { emoji: "👍", label: "赞" },
  { emoji: "❤️", label: "爱心" },
  { emoji: "😂", label: "大笑" },
];

// Emoji 快捷面板常用表情（一排排，点选方便）
const EMOJI_LIST = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎",
  "🤔", "🙄", "😅", "😭", "😡", "😴", "🥺", "😇",
  "👍", "👎", "🙏", "💪", "🤝", "👏", "🎉", "🔥",
  "❤️", "💔", "⭐", "✅", "❌", "⚠️", "📢", "💰",
  "📅", "⏰", "📝", "🚀", "🎯", "🍀", "🌹", "☕",
];

// 一条消息的反应分组
interface ReactionGroup {
  emoji: string;
  users: string[];
}

export default function MessagesPage() {
  const { user, setUser } = useAuth();
  const me = user?.name || "";
  const isAdmin = user?.role === "admin";
  const router = useRouter();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<ChatTarget | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  // 打字提示的作用域：1:1 用会话 id（双方共享），群用群 id
  const typingScopeKey = selected
    ? (selected.kind === "direct" ? (conversationId != null ? `direct:${conversationId}` : "") : `group:${selected.id}`)
    : "";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: number; sender: string; preview: string } | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  const [readDetail, setReadDetail] = useState<{ readMembers: string[]; unreadMembers: string[] } | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingScrollTo, setPendingScrollTo] = useState<number | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  // 分享卡片：先选分类，再选具体条目
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCategory, setShareCategory] = useState<"" | CardKind>("");
  const [shareItems, setShareItems] = useState<{ id: string; title: string; subtitle: string }[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // AI 总结
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryRange, setSummaryRange] = useState<SummaryRangeOption>("7d");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<{ topics: string; conclusions: string; todos: string; commitments: string; cached: boolean } | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  // AI 总结历史
  const [summaryTab, setSummaryTab] = useState<"generate" | "history">("generate");
  const [summaryHistory, setSummaryHistory] = useState<SummaryHistoryItem[]>([]);
  const [summaryHistoryLoading, setSummaryHistoryLoading] = useState(false);
  const [summaryHistoryError, setSummaryHistoryError] = useState<string | null>(null);
  const [viewingSummary, setViewingSummary] = useState<SummaryHistoryItem | null>(null);
  // 按员工总结（老板）
  const [empSummaryOpen, setEmpSummaryOpen] = useState(false);
  const [empSummaryName, setEmpSummaryName] = useState("");
  const [empSummaryRange, setEmpSummaryRange] = useState<SummaryRangeOption>("7d");
  const [empSummaryLoading, setEmpSummaryLoading] = useState(false);
  const [empSummaryResult, setEmpSummaryResult] = useState<{ topics: string; conclusions: string; todos: string; commitments: string; cached: boolean } | null>(null);
  const [empSummaryError, setEmpSummaryError] = useState<string | null>(null);
  // 聊天监控（管理员）
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monitorList, setMonitorList] = useState<MonitorConversation[]>([]);
  const [monitorActivity, setMonitorActivity] = useState<MonitorActivity[]>([]);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [monitorDetail, setMonitorDetail] = useState<{ conversation: { user_a: string; user_b: string }; messages: Message[] } | null>(null);
  const [monitorRange, setMonitorRange] = useState<SummaryRangeOption>("7d");
  const [monitorEmployee, setMonitorEmployee] = useState("");
  // 监控看板：消息量平均值（用于高亮「聊得特别频繁」的会话）
  const monitorAvg = useMemo(() => {
    if (!monitorList.length) return 0;
    return monitorList.reduce((s, c) => s + c.message_count, 0) / monitorList.length;
  }, [monitorList]);
  // 高亮标准：≥50 条，或（会话≥3 且 ≥15 条且达到平均值的 2 倍）
  const isHighVolume = (count: number) =>
    count >= 50 || (monitorList.length >= 3 && count >= 15 && count >= monitorAvg * 2);
  // 总结板块（管理员）
  const [summaryBoardOpen, setSummaryBoardOpen] = useState(false);
  const [summaryBoardList, setSummaryBoardList] = useState<SummaryBoardItem[]>([]);
  const [summaryBoardLoading, setSummaryBoardLoading] = useState(false);
  const [summaryBoardGenerating, setSummaryBoardGenerating] = useState(false);
  const [summaryBoardError, setSummaryBoardError] = useState<string | null>(null);
  // 总结里的待办/承诺一键转系统待办
  const [todoAssignee, setTodoAssignee] = useState("");
  const [convertedTodos, setConvertedTodos] = useState<Set<string>>(new Set());
  const [convertingTodoKey, setConvertingTodoKey] = useState<string | null>(null);
  // 聊天背景设置
  const [bgOpen, setBgOpen] = useState(false);
  const [bgSaving, setBgSaving] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);
  // 群背景 / 群公告（群主）
  const [groupBgOpen, setGroupBgOpen] = useState(false);
  const [groupBgSaving, setGroupBgSaving] = useState(false);
  const groupBgInputRef = useRef<HTMLInputElement>(null);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementText, setAnnouncementText] = useState("");
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  // 群头像 / 群改名（群主）
  const [groupAvatarOpen, setGroupAvatarOpen] = useState(false);
  const [groupAvatarSaving, setGroupAvatarSaving] = useState(false);
  const groupAvatarInputRef = useRef<HTMLInputElement>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameText, setRenameText] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  // 群成员管理（群主）
  const [membersOpen, setMembersOpen] = useState(false);
  const [membersSaving, setMembersSaving] = useState(false);
  const [inviteCandidates, setInviteCandidates] = useState<string[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  // 退群（普通成员）
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveSaving, setLeaveSaving] = useState(false);
  // 转让群主（群主）
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  const [transferSaving, setTransferSaving] = useState(false);
  // 解散群（群主）
  const [disbandOpen, setDisbandOpen] = useState(false);
  const [disbandSaving, setDisbandSaving] = useState(false);
  // 顶部「更多」菜单
  const [moreOpen, setMoreOpen] = useState(false);
  // 会话置顶
  const [pinnedScopes, setPinnedScopes] = useState<Set<string>>(new Set());
  // 消息翻译
  const [translateOpen, setTranslateOpen] = useState<Set<number>>(new Set());
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  const [translating, setTranslating] = useState<string | null>(null);
  // 长按消息菜单
  const [menuState, setMenuState] = useState<{ id: number; x: number; y: number } | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 表情反应
  const [reactions, setReactions] = useState<Map<number, ReactionGroup[]>>(new Map());
  const [emojiPickerState, setEmojiPickerState] = useState<{ id: number; x: number; y: number } | null>(null);

  // 建群弹窗
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const cursorRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openedRef = useRef(false);
  const lastTypingPingRef = useRef(0);

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

  // 加载我的置顶会话列表
  useEffect(() => {
    fetchWithAuth("/api/chat/pins", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.pins)) setPinnedScopes(new Set(d.pins)); })
      .catch(() => {});
  }, []);

  // 会话置顶/取消置顶
  const togglePin = async (kind: "direct" | "group", id: string) => {
    const scopeKey = `${kind}:${id}`;
    const isPinned = pinnedScopes.has(scopeKey);
    // 乐观更新
    setPinnedScopes((prev) => {
      const next = new Set(prev);
      if (isPinned) next.delete(scopeKey); else next.add(scopeKey);
      return next;
    });
    try {
      const r = await fetchWithAuth("/api/chat/pins", {
        method: isPinned ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_key: scopeKey }),
      });
      if (!r.ok) {
        // 失败回滚
        setPinnedScopes((prev) => {
          const next = new Set(prev);
          if (isPinned) next.add(scopeKey); else next.delete(scopeKey);
          return next;
        });
      }
    } catch {
      setPinnedScopes((prev) => {
        const next = new Set(prev);
        if (isPinned) next.add(scopeKey); else next.delete(scopeKey);
        return next;
      });
    }
  };

  // 展开/收起某条消息的翻译面板
  const toggleTranslate = (messageId: number) => {
    setTranslateOpen((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
      return next;
    });
  };

  // 翻译一条消息（目标语言：中文 / 泰语），结果缓存、重复点直接读缓存
  const doTranslate = async (messageId: number, target: "中文" | "泰语") => {
    const key = `${messageId}:${target}`;
    if (translations.has(key) || translating === key) return;
    setTranslating(key);
    try {
      const r = await fetchWithAuth("/api/chat/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, target }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && typeof d?.translated === "string") {
        setTranslations((prev) => { const next = new Map(prev); next.set(key, d.translated); return next; });
      } else {
        setError(d?.error || "翻译失败");
      }
    } catch {
      setError("翻译失败");
    } finally {
      setTranslating(null);
    }
  };

  // 关闭长按菜单
  const closeMenu = () => setMenuState(null);

  // 长按消息：弹出圆润操作菜单（桌面右键、移动端长按都触发）
  const showMessageMenu = (id: number, clientX: number, clientY: number) => {
    const x = Math.min(clientX, typeof window !== "undefined" ? window.innerWidth - 180 : clientX);
    const y = Math.min(clientY, typeof window !== "undefined" ? window.innerHeight - 220 : clientY);
    setMenuState({ id, x: Math.max(0, x), y: Math.max(0, y) });
  };

  const startLongPress = (e: React.TouchEvent, id: number) => {
    const t = e.touches[0];
    if (!t) return;
    longPressTimerRef.current = setTimeout(() => {
      showMessageMenu(id, t.clientX, t.clientY);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // 复制消息文字
  const copyMessage = async (m: Message) => {
    try {
      await navigator.clipboard.writeText(m.content || "");
    } catch { /* 复制失败忽略 */ }
    setMenuState(null);
  };

  // 打开表情反应选择器（点「表情反应」后）
  const openEmojiPicker = (id: number, x: number, y: number) => {
    setMenuState(null);
    setEmojiPickerState({ id, x, y });
  };

  // 切换表情反应：同一表情点一下加、再点取消
  const toggleReaction = async (messageId: number, emoji: string) => {
    try {
      const r = await fetchWithAuth("/api/chat/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, emoji }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && Array.isArray(d?.reactions)) {
        setReactions((prev) => {
          const next = new Map(prev);
          next.set(messageId, d.reactions as ReactionGroup[]);
          return next;
        });
      } else {
        setError(d?.error || "操作失败");
      }
    } catch {
      setError("操作失败");
    } finally {
      setEmojiPickerState(null);
    }
  };

  // 点击引用的原文 → 滚动到那条原消息
  const jumpToMessage = (id: number) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // 拉取当前会话所有消息的表情反应
  const refreshReactions = async () => {
    if (!selected) return;
    const q = selected.kind === "direct"
      ? (conversationId != null ? `conversation_id=${conversationId}` : "")
      : `group_id=${selected.id}`;
    if (!q) return;
    try {
      const r = await fetchWithAuth(`/api/chat/reactions?${q}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.reactions && typeof d.reactions === "object") {
        const map = new Map<number, ReactionGroup[]>();
        for (const [k, v] of Object.entries(d.reactions)) {
          map.set(Number(k), v as ReactionGroup[]);
        }
        setReactions(map);
      }
    } catch { /* 忽略 */ }
  };

  // 会话列表：分成「群聊」和「一对一」两个区域，各自置顶固定最上、其余按最后一条消息时间倒序
  const { groupConversations, directConversations } = useMemo(() => {
    const sortItems = (items: ConversationItem[]) => items.sort((a, b) => {
      const aPinned = pinnedScopes.has(`${a.kind}:${a.id}`) ? 1 : 0;
      const bPinned = pinnedScopes.has(`${b.kind}:${b.id}`) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned; // 置顶的排前面
      const ta = a.lastAt || "";
      const tb = b.lastAt || "";
      if (ta !== tb) return ta > tb ? -1 : 1;
      return a.name.localeCompare(b.name, "zh");
    });
    const groupItems: ConversationItem[] = groups.map((g) => ({
      kind: "group",
      id: String(g.id),
      name: g.name,
      avatar: g.avatar || "",
      muted: !!g.muted,
      lastAt: g.last_at,
      lastSender: g.last_sender,
      lastPreview: g.last_preview,
      unread: 0,
    }));
    const directItems: ConversationItem[] = contacts.map((c) => ({
      kind: "direct",
      id: c.name,
      name: c.name,
      avatar: c.avatar || "",
      muted: false,
      lastAt: c.last_at,
      lastSender: c.last_sender,
      lastPreview: c.last_preview,
      unread: c.unread || 0,
    }));
    return { groupConversations: sortItems(groupItems), directConversations: sortItems(directItems) };
  }, [contacts, groups, pinnedScopes]);

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

  // 把会话里被撤回的消息标记为已撤回（对方撤回后轮询实时生效，不用刷新）
  const applyRecalledIds = useCallback((ids: number[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => (set.has(m.id) && m.recalled !== 1 ? ((changed = true), { ...m, recalled: 1 }) : m));
      return changed ? next : prev;
    });
  }, []);

  // 群聊：把每条消息的已读成员列表刷到本地（用于「已读 X/Y」实时更新）
  const applyGroupReads = useCallback((reads: Record<string, string[]>) => {
    setMessages((prev) => prev.map((m) => {
      const members = reads[String(m.id)];
      if (!members) return m;
      return { ...m, read_members: members };
    }));
  }, []);

  // 打开一对一会话
  const openDirect = useCallback((name: string) => {
    setSelected({ kind: "direct", name });
    setConversationId(null);
    setMessages([]);
    setInput("");
    setError(null);
    setReplyTo(null);
    cursorRef.current = 0;
    fetchWithAuth(`/api/chat?other=${encodeURIComponent(name)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.conversationId === "number") setConversationId(d.conversationId);
        if (d && Array.isArray(d.messages)) mergeIncoming(d.messages);
        if (d && Array.isArray(d.readMessageIds)) applyReadIds(d.readMessageIds);
        if (d && Array.isArray(d.recalledIds)) applyRecalledIds(d.recalledIds);
      })
      .catch(() => {});
  }, [mergeIncoming, applyReadIds, applyRecalledIds]);

  // 打开群会话
  const openGroup = useCallback((id: number, name: string) => {
    setSelected({ kind: "group", id, name });
    setMessages([]);
    setInput("");
    setError(null);
    setReplyTo(null);
    cursorRef.current = 0;
    fetchWithAuth(`/api/chat/group-messages?group_id=${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.messages)) mergeIncoming(d.messages);
        if (d && Array.isArray(d.recalledIds)) applyRecalledIds(d.recalledIds);
        if (d && typeof d.group?.member_count === "number") setGroupMemberCount(d.group.member_count);
        if (d && d.reads && typeof d.reads === "object") applyGroupReads(d.reads);
      })
      .catch(() => {});
  }, [mergeIncoming, applyGroupReads, applyRecalledIds]);

  // 从通知中心跳转过来：?open=direct:姓名 或 ?open=group:群id，打开对应会话
  useEffect(() => {
    if (openedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const open = params.get("open");
    if (!open) return;
    const idx = open.indexOf(":");
    if (idx < 0) return;
    const kind = open.slice(0, idx);
    const id = open.slice(idx + 1);
    if (kind === "direct" && id) {
      openedRef.current = true;
      openDirect(id);
    } else if (kind === "group" && id) {
      // 群跳转需要群名，等群列表加载后按 id 找到再打开
      const g = groups.find((g) => String(g.id) === id);
      if (g) {
        openedRef.current = true;
        openGroup(g.id, g.name);
      }
    }
  }, [groups, openDirect, openGroup]);

  // 消息提醒气泡 / 系统通知点击跳转：打开对应会话
  // （已经在消息页时靠订阅直接切换；从别的页面跳过来时靠挂载时取走暂存目标）
  useEffect(() => {
    const apply = (t: ChatOpenTarget) => {
      if (t.kind === "direct") openDirect(t.name);
      else if (t.kind === "group") openGroup(t.id, t.name);
    };
    const pending = takePendingChatTarget();
    if (pending) apply(pending);
    return subscribeOpenChat(apply);
  }, [openDirect, openGroup]);

  // 导出当前会话（一对一/群聊）的全部聊天记录为 .txt 文件
  const exportChat = async () => {
    if (!selected || exporting) return;
    setExporting(true);
    setError(null);
    try {
      const isDirect = selected.kind === "direct";
      const all: Message[] = [];
      let after = 0;
      // 接口每页最多返回 500 条，按消息 id 翻页拉全
      for (let page = 0; page < 500; page++) {
        const url = isDirect
          ? `/api/chat?other=${encodeURIComponent(selected.name)}&after=${after}`
          : `/api/chat/group-messages?group_id=${selected.id}&after=${after}`;
        const r = await fetchWithAuth(url, { cache: "no-store" });
        if (!r.ok) break;
        const d = await r.json();
        const batch: Message[] = Array.isArray(d?.messages) ? d.messages : [];
        if (batch.length === 0) break;
        all.push(...batch);
        after = Math.max(...batch.map((m) => m.id));
        if (batch.length < 500) break; // 拉完最后一页
      }
      // 去重 + 按 id 升序，保证导出顺序稳定
      const map = new Map<number, Message>();
      for (const m of all) map.set(m.id, m);
      const msgs = [...map.values()].sort((a, b) => a.id - b.id);
      if (msgs.length === 0) { setError("没有可导出的消息"); return; }

      const title = isDirect ? `一对一聊天记录：${selected.name}` : `群聊记录：${selected.name}`;
      const nowStr = toThaiTime(new Date().toISOString()) || new Date().toLocaleString();
      const lines: string[] = [
        title,
        `导出时间：${nowStr}`,
        `消息总数：${msgs.length} 条`,
        "=".repeat(48),
      ];
      msgs.forEach((m, i) => {
        const time = toThaiTime(m.created_at) || m.created_at || "";
        const who = m.sender === me ? `${m.sender}（我）` : m.sender;
        lines.push(`[${i + 1}] ${who}  ${time}`);
        if (m.recalled) {
          lines.push("    [已撤回]");
        } else if (m.order_id) {
          const card = parseCard(m);
          if (card) {
            lines.push(`    [${CARD_META[card.kind].label}] ${card.title}${card.subtitle ? ` — ${card.subtitle}` : ""}`);
          } else {
            lines.push(`    [订单] 订单号：${m.order_id}  客户：${m.content || "—"}`);
          }
        } else if (m.image_url) {
          lines.push(`    [图片] ${m.image_url}`);
          if (m.content) lines.push(`    ${m.content}`);
        } else {
          lines.push(`    ${m.content || ""}`);
        }
      });

      // 带 BOM，Windows 记事本 / Excel 打开中文不乱码
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `聊天记录_${selected.name}_${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败");
    } finally {
      setExporting(false);
    }
  };

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
          if (Array.isArray(d.recalledIds)) applyRecalledIds(d.recalledIds);
          if (d && typeof d.group?.member_count === "number") setGroupMemberCount(d.group.member_count);
          if (d && d.reads && typeof d.reads === "object") applyGroupReads(d.reads);
        }
      } catch { /* 轮询失败静默，下一轮重试 */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { active = false; clearInterval(id); };
  }, [selected, mergeIncoming, applyReadIds, applyRecalledIds]);

  // 表情反应：切会话/新会话时拉一次，之后每 5 秒刷新（看到别人加的表情）
  useEffect(() => {
    if (!selected) { setReactions(new Map()); return; }
    refreshReactions();
    const id = setInterval(refreshReactions, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, conversationId]);

  // 打字提示：轮询对方是否正在输入
  useEffect(() => {
    if (!typingScopeKey) { setTypingUsers([]); return; }
    let active = true;
    const tick = async () => {
      try {
        const r = await fetchWithAuth(`/api/chat/typing?scope_key=${encodeURIComponent(typingScopeKey)}`, { cache: "no-store" });
        const d = await r.json().catch(() => null);
        if (active && r.ok && Array.isArray(d?.users)) setTypingUsers(d.users);
      } catch { /* 忽略 */ }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => { active = false; clearInterval(id); };
  }, [typingScopeKey]);

  // 新消息自动滚到底部
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 搜索聊天记录（防抖 300ms）
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults([]);
      setSearchOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      fetchWithAuth(`/api/chat/search?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (Array.isArray(d?.results)) {
            setSearchResults(d.results);
            setSearchOpen(true);
          }
        })
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [searchQ]);

  // 从搜索结果跳转后，滚动到目标消息
  useEffect(() => {
    if (pendingScrollTo == null) return;
    const el = document.getElementById(`msg-${pendingScrollTo}`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      setPendingScrollTo(null);
    }
  }, [messages, pendingScrollTo]);

  // 发一条消息（文字/图片/分享卡片），自己发出去的立刻上屏
  const sendMessage = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (!selected) return false;
    const isDirect = selected.kind === "direct";
    const url = isDirect ? "/api/chat" : "/api/chat/group-messages";
    // 引用回复：带上被引用消息的 id 和原文快照
    const fullPayload = replyTo
      ? { ...payload, reply_to: replyTo.id, reply_preview: `${replyTo.sender}: ${replyTo.preview}` }
      : payload;
    const body = isDirect ? { other: selected.name, ...fullPayload } : { group_id: selected.id, ...fullPayload };
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
        setReplyTo(null);
        return true;
      }
      setError(d?.error || "发送失败");
      return false;
    } catch {
      setError("发送失败");
      return false;
    }
  };

  const postMessage = (content: string, imageUrl: string) => sendMessage({ content, image_url: imageUrl });
  const postCard = (cardType: string, cardId: string) => sendMessage({ card_type: cardType, card_id: cardId });

  const sendText = async () => {
    const text = input.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setError(null);
    const ok = await postMessage(text, "");
    setSending(false);
    if (ok) {
      setInput("");
      setEmojiPanelOpen(false);
    }
  };

  // 点表情 → 填进输入框
  const insertEmoji = (emoji: string) => {
    setInput((prev) => prev + emoji);
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
        await postMessage("", d.url);
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

  // 打开分享选择器（先选分类）
  const openSharePicker = () => {
    setShareOpen(true);
    setShareCategory("");
    setShareItems([]);
    setShareError(null);
  };

  // 选好分类后加载该分类下的条目
  const pickShareCategory = (cat: CardKind) => {
    setShareCategory(cat);
    setShareLoading(true);
    setShareError(null);
    const urlMap: Record<CardKind, string> = {
      order: "/api/orders", todo: "/api/todos", project: "/api/projects", customer: "/api/customers",
      vat: "/api/vat/records?limit=100", wht: "/api/wht/records?pageSize=100", problem: "/api/problems",
    };
    fetchWithAuth(urlMap[cat], { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) { setShareItems([]); setShareError(d?.error || "加载失败"); return; }
        // VAT / 预扣税 是分页接口，返回 { records } / { rows }；其余直接返回数组
        const list = Array.isArray(d) ? d : Array.isArray(d?.records) ? d.records : Array.isArray(d?.rows) ? d.rows : null;
        if (!list) { setShareItems([]); setShareError("数据格式异常"); return; }
        setShareItems(list.map((x: any) => mapShareItem(cat, x)));
      })
      .catch(() => setShareError("加载失败"))
      .finally(() => setShareLoading(false));
  };

  // 发一条分享卡片消息
  const sendCard = async (cardType: string, cardId: string) => {
    setShareOpen(false);
    setSending(true);
    setError(null);
    await postCard(cardType, cardId);
    setSending(false);
  };

  // 打开 AI 总结弹窗（默认最近七天）
  const openSummary = () => {
    setSummaryOpen(true);
    setSummaryRange("7d");
    setSummaryResult(null);
    setSummaryError(null);
    setSummaryTab("generate");
    setSummaryHistory([]);
    setSummaryHistoryError(null);
    setViewingSummary(null);
    setConvertedTodos(new Set());
  };

  // 调总结接口，把结果四块显示出来
  const generateSummary = async () => {
    if (!selected) return;
    if (selected.kind === "direct" && conversationId == null) {
      setSummaryError("会话还没加载好，稍等一下再点");
      return;
    }
    const range = summaryTimeRange(summaryRange);
    setSummaryLoading(true);
    setSummaryError(null);
    setSummaryResult(null);
    try {
      const body = selected.kind === "direct"
        ? { conversation_id: conversationId, from: range.from, to: range.to }
        : { group_id: selected.id, from: range.from, to: range.to };
      const r = await fetchWithAuth("/api/chat/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d && typeof d.topics === "string") {
        setSummaryResult({
          topics: d.topics, conclusions: d.conclusions, todos: d.todos, commitments: d.commitments,
          cached: d.cached === true,
        });
      } else {
        setSummaryError(d?.error || "总结失败");
      }
    } catch {
      setSummaryError("总结失败");
    } finally {
      setSummaryLoading(false);
    }
  };

  // 拉取该会话的历史总结列表（按生成时间倒序）
  const loadSummaryHistory = async () => {
    if (!selected) return;
    if (selected.kind === "direct" && conversationId == null) {
      setSummaryHistoryError("会话还没加载好，稍等一下再点");
      return;
    }
    setSummaryHistoryLoading(true);
    setSummaryHistoryError(null);
    try {
      const q = selected.kind === "direct"
        ? `conversation_id=${conversationId}`
        : `group_id=${selected.id}`;
      const r = await fetchWithAuth(`/api/chat/summary?${q}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && Array.isArray(d)) {
        setSummaryHistory(d as SummaryHistoryItem[]);
      } else {
        setSummaryHistory([]);
        setSummaryHistoryError(d?.error || "加载失败");
      }
    } catch {
      setSummaryHistory([]);
      setSummaryHistoryError("加载失败");
    } finally {
      setSummaryHistoryLoading(false);
    }
  };

  // 打开按员工总结弹窗（默认最近七天）
  const openEmpSummary = () => {
    setEmpSummaryOpen(true);
    setEmpSummaryName("");
    setEmpSummaryRange("7d");
    setEmpSummaryResult(null);
    setEmpSummaryError(null);
    setConvertedTodos(new Set());
  };

  // 一键生成某个员工的整体沟通总结
  const generateEmpSummary = async () => {
    if (!empSummaryName) { setEmpSummaryError("请先选择员工"); return; }
    const range = summaryTimeRange(empSummaryRange);
    setEmpSummaryLoading(true);
    setEmpSummaryError(null);
    setEmpSummaryResult(null);
    try {
      const r = await fetchWithAuth("/api/chat/summary/employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee: empSummaryName, from: range.from, to: range.to }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d && typeof d.topics === "string") {
        setEmpSummaryResult({
          topics: d.topics, conclusions: d.conclusions, todos: d.todos, commitments: d.commitments,
          cached: d.cached === true,
        });
      } else {
        setEmpSummaryError(d?.error || "生成失败");
      }
    } catch {
      setEmpSummaryError("生成失败");
    } finally {
      setEmpSummaryLoading(false);
    }
  };

  // 把总结里的一条待办/承诺转成系统待办（负责人可留空，老板可指定）
  const convertToTodo = async (kind: "todos" | "commitments", text: string) => {
    const key = `${kind}:${text}`;
    if (convertedTodos.has(key) || convertingTodoKey === key) return;
    setConvertingTodoKey(key);
    try {
      const r = await fetchWithAuth("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, assignee: todoAssignee || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setConvertedTodos((prev) => new Set(prev).add(key));
      } else {
        setError(d?.error || "转待办失败");
      }
    } catch {
      setError("转待办失败");
    } finally {
      setConvertingTodoKey(null);
    }
  };

  // 打开聊天监控看板
  const openMonitor = () => {
    setMonitorOpen(true);
    setMonitorDetail(null);
    setMonitorError(null);
    setMonitorRange("7d");
    setMonitorEmployee("");
    loadMonitorList("7d", "");
  };

  // 加载监控看板：按时间范围 + 员工筛选
  const loadMonitorList = async (range: SummaryRangeOption = monitorRange, employee: string = monitorEmployee) => {
    setMonitorLoading(true);
    setMonitorError(null);
    try {
      const { from, to } = summaryTimeRange(range);
      const qs = new URLSearchParams();
      qs.set("from", from);
      qs.set("to", to);
      if (employee) qs.set("employee", employee);
      const r = await fetchWithAuth(`/api/chat/monitor?${qs.toString()}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && d && Array.isArray(d.conversations)) {
        setMonitorList(d.conversations as MonitorConversation[]);
        setMonitorActivity(Array.isArray(d.activity) ? (d.activity as MonitorActivity[]) : []);
      } else {
        setMonitorList([]);
        setMonitorActivity([]);
        setMonitorError(d?.error || "加载失败");
      }
    } catch {
      setMonitorList([]);
      setMonitorActivity([]);
      setMonitorError("加载失败");
    } finally {
      setMonitorLoading(false);
    }
  };

  // 点开某个会话，看这两个员工之间的完整聊天记录
  const openMonitorConversation = async (id: number) => {
    setMonitorLoading(true);
    setMonitorError(null);
    try {
      const r = await fetchWithAuth(`/api/chat/monitor?conversation_id=${id}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.conversation && Array.isArray(d?.messages)) {
        setMonitorDetail({ conversation: d.conversation, messages: d.messages as Message[] });
      } else {
        setMonitorError(d?.error || "加载失败");
      }
    } catch {
      setMonitorError("加载失败");
    } finally {
      setMonitorLoading(false);
    }
  };

  // 打开总结板块
  const openSummaryBoard = () => {
    setSummaryBoardOpen(true);
    setSummaryBoardError(null);
    loadSummaryBoard();
  };

  // 加载已生成的会话总结（缓存）
  const loadSummaryBoard = async () => {
    setSummaryBoardLoading(true);
    setSummaryBoardError(null);
    try {
      const r = await fetchWithAuth("/api/chat/summary/board", { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (r.ok && Array.isArray(d)) {
        setSummaryBoardList(d as SummaryBoardItem[]);
      } else {
        setSummaryBoardList([]);
        setSummaryBoardError(d?.error || "加载失败");
      }
    } catch {
      setSummaryBoardList([]);
      setSummaryBoardError("加载失败");
    } finally {
      setSummaryBoardLoading(false);
    }
  };

  // 一键批量总结所有有消息的会话（未缓存的才调大模型）
  const generateSummaryBoard = async () => {
    setSummaryBoardGenerating(true);
    setSummaryBoardError(null);
    try {
      const r = await fetchWithAuth("/api/chat/summary/board", { method: "POST" });
      const d = await r.json().catch(() => null);
      if (r.ok && Array.isArray(d)) {
        setSummaryBoardList(d as SummaryBoardItem[]);
      } else {
        setSummaryBoardError(d?.error || "生成失败");
      }
    } catch {
      setSummaryBoardError("生成失败");
    } finally {
      setSummaryBoardGenerating(false);
    }
  };

  // 点开群消息的已读人数：列出谁读了、谁没读
  const openReadDetail = (m: Message) => {
    if (selected?.kind !== "group") return;
    const readMembers = m.read_members || [];
    const allMembers = groups.find((g) => g.id === selected.id)?.members || [];
    const unreadMembers = allMembers.filter((n) => !readMembers.includes(n));
    setReadDetail({ readMembers, unreadMembers });
  };

  // 打开聊天背景选择
  const openBackground = () => setBgOpen(true);

  // 保存背景（预设 key / 图片 URL / 空串恢复默认），立即生效并只对自己可见
  const applyBackground = async (value: string) => {
    setBgSaving(true);
    try {
      const r = await fetchWithAuth("/api/employees/background", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: value }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        if (user) setUser({ ...user, chat_background: value });
      } else {
        setError(d?.error || "设置失败");
      }
    } catch {
      setError("设置失败");
    } finally {
      setBgSaving(false);
    }
  };

  // 上传自定义图片当聊天背景
  const handleCustomBgPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("只能上传图片"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("图片不能超过 10MB"); return; }
    setBgSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (up.ok && upData.url) {
        await applyBackground(upData.url);
      } else {
        setError(upData.error || "图片上传失败");
      }
    } catch {
      setError("图片上传失败");
    } finally {
      setBgSaving(false);
    }
  };

  // 打开群背景选择（仅群主）
  const openGroupBackground = () => setGroupBgOpen(true);

  // 群主设置群背景（预设 key / 图片 URL / 空串恢复默认），全群统一
  const applyGroupBackground = async (value: string) => {
    if (!selected || selected.kind !== "group") return;
    setGroupBgSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, background: value }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, background: value } : g)));
      } else {
        setError(d?.error || "设置失败");
      }
    } catch {
      setError("设置失败");
    } finally {
      setGroupBgSaving(false);
    }
  };

  // 群主上传自定义群背景图片
  const handleGroupBgPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("只能上传图片"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("图片不能超过 10MB"); return; }
    setGroupBgSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (up.ok && upData.url) {
        await applyGroupBackground(upData.url);
      } else {
        setError(upData.error || "图片上传失败");
      }
    } catch {
      setError("图片上传失败");
    } finally {
      setGroupBgSaving(false);
    }
  };

  // 打开群公告编辑（带出当前公告）
  const openAnnouncement = () => {
    setAnnouncementText(groupAnnouncement || "");
    setAnnouncementOpen(true);
  };

  // 群主发布/修改群公告（覆盖旧的，只保留最新一条）
  const saveAnnouncement = async () => {
    if (!selected || selected.kind !== "group") return;
    setAnnouncementSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, announcement: announcementText }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, announcement: announcementText.trim() } : g)));
        setAnnouncementOpen(false);
      } else {
        setError(d?.error || "发布失败");
      }
    } catch {
      setError("发布失败");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  // 打开群头像设置（仅群主）
  const openGroupAvatar = () => setGroupAvatarOpen(true);

  // 群主设置群头像（图片 URL / 空串恢复默认图标），全群统一
  const applyGroupAvatar = async (value: string) => {
    if (!selected || selected.kind !== "group") return;
    setGroupAvatarSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, avatar: value }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, avatar: value } : g)));
      } else {
        setError(d?.error || "设置失败");
      }
    } catch {
      setError("设置失败");
    } finally {
      setGroupAvatarSaving(false);
    }
  };

  // 群主上传自定义群头像图片
  const handleGroupAvatarPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("只能上传图片"); return; }
    if (file.size > 10 * 1024 * 1024) { setError("图片不能超过 10MB"); return; }
    setGroupAvatarSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (up.ok && upData.url) {
        await applyGroupAvatar(upData.url);
      } else {
        setError(upData.error || "图片上传失败");
      }
    } catch {
      setError("图片上传失败");
    } finally {
      setGroupAvatarSaving(false);
    }
  };

  // 打开群改名（带出当前群名）
  const openRename = () => {
    setRenameText(selected?.name || "");
    setRenameOpen(true);
  };

  // 群主修改群名称
  const saveRename = async () => {
    if (!selected || selected.kind !== "group") return;
    const name = renameText.trim();
    if (!name) { setError("群名称不能为空"); return; }
    setRenameSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, name }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, name } : g)));
        setSelected((prev) => (prev?.kind === "group" ? { ...prev, name } : prev));
        setRenameOpen(false);
      } else {
        setError(d?.error || "改名失败");
      }
    } catch {
      setError("改名失败");
    } finally {
      setRenameSaving(false);
    }
  };

  // 打开群成员管理（仅群主）
  const openMembers = () => {
    setInviteCandidates([]);
    setMembersError(null);
    setMembersOpen(true);
  };

  // 勾选/取消要邀请的员工
  const toggleInvite = (name: string) => {
    setInviteCandidates((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  // 群主邀请成员入群
  const inviteMembers = async () => {
    if (!selected || selected.kind !== "group" || inviteCandidates.length === 0) return;
    setMembersSaving(true);
    setMembersError(null);
    try {
      const r = await fetchWithAuth("/api/chat/groups/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, members: inviteCandidates }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, members: d.members || g.members } : g)));
        setInviteCandidates([]);
      } else {
        setMembersError(d?.error || "邀请失败");
      }
    } catch {
      setMembersError("邀请失败");
    } finally {
      setMembersSaving(false);
    }
  };

  // 群主移除成员
  const removeMember = async (name: string) => {
    if (!selected || selected.kind !== "group") return;
    setMembersSaving(true);
    setMembersError(null);
    try {
      const r = await fetchWithAuth("/api/chat/groups/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, member: name }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === selected.id ? { ...g, members: d.members || g.members } : g)));
      } else {
        setMembersError(d?.error || "移除失败");
      }
    } catch {
      setMembersError("移除失败");
    } finally {
      setMembersSaving(false);
    }
  };

  // 普通成员退群
  const leaveGroup = async () => {
    if (!selected || selected.kind !== "group") return;
    setLeaveSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const gid = selected.id;
        setGroups((prev) => prev.filter((g) => g.id !== gid));
        setLeaveOpen(false);
        setSelected(null);
        setMessages([]);
        cursorRef.current = 0;
      } else {
        setError(d?.error || "退群失败");
        setLeaveOpen(false);
      }
    } catch {
      setError("退群失败");
      setLeaveOpen(false);
    } finally {
      setLeaveSaving(false);
    }
  };

  // 群主转让群主给某个成员（点「转让」后弹出确认）
  const confirmTransfer = (name: string) => setTransferTarget(name);

  // 执行转让
  const doTransfer = async () => {
    if (!selected || selected.kind !== "group" || !transferTarget) return;
    setTransferSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id, new_owner: transferTarget }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const gid = selected.id;
        setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, owner: d.owner || g.owner, members: d.members || g.members } : g)));
        setTransferTarget(null);
        setMembersOpen(false);
      } else {
        setError(d?.error || "转让失败");
        setTransferTarget(null);
      }
    } catch {
      setError("转让失败");
      setTransferTarget(null);
    } finally {
      setTransferSaving(false);
    }
  };

  // 成员切换自己在当前群的免打扰
  const toggleMute = async () => {
    if (!selected || selected.kind !== "group") return;
    const gid = selected.id;
    const cur = !!groups.find((g) => g.id === gid)?.muted;
    const next = !cur;
    // 乐观更新
    setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, muted: next } : g)));
    try {
      const r = await fetchWithAuth("/api/chat/groups/mute", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: gid, muted: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, muted: cur } : g)));
        setError(d?.error || "设置失败");
      }
    } catch {
      setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, muted: cur } : g)));
      setError("设置失败");
    }
  };

  // 群主解散群
  const disbandGroup = async () => {
    if (!selected || selected.kind !== "group") return;
    setDisbandSaving(true);
    try {
      const r = await fetchWithAuth("/api/chat/groups/disband", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: selected.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        const gid = selected.id;
        setGroups((prev) => prev.filter((g) => g.id !== gid));
        setDisbandOpen(false);
        setSelected(null);
        setMessages([]);
        cursorRef.current = 0;
      } else {
        setError(d?.error || "解散失败");
        setDisbandOpen(false);
      }
    } catch {
      setError("解散失败");
      setDisbandOpen(false);
    } finally {
      setDisbandSaving(false);
    }
  };

  // 撤回自己发的消息（两分钟内）
  const recallMessage = async (m: Message) => {
    try {
      const r = await fetchWithAuth("/api/chat/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: m.id }),
      });
      if (r.ok) {
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, recalled: 1 } : x)));
      } else {
        const d = await r.json().catch(() => ({}));
        setError(d?.error || "撤回失败");
      }
    } catch {
      setError("撤回失败");
    }
  };

  // 点搜索结果：打开对应会话并跳到那条消息
  const jumpToResult = (r: SearchResult) => {
    setPendingScrollTo(r.id);
    setSearchQ("");
    setSearchOpen(false);
    setSearchResults([]);
    if (r.kind === "direct") {
      openDirect(r.target_id);
    } else {
      openGroup(Number(r.target_id), r.title);
    }
  };

  // 群里 @ 成员选择：当前群成员，按输入过滤
  const mentionMembers = useMemo(() => {
    if (selected?.kind !== "group") return [];
    const all = groups.find((g) => g.id === selected.id)?.members || [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => n.toLowerCase().includes(q));
  }, [selected, groups, mentionQuery]);

  // 输入时检测 @，弹出成员选择
  // 上报「我正在输入」（节流：至少间隔 1.5 秒）
  const sendTypingPing = async () => {
    if (!typingScopeKey) return;
    const now = Date.now();
    if (now - lastTypingPingRef.current < 1500) return;
    lastTypingPingRef.current = now;
    try {
      await fetchWithAuth("/api/chat/typing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_key: typingScopeKey }),
      });
    } catch { /* 忽略 */ }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInput(v);
    sendTypingPing();
    if (selected?.kind === "group") {
      const atIdx = v.lastIndexOf("@");
      if (atIdx !== -1) {
        const after = v.slice(atIdx + 1);
        if (!/\s/.test(after)) {
          setMentionQuery(after);
          setMentionOpen(true);
          return;
        }
      }
      setMentionOpen(false);
    }
  };

  // 选中某个成员：把最后一个 @ 及其后面的文字替换成 @名字
  const pickMention = (name: string) => {
    const atIdx = input.lastIndexOf("@");
    const newInput = input.slice(0, atIdx) + "@" + name + " ";
    setInput(newInput);
    setMentionOpen(false);
    setMentionQuery("");
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
  // 当前一对一聊天对象的头像（群聊没有头像，用群图标兜底）
  const selectedAvatar = isDirect ? contacts.find((c) => c.name === selected.name)?.avatar || "" : "";
  const myAvatar = user?.avatar || "";
  // 某个发送者的头像（自己用本人头像，别人从联系人里查，查不到回退空）
  const avatarOf = (name: string) => (name === me ? myAvatar : contacts.find((c) => c.name === name)?.avatar || "");
  // 当前会话的 key：切换会话时用它触发聊天区重挂载，从而播放过渡动画
  const selectedKey = selected ? (selected.kind === "direct" ? `d-${selected.name}` : `g-${selected.id}`) : "none";
  // 当前用户自己设置的聊天背景 → 应用到聊天区（各看各的，互不影响）
  const chatBackground = user?.chat_background || "";
  // 群聊背景（群主设置，全群统一）优先于个人背景；群背景未设置则回退个人背景
  const activeGroup = isGroup ? groups.find((g) => g.id === selected?.id) : undefined;
  const groupBackground = activeGroup?.background || "";
  const groupAnnouncement = activeGroup?.announcement || "";
  const isGroupOwner = isGroup && activeGroup?.owner === me;
  // 群主输入 @ 时可选「@所有人」
  const showMentionAll = !!isGroupOwner && (mentionQuery === "" || "所有人".includes(mentionQuery));
  const effectiveBackground = isGroup && groupBackground ? groupBackground : chatBackground;
  const chatBgStyle: React.CSSProperties = effectiveBackground.startsWith("/api/files/")
    ? { backgroundImage: `url(${imgSrc(effectiveBackground)})`, backgroundSize: "cover", backgroundPosition: "center" }
    : (() => { const p = CHAT_BACKGROUND_PRESETS.find((x) => x.key === effectiveBackground); return p ? { background: p.style } : {}; })();

  // 单条会话列表项（群聊/一对一共用，分组后各自渲染）
  const conversationRow = (item: ConversationItem) => {
    const active = item.kind === "direct"
      ? selected?.kind === "direct" && selected.name === item.id
      : selected?.kind === "group" && selected.id === Number(item.id);
    const pinned = pinnedScopes.has(`${item.kind}:${item.id}`);
    return (
      <div
        key={item.kind + item.id}
        className={cn(
          "group relative flex w-full items-center gap-1 rounded-lg px-3 py-2 text-left transition-all duration-200 ease-out",
          active ? "bg-blue-50/70" : "hover:bg-slate-50/80"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-blue-500" />
        )}
        <button
          onClick={() => item.kind === "direct" ? openDirect(item.id) : openGroup(Number(item.id), item.name)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {item.kind === "group" ? (
            item.avatar ? (
              <img src={imgSrc(item.avatar)} alt={item.name} className="size-10 shrink-0 rounded-lg object-cover transition-transform duration-200 ease-out group-hover:scale-105" />
            ) : (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 transition-transform duration-200 ease-out group-hover:scale-105">
                <Users className="size-5" />
              </span>
            )
          ) : item.avatar ? (
            <img src={imgSrc(item.avatar)} alt={item.name} className="size-10 shrink-0 rounded-full object-cover transition-transform duration-200 ease-out group-hover:scale-105" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-500 transition-transform duration-200 ease-out group-hover:scale-105">
              {item.name.charAt(0)}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1">
                {pinned && <Pin className="size-3 shrink-0 fill-current text-blue-500" />}
                {item.muted && <BellOff className="size-3 shrink-0 text-slate-400" />}
                <span className={cn("truncate text-sm", active ? "font-semibold text-slate-900" : "font-medium text-slate-700")}>{item.name}</span>
              </span>
              <span className={cn("shrink-0 text-[0.65rem]", active ? "text-blue-500" : "text-slate-400")}>{fmtListTime(item.lastAt)}</span>
            </span>
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span className="truncate text-xs text-slate-400">
                {item.lastPreview ? (item.lastSender ? `${item.lastSender === me ? "我" : item.lastSender}: ${item.lastPreview}` : item.lastPreview) : "暂无消息"}
              </span>
              {item.unread > 0 && (
                <span className="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium leading-4 text-white">
                  {item.unread > 99 ? "99+" : item.unread}
                </span>
              )}
            </span>
          </span>
        </button>
        <button
          onClick={() => togglePin(item.kind, item.id)}
          title={pinned ? "取消置顶" : "置顶"}
          className={cn(
            "shrink-0 rounded-md p-1 transition-all duration-200 ease-out",
            pinned ? "text-blue-500" : "text-slate-300 hover:bg-slate-50 hover:text-slate-600"
          )}
        >
          <Pin className={cn("size-3.5", pinned && "fill-current")} />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-[calc(100dvh-6rem)] flex-col gap-2 lg:h-[calc(100dvh-4rem)]">
      <style>{`
        @keyframes msgSlideIn {
          0% { opacity: 0; transform: translateY(16px) scale(0.95); }
          60% { opacity: 1; transform: translateY(-2px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes msgListFade {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .msg-bubble-anim { animation: msgSlideIn 0.32s cubic-bezier(0.22, 0.9, 0.3, 1) both; }
        .msg-list-anim { animation: msgListFade 0.24s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .msg-bubble-anim, .msg-list-anim { animation: none; }
        }
      `}</style>
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-[var(--foreground)]">消息</h1>
        <div className="relative">
          <button
            onClick={() => setMoreOpen((v) => !v)}
            title="更多"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
          >
            <MoreVertical className="size-4" />
            更多
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                {isAdmin && (
                  <button
                    onClick={() => { openSummaryBoard(); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <ListChecks className="size-4" />
                    总结板块
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => { openMonitor(); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <Eye className="size-4" />
                    监控
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => { openEmpSummary(); setMoreOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    <Sparkles className="size-4" />
                    按员工总结
                  </button>
                )}
                <button
                  onClick={() => { setShowCreate(true); setCreateError(null); setMoreOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  <Plus className="size-4" />
                  新建群聊
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-1 gap-2 lg:grid-cols-[280px_1fr]">
        {/* 左侧：群聊 + 员工列表 */}
        <div className={cn("flex flex-col overflow-hidden bg-white border-r border-slate-200/60", selected ? "hidden lg:flex" : "flex")}>
          {/* 搜索聊天记录 */}
          <div className="relative px-3 pb-3 pt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="搜索聊天记录"
                className="h-9 w-full rounded-lg bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-blue-400"
              />
            </div>
            {searchOpen && (
              <div className="absolute left-3 right-3 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                {searching ? (
                  <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">搜索中…</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-[var(--muted-foreground)]">没有找到相关消息</p>
                ) : (
                  searchResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => jumpToResult(r)}
                      className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-[var(--foreground)]">{r.sender} · {r.title}</span>
                        <span className="shrink-0 text-[0.6rem] text-[var(--muted-foreground)]">{toThaiTime(r.created_at) || "—"}</span>
                      </span>
                      <span className="truncate text-xs text-[var(--muted-foreground)]">{r.content}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {contactsLoading ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">加载中…</p>
            ) : groupConversations.length === 0 && directConversations.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-400">暂无会话</p>
            ) : (
              <>
                <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">群聊</div>
                {groupConversations.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-300">暂无群聊</p>
                ) : (
                  <div className="divide-y divide-slate-200">{groupConversations.map(conversationRow)}</div>
                )}
                <div className="px-3 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wider text-slate-400">直连成员</div>
                {directConversations.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-300">暂无聊天</p>
                ) : (
                  <div className="divide-y divide-slate-200">{directConversations.map(conversationRow)}</div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2">
            <div className="flex items-center gap-1">
              <button type="button" title="通知中心" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
                <Bell className="size-4" />
              </button>
              <button type="button" title="已归档会话" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
                <Archive className="size-4" />
              </button>
            </div>
            <button type="button" title="折叠侧栏" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600">
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        </div>

        {/* 右侧：聊天窗口 */}
        <div className={cn(
          "min-h-0 flex-col overflow-hidden rounded-3xl border border-[var(--border)]/60 bg-[var(--card)]/55 backdrop-blur-xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.22)] dark:border-white/15 dark:bg-[var(--card)]/45 dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)]",
          selected ? "flex" : "hidden lg:flex"
        )}>
          {selected ? (
            <>
              <div className="flex items-center gap-3 border-b border-[var(--border)]/60 bg-gradient-to-b from-white/30 via-white/10 to-transparent px-4 py-3 dark:border-white/10 dark:from-white/10 dark:via-white/5">
                <button
                  onClick={() => setSelected(null)}
                  aria-label="返回会话列表"
                  className="-ml-1 shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] lg:hidden"
                >
                  <ChevronLeft className="size-5" />
                </button>
                {isGroup ? (
                  isGroupOwner ? (
                    <button
                      onClick={openGroupAvatar}
                      title="设置群头像"
                      className="shrink-0 overflow-hidden rounded-lg transition-opacity hover:opacity-80"
                    >
                      {activeGroup?.avatar ? (
                        <img src={imgSrc(activeGroup.avatar)} alt={selected.name} className="size-10 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] text-[var(--primary)]">
                          <Users className="size-5" />
                        </span>
                      )}
                    </button>
                  ) : activeGroup?.avatar ? (
                    <img src={imgSrc(activeGroup.avatar)} alt={selected.name} className="size-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] text-sm font-medium text-[var(--primary)]">
                      <Users className="size-5" />
                    </span>
                  )
                ) : selectedAvatar ? (
                  <img src={imgSrc(selectedAvatar)} alt={selected.name} className="size-10 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex size-10 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] text-sm font-medium text-[var(--primary)]">
                    {selected.name.charAt(0)}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{selected.name}</p>
                  {typingUsers.length > 0 ? (
                    <p className="truncate text-xs text-[var(--primary)]">
                      {isGroup ? `${typingUsers.join("、")} 正在输入…` : "对方正在输入…"}
                    </p>
                  ) : isGroup ? (
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {groups.find((g) => g.id === selected.id)?.members.length ?? 0} 人
                    </p>
                  ) : null}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  {isGroupOwner && (
                    <button
                      onClick={openAnnouncement}
                      title="群公告"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Megaphone className="size-4" />
                      公告
                    </button>
                  )}
                  {isGroupOwner && (
                    <button
                      onClick={openGroupBackground}
                      title="群背景"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Palette className="size-4" />
                      群背景
                    </button>
                  )}
                  {isGroupOwner && (
                    <button
                      onClick={openRename}
                      title="修改群名称"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Pencil className="size-4" />
                      改名
                    </button>
                  )}
                  {isGroupOwner && (
                    <button
                      onClick={() => setDisbandOpen(true)}
                      title="解散群聊"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                      解散
                    </button>
                  )}
                  {isGroup && (
                    <button
                      onClick={openMembers}
                      title="群成员列表"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Users className="size-4" />
                      成员
                    </button>
                  )}
                  {isGroup && (
                    <button
                      onClick={toggleMute}
                      title={activeGroup?.muted ? "取消免打扰" : "开启免打扰"}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                        activeGroup?.muted
                          ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] text-[var(--primary)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      )}
                    >
                      {activeGroup?.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
                      免打扰
                    </button>
                  )}
                  {isGroup && !isGroupOwner && (
                    <button
                      onClick={() => setLeaveOpen(true)}
                      title="退出群聊"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <LogOut className="size-4" />
                      退群
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={openSummary}
                      title="AI 总结"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                    >
                      <Sparkles className="size-4" />
                      总结
                    </button>
                  )}
                  <button
                    onClick={openBackground}
                    title="聊天背景"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                  >
                    <Palette className="size-4" />
                    背景
                  </button>
                  <button
                    onClick={exportChat}
                    disabled={exporting}
                    title="导出聊天记录"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    <Download className="size-4" />
                    {exporting ? "导出中…" : "导出记录"}
                  </button>
                </div>
              </div>

              {isGroup && groupAnnouncement && (
                <div className="border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)] px-4 py-2">
                  <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--foreground)]">
                    <Megaphone className="mt-0.5 size-3.5 shrink-0 text-[var(--primary)]" />
                    <span className="whitespace-pre-wrap break-words">{groupAnnouncement}</span>
                  </p>
                </div>
              )}

              <div ref={scrollRef} key={selectedKey} style={chatBgStyle} className="msg-list-anim min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--muted)]/50 p-4 shadow-[inset_0_8px_14px_-8px_rgba(0,0,0,0.16)]">
                {messages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <MessageSquare className="size-9 text-[var(--muted-foreground)]/40" />
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">还没有消息，发一句打个招呼吧</p>
                  </div>
                ) : (
                  messages.map((m) => {
                    // 系统消息（退群等，sender 为空串）：居中灰字显示，不按普通气泡渲染
                    if (m.sender === "") {
                      return (
                        <div key={m.id} id={`msg-${m.id}`} className="msg-bubble-anim flex justify-center py-1">
                          <p className="rounded-full bg-[var(--muted)]/60 px-3 py-1 text-xs text-[var(--muted-foreground)]">{m.content}</p>
                        </div>
                      );
                    }
                    const mine = m.sender === me;
                    const isImage = !!m.image_url;
                    const card = parseCard(m);
                    const showRead = isDirect && mine;
                    const recalled = !!m.recalled;
                    const canRecall = mine && !recalled && within2Min(m.created_at);
                    const isMentioned = isGroup && !!m.mentioned_members?.includes(me);
                    const isMentionAll = isGroup && m.content.includes("@所有人");
                    const senderAvatar = avatarOf(m.sender);
                    return (
                      <div
                        key={m.id}
                        id={`msg-${m.id}`}
                        className={cn("group msg-bubble-anim flex items-end gap-2", mine ? "flex-row-reverse" : "flex-row")}
                        onContextMenu={(e) => { e.preventDefault(); showMessageMenu(m.id, e.clientX, e.clientY); }}
                        onTouchStart={(e) => startLongPress(e, m.id)}
                        onTouchEnd={cancelLongPress}
                        onTouchMove={cancelLongPress}
                      >
                        {senderAvatar ? (
                          <img src={imgSrc(senderAvatar)} alt={m.sender} className="size-9 shrink-0 rounded-full object-cover" />
                        ) : (
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] text-sm font-medium text-[var(--primary)]">
                            {m.sender.charAt(0)}
                          </span>
                        )}
                        <div className={cn("flex max-w-[70%] flex-col", mine ? "items-end" : "items-start")}>
                          {isGroup && !mine && (
                            <p className="mb-1 px-1 text-[0.65rem] text-[var(--muted-foreground)]">{m.sender}</p>
                          )}
                          {m.reply_to != null && m.reply_preview && (
                            <button
                              onClick={() => jumpToMessage(m.reply_to!)}
                              title="点击跳转到原消息"
                              className={cn(
                                "mb-1 block max-w-[240px] truncate rounded-md border-l-2 border-[var(--primary)] bg-[var(--background)]/70 px-2 py-1 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]/60",
                                mine && "self-end text-right"
                              )}
                            >
                              {m.reply_preview}
                            </button>
                          )}
                          {recalled ? (
                            <div className="rounded-2xl border border-white/20 bg-[var(--muted)]/60 px-3 py-2 text-sm text-[var(--muted-foreground)] backdrop-blur-sm dark:border-white/10">
                              <p className="italic">已撤回</p>
                            </div>
                          ) : card ? (
                            <button
                              onClick={() => router.push(CARD_META[card.kind].href(card.id))}
                              className={cn(
                                "block max-w-[250px] rounded-2xl p-3 text-left shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)] transition-colors",
                                mine
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "border border-white/40 bg-[var(--background)]/70 text-[var(--foreground)] backdrop-blur-sm hover:border-[var(--primary)] dark:border-white/15"
                              )}
                            >
                              <span className={cn("inline-flex items-center gap-1 text-[0.65rem]", mine ? "text-[var(--primary-foreground)]/70" : "text-[var(--muted-foreground)]")}>
                                <FileText className="size-3.5" /> {CARD_META[card.kind].label}
                              </span>
                              <span className="mt-1 block truncate text-sm font-medium">{card.title}</span>
                              {card.subtitle && (
                                <span className={cn("mt-0.5 block truncate text-xs", mine ? "text-[var(--primary-foreground)]/70" : "text-[var(--muted-foreground)]")}>{card.subtitle}</span>
                              )}
                            </button>
                          ) : (
                            <div
                              className={cn(
                                "max-w-full rounded-2xl text-sm shadow-[0_2px_8px_-2px_rgba(0,0,0,0.18)]",
                                mine
                                  ? "rounded-br-md bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : isMentioned
                                    ? "rounded-bl-md bg-amber-500/15 text-[var(--foreground)]"
                                    : "rounded-bl-md border border-white/40 bg-[var(--background)]/70 text-[var(--foreground)] backdrop-blur-sm dark:border-white/15",
                                isImage ? "p-1" : "px-3 py-2"
                              )}
                            >
                              {isImage ? (
                                <button onClick={() => setLightbox(m.image_url)} className="block max-w-full" title="查看大图">
                                  <img src={imgSrc(m.image_url)} alt="图片消息" className="max-h-60 max-w-full cursor-zoom-in rounded-xl object-contain" />
                                </button>
                              ) : (
                                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                              )}
                            </div>
                          )}
                          <p className="mt-1 flex items-center gap-1.5 px-1 text-[0.6rem] text-[var(--muted-foreground)]">
                            {toThaiTime(m.created_at) || "—"}
                            {isMentioned && !mine && <span className="font-medium text-amber-600">{isMentionAll ? "@全体" : "@你"}</span>}
                            {canRecall && <button onClick={() => recallMessage(m)} className="opacity-70 hover:opacity-100">撤回</button>}
                            {showRead && !recalled && <span>{m.is_read ? "已读" : "未读"}</span>}
                            {isGroup && !recalled && (
                              <button onClick={() => openReadDetail(m)} className="opacity-70 hover:opacity-100" title="查看谁读了谁没读">
                                已读 {m.read_members?.length ?? 0}/{groupMemberCount}
                              </button>
                            )}
                            {!recalled && !card && !isImage && (
                              <button onClick={() => toggleTranslate(m.id)} className="opacity-70 hover:opacity-100">
                                <Languages className="mr-0.5 inline size-3" />翻译
                              </button>
                            )}
                          </p>
                          {!recalled && !card && !isImage && translateOpen.has(m.id) && (
                            <div className={cn("mt-1 rounded-lg border border-[var(--border)]/70 bg-[var(--background)]/70 px-2 py-1.5", mine ? "self-end text-right" : "self-start text-left")}>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => doTranslate(m.id, "中文")}
                                  disabled={translating?.startsWith(`${m.id}:`)}
                                  className="text-[0.65rem] font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
                                >
                                  翻译成中文
                                </button>
                                <button
                                  onClick={() => doTranslate(m.id, "泰语")}
                                  disabled={translating?.startsWith(`${m.id}:`)}
                                  className="text-[0.65rem] font-medium text-[var(--primary)] hover:underline disabled:opacity-50"
                                >
                                  翻译成泰语
                                </button>
                              </div>
                              {translating?.startsWith(`${m.id}:`) && (
                                <p className="mt-1 text-[0.65rem] text-[var(--muted-foreground)]">翻译中…</p>
                              )}
                              {translations.get(`${m.id}:中文`) && (
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--foreground)]/90">
                                  <span className="text-[var(--muted-foreground)]">中文：</span>{translations.get(`${m.id}:中文`)}
                                </p>
                              )}
                              {translations.get(`${m.id}:泰语`) && (
                                <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--foreground)]/90">
                                  <span className="text-[var(--muted-foreground)]">泰语：</span>{translations.get(`${m.id}:泰语`)}
                                </p>
                              )}
                            </div>
                          )}
                          {(reactions.get(m.id)?.length ?? 0) > 0 && (
                            <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
                              {reactions.get(m.id)!.map((r) => {
                                const iReacted = r.users.includes(me);
                                return (
                                  <button
                                    key={r.emoji}
                                    onClick={() => toggleReaction(m.id, r.emoji)}
                                    title={r.users.join("、")}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                                      iReacted
                                        ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] text-[var(--foreground)]"
                                        : "border-[var(--border)] bg-[var(--background)] text-[var(--muted-foreground)] hover:border-[var(--primary)]"
                                    )}
                                  >
                                    <span className="text-sm leading-none">{r.emoji}</span>
                                    <span className="tabular-nums">{r.users.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="hidden shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 md:flex">
                          <button
                            onClick={() => copyMessage(m)}
                            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                          >
                            复制
                          </button>
                          <button
                            onClick={() => toggleTranslate(m.id)}
                            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                          >
                            翻译
                          </button>
                          {canRecall && (
                            <button
                              onClick={() => recallMessage(m)}
                              className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                            >
                              撤回
                            </button>
                          )}
                          <button
                            onClick={(e) => openEmojiPicker(m.id, e.clientX, e.clientY)}
                            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                          >
                            表情
                          </button>
                          <button
                            onClick={() => setReplyTo({ id: m.id, sender: m.sender, preview: quotePreview(m) })}
                            className="rounded-md border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[0.6rem] text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                          >
                            引用
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {error && <p className="px-4 pt-2 text-xs text-red-500">{error}</p>}

              <div className="relative border-t border-[var(--border)]/60 bg-transparent p-3 dark:border-white/10">
                {mentionOpen && selected?.kind === "group" && (
                  <div className="absolute bottom-full left-3 right-3 z-20 mb-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-2xl">
                    {showMentionAll && (
                      <button
                        onClick={() => pickMention("所有人")}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                      >
                        <span className="flex size-6 items-center justify-center rounded-full bg-amber-500/15 text-xs font-medium text-amber-600">@</span>
                        所有人
                      </button>
                    )}
                    {mentionMembers.length === 0 && !showMentionAll ? (
                      <p className="px-3 py-3 text-center text-xs text-[var(--muted-foreground)]">没有匹配的成员</p>
                    ) : (
                      mentionMembers.map((n) => (
                        <button
                          key={n}
                          onClick={() => pickMention(n)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                        >
                          <span className="flex size-6 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-xs text-[var(--primary)]">{n.charAt(0)}</span>
                          {n}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {emojiPanelOpen && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-[300px] rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl">
                    <div className="grid grid-cols-8 gap-0.5">
                      {EMOJI_LIST.map((e) => (
                        <button
                          key={e}
                          onClick={() => insertEmoji(e)}
                          className="flex size-8 items-center justify-center rounded-md text-xl transition-colors hover:bg-[var(--muted)]"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {replyTo && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--primary),var(--background)_94%)] px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--muted-foreground)]">
                      回复 <span className="font-medium text-[var(--foreground)]">{replyTo.sender}</span>：{replyTo.preview}
                    </span>
                    <button onClick={() => setReplyTo(null)} aria-label="取消引用" className="shrink-0 rounded p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                      <X className="size-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (mentionOpen) { setMentionOpen(false); return; }
                        sendText();
                      }
                    }}
                    placeholder={`发消息给 ${selected.name}`}
                    className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--background)] px-4 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] transition-colors focus:border-[var(--ring)] focus:ring-2 focus:ring-[var(--ring)]/20"
                  />
                  <button
                    onClick={() => setEmojiPanelOpen((v) => !v)}
                    title="表情"
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors",
                      emojiPanelOpen ? "bg-[var(--muted)] text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <Smile className="size-5" />
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
                    title="发送图片"
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    <ImagePlus className="size-5" />
                  </button>
                  <button
                    onClick={openSharePicker}
                    disabled={sending}
                    title="分享"
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-50"
                  >
                    <FileText className="size-5" />
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
                  <button
                    onClick={sendText}
                    disabled={sending || !input.trim()}
                    className={cn(
                      "h-11 shrink-0 rounded-xl px-4 text-sm font-medium transition active:scale-95",
                      input.trim() && !sending
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90"
                        : "cursor-not-allowed bg-[var(--muted)] text-[var(--muted-foreground)]"
                    )}
                  >
                    {sending ? "发送中…" : "发送"}
                  </button>
                </div>
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

      {/* 分享：先选分类，再选条目 */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShareOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">{shareCategory ? `选择${CARD_META[shareCategory as CardKind].label}` : "选择分享分类"}</h3>
              <button
                onClick={() => { if (shareCategory) { setShareCategory(""); setShareItems([]); setShareError(null); } else { setShareOpen(false); } }}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="size-5" />
              </button>
            </div>

            {!shareCategory ? (
              <div className="grid grid-cols-2 gap-2">
                {SHARE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => pickShareCategory(cat.key)}
                    className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--primary)]"
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            ) : shareLoading ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : shareItems.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">{shareError || "暂无数据"}</p>
            ) : (
              <div className="space-y-1.5">
                {shareItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => sendCard(shareCategory, item.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[var(--primary)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--foreground)]">{item.title}</span>
                      {item.subtitle && <span className="block truncate text-xs text-[var(--muted-foreground)]">{item.subtitle}</span>}
                    </span>
                    <span className="ml-3 shrink-0 text-xs font-medium text-[var(--primary)]">发送</span>
                  </button>
                ))}
              </div>
            )}
            {shareError && shareItems.length > 0 && <p className="mt-2 text-xs text-red-500">{shareError}</p>}
          </div>
        </div>
      )}

      {/* AI 总结 */}
      {summaryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSummaryOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">AI 总结</h3>
              <button onClick={() => setSummaryOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {/* 生成 / 历史 切换 */}
            <div className="mb-3 flex gap-1 rounded-lg bg-[var(--muted)]/40 p-1">
              <button
                onClick={() => { setSummaryTab("generate"); setViewingSummary(null); }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  summaryTab === "generate" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                生成
              </button>
              <button
                onClick={() => { setSummaryTab("history"); setViewingSummary(null); loadSummaryHistory(); }}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  summaryTab === "history" ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                历史总结
              </button>
            </div>

            {summaryTab === "generate" ? (
              <>
                {/* 时间档位 */}
                <div className="flex flex-wrap gap-2">
                  {SUMMARY_RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setSummaryRange(r.key)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition-colors",
                        summaryRange === r.key
                          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                          : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]"
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={generateSummary}
                  disabled={summaryLoading}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Sparkles className="size-3.5" />
                  {summaryLoading ? "生成中…" : "生成总结"}
                </button>

                {summaryError && <p className="mt-3 text-xs text-red-500">{summaryError}</p>}

                {summaryResult && (
                  <div className="mt-4">
                    {summaryResult.cached && (
                      <p className="mb-2 text-[0.65rem] text-[var(--muted-foreground)]">本次结果来自缓存</p>
                    )}
                    <AssigneeSelect value={todoAssignee} onChange={setTodoAssignee} contacts={contacts} />
                    <SummaryBlocks data={summaryResult} onConvert={convertToTodo} converted={convertedTodos} />
                  </div>
                )}
              </>
            ) : viewingSummary ? (
              <>
                <button onClick={() => setViewingSummary(null)} className="mb-3 text-xs text-[var(--primary)] hover:underline">← 返回列表</button>
                <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                  生成于 {toThaiTime(viewingSummary.created_at)} · 范围 {toThaiDate(viewingSummary.from_at)} ~ {toThaiDate(viewingSummary.to_at)}
                </p>
                <AssigneeSelect value={todoAssignee} onChange={setTodoAssignee} contacts={contacts} />
                <SummaryBlocks data={viewingSummary} onConvert={convertToTodo} converted={convertedTodos} />
              </>
            ) : summaryHistoryLoading ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
            ) : summaryHistoryError ? (
              <p className="py-8 text-center text-xs text-red-500">{summaryHistoryError}</p>
            ) : summaryHistory.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">还没有总结记录，先生成一次试试</p>
            ) : (
              <div className="space-y-1.5">
                {summaryHistory.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setViewingSummary(s)}
                    className="flex w-full flex-col gap-0.5 rounded-lg border border-[var(--border)] px-3 py-2 text-left transition-colors hover:border-[var(--primary)]"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--foreground)]">{toThaiTime(s.created_at) || "—"}</span>
                      <span className="shrink-0 text-[0.65rem] text-[var(--muted-foreground)]">{toThaiDate(s.from_at)} ~ {toThaiDate(s.to_at)}</span>
                    </span>
                    <span className="truncate text-xs text-[var(--muted-foreground)]">{s.topics}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 按员工总结 */}
      {empSummaryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEmpSummaryOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">按员工总结</h3>
              <button onClick={() => setEmpSummaryOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">
              选一个员工，一键看他最近跟所有人聊了什么、答应了什么、手上有什么待办。
            </p>

            <select
              value={empSummaryName}
              onChange={(e) => setEmpSummaryName(e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
            >
              <option value="">选择员工</option>
              {contacts.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>

            <div className="mt-3 flex flex-wrap gap-2">
              {SUMMARY_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setEmpSummaryRange(r.key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    empSummaryRange === r.key
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]"
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <button
              onClick={generateEmpSummary}
              disabled={empSummaryLoading || !empSummaryName}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Sparkles className="size-3.5" />
              {empSummaryLoading ? "生成中…" : "生成总结"}
            </button>

            {empSummaryError && <p className="mt-3 text-xs text-red-500">{empSummaryError}</p>}

            {empSummaryResult && (
              <div className="mt-4">
                {empSummaryResult.cached && (
                  <p className="mb-2 text-[0.65rem] text-[var(--muted-foreground)]">本次结果来自缓存</p>
                )}
                <AssigneeSelect value={todoAssignee} onChange={setTodoAssignee} contacts={contacts} />
                <SummaryBlocks data={empSummaryResult} onConvert={convertToTodo} converted={convertedTodos} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 总结板块（管理员） */}
      {summaryBoardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSummaryBoardOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h3 className="font-semibold text-[var(--foreground)]">总结板块</h3>
              <button onClick={() => setSummaryBoardOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
              <p className="text-xs text-[var(--muted-foreground)]">一键批量总结所有有消息的会话，生成后缓存，下次点直接看、不重复花钱。</p>
              <button
                onClick={generateSummaryBoard}
                disabled={summaryBoardGenerating}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="size-3.5" />
                {summaryBoardGenerating ? "生成中…" : "生成总结"}
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {summaryBoardError ? (
                <p className="py-8 text-center text-xs text-red-500">{summaryBoardError}</p>
              ) : summaryBoardLoading ? (
                <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              ) : summaryBoardList.length === 0 ? (
                <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">还没有总结，点右上角「生成总结」批量生成</p>
              ) : (
                summaryBoardList.map((s) => (
                  <div key={s.conversation_id} className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
                    <p className="mb-2 text-sm font-medium text-[var(--foreground)]">
                      {s.user_a} ↔ {s.user_b}
                      <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">{s.message_count} 条</span>
                    </p>
                    <SummaryBlocks data={s} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 聊天监控（管理员） */}
      {monitorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMonitorOpen(false)}>
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h3 className="font-semibold text-[var(--foreground)]">聊天监控</h3>
              <button onClick={() => setMonitorOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {!monitorDetail && (
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-2.5">
                <span className="text-xs text-[var(--muted-foreground)]">时间</span>
                {MONITOR_RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => { setMonitorRange(r.key); loadMonitorList(r.key, monitorEmployee); }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      monitorRange === r.key
                        ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--primary)]"
                    )}
                  >
                    {r.label}
                  </button>
                ))}
                <span className="ml-2 text-xs text-[var(--muted-foreground)]">员工</span>
                <select
                  value={monitorEmployee}
                  onChange={(e) => { const v = e.target.value; setMonitorEmployee(v); loadMonitorList(monitorRange, v); }}
                  className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)]"
                >
                  <option value="">全部员工</option>
                  {me && <option value={me}>{me}</option>}
                  {contacts.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {monitorDetail ? (
                <>
                  <button onClick={() => setMonitorDetail(null)} className="mb-3 text-xs text-[var(--primary)] hover:underline">← 返回会话列表</button>
                  <p className="mb-3 text-sm font-medium text-[var(--foreground)]">
                    {monitorDetail.conversation.user_a} ↔ {monitorDetail.conversation.user_b}
                  </p>
                  {monitorDetail.messages.length === 0 ? (
                    <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无消息</p>
                  ) : (
                    <div className="space-y-3">
                      {monitorDetail.messages.map((m) => {
                        const isA = m.sender === monitorDetail.conversation.user_a;
                        const card = parseCard(m);
                        const sensitive = containsSensitiveWord(m.content);
                        return (
                          <div key={m.id} className={cn("flex", isA ? "justify-start" : "justify-end")}>
                            <div className="max-w-[70%]">
                              <p className={cn("mb-0.5 text-[0.65rem] text-[var(--muted-foreground)]", isA ? "text-left" : "text-right")}>{m.sender}</p>
                              {m.recalled ? (
                                <div className="rounded-2xl bg-[var(--muted)] px-3 py-2 text-sm italic text-[var(--muted-foreground)]">已撤回</div>
                              ) : m.image_url ? (
                                <img src={imgSrc(m.image_url)} alt="图片" className="max-h-60 max-w-full rounded-xl object-contain" />
                              ) : card ? (
                                <button
                                  onClick={() => router.push(CARD_META[card.kind].href(card.id))}
                                  className="block max-w-[240px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 text-left transition-colors hover:border-[var(--primary)]"
                                >
                                  <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--muted-foreground)]"><FileText className="size-3.5" /> {CARD_META[card.kind].label}</span>
                                  <span className="mt-1 block truncate text-sm font-medium text-[var(--foreground)]">{card.title}</span>
                                  {card.subtitle && <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">{card.subtitle}</span>}
                                </button>
                              ) : (
                                <div className={cn(
                                  "rounded-2xl px-3 py-2 text-sm",
                                  sensitive
                                    ? "border border-amber-500/60 bg-[color-mix(in_oklch,var(--warning),var(--background)_88%)] text-[var(--foreground)]"
                                    : isA
                                      ? "rounded-bl-md border border-[var(--border)]/70 bg-[var(--background)] text-[var(--foreground)]"
                                      : "rounded-br-md bg-[var(--primary)] text-[var(--primary-foreground)]"
                                )}>
                                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                                </div>
                              )}
                              <p className={cn("mt-0.5 flex items-center gap-1.5 text-[0.6rem] text-[var(--muted-foreground)]", isA ? "justify-start" : "justify-end")}>
                                {sensitive && <span className="font-medium text-amber-600">敏感</span>}
                                <span>{toThaiTime(m.created_at) || "—"}</span>
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : monitorLoading ? (
                <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              ) : monitorError ? (
                <p className="py-8 text-center text-xs text-red-500">{monitorError}</p>
              ) : monitorList.length === 0 ? (
                <p className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无员工之间的会话</p>
              ) : (
                <>
                {monitorActivity.length > 0 && (
                  <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2.5">
                    <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">员工活跃度（按消息量排行）</p>
                    <div className="flex flex-wrap gap-1.5">
                      {monitorActivity.map((a, i) => (
                        <div
                          key={a.employee}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md border px-2 py-1",
                            i === 0
                              ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_92%)]"
                              : "border-[var(--border)] bg-[var(--background)]"
                          )}
                        >
                          <span className="text-xs font-medium text-[var(--foreground)]">{a.employee}</span>
                          <span className="text-[0.65rem] text-[var(--muted-foreground)]">{a.partner_count} 人 · {a.message_count} 条</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {monitorList.map((c) => {
                    const high = isHighVolume(c.message_count);
                    return (
                      <button
                        key={c.id}
                        onClick={() => openMonitorConversation(c.id)}
                        className={cn(
                          "rounded-xl border p-3 text-left transition-colors",
                          high
                            ? "border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),var(--background)_94%)] hover:border-[var(--destructive)]"
                            : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]"
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="truncate text-sm font-medium text-[var(--foreground)]">{c.user_a} ↔ {c.user_b}</span>
                            {high && (
                              <span className="shrink-0 rounded-full bg-[var(--destructive)] px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white">高频</span>
                            )}
                            {c.has_sensitive && (
                              <span className="shrink-0 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white">敏感</span>
                            )}
                          </span>
                          <span className="shrink-0 text-[0.65rem] text-[var(--muted-foreground)]">{fmtListTime(c.last_at)}</span>
                        </span>
                        <span className="mt-1.5 block truncate text-xs text-[var(--muted-foreground)]">{c.last_sender}: {c.last_preview || "—"}</span>
                        <span className={cn("mt-1 block text-[0.65rem]", high ? "font-medium text-[var(--destructive)]" : "text-[var(--muted-foreground)]")}>
                          {c.message_count} 条消息
                        </span>
                      </button>
                    );
                  })}
                </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 聊天背景设置 */}
      {bgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBgOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">聊天背景</h3>
              <button onClick={() => setBgOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">设置后立即生效，只对自己可见，换设备也保留。</p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CHAT_BACKGROUND_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyBackground(p.key)}
                  disabled={bgSaving}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors disabled:opacity-60",
                    chatBackground === p.key ? "border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                  )}
                >
                  <span className="h-12 w-full rounded-md border border-[var(--border)]" style={{ background: p.style }} />
                  <span className="text-xs text-[var(--foreground)]">{p.label}</span>
                </button>
              ))}

              <button
                onClick={() => bgInputRef.current?.click()}
                disabled={bgSaving}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors disabled:opacity-60",
                  chatBackground.startsWith("/api/files/") ? "border-[var(--primary)]" : "border-dashed border-[var(--border)] hover:border-[var(--primary)]"
                )}
              >
                <span className="flex h-12 w-full items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
                  <ImagePlus className="size-5" />
                </span>
                <span className="text-xs text-[var(--foreground)]">自定义图片</span>
              </button>
            </div>

            <input ref={bgInputRef} type="file" accept="image/*" onChange={handleCustomBgPick} className="hidden" />

            <button
              onClick={() => applyBackground("")}
              disabled={bgSaving}
              className="mt-4 inline-flex items-center rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              恢复默认背景
            </button>
          </div>
        </div>
      )}

      {/* 群背景设置（群主） */}
      {groupBgOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setGroupBgOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">群背景</h3>
              <button onClick={() => setGroupBgOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">设置后全群统一显示该背景。</p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CHAT_BACKGROUND_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => applyGroupBackground(p.key)}
                  disabled={groupBgSaving}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors disabled:opacity-60",
                    groupBackground === p.key ? "border-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--primary)]"
                  )}
                >
                  <span className="h-12 w-full rounded-md border border-[var(--border)]" style={{ background: p.style }} />
                  <span className="text-xs text-[var(--foreground)]">{p.label}</span>
                </button>
              ))}

              <button
                onClick={() => groupBgInputRef.current?.click()}
                disabled={groupBgSaving}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors disabled:opacity-60",
                  groupBackground.startsWith("/api/files/") ? "border-[var(--primary)]" : "border-dashed border-[var(--border)] hover:border-[var(--primary)]"
                )}
              >
                <span className="flex h-12 w-full items-center justify-center rounded-md border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
                  <ImagePlus className="size-5" />
                </span>
                <span className="text-xs text-[var(--foreground)]">自定义图片</span>
              </button>
            </div>

            <input ref={groupBgInputRef} type="file" accept="image/*" onChange={handleGroupBgPick} className="hidden" />

            <button
              onClick={() => applyGroupBackground("")}
              disabled={groupBgSaving}
              className="mt-4 inline-flex items-center rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
            >
              恢复默认背景
            </button>
          </div>
        </div>
      )}

      {/* 群公告编辑（群主） */}
      {announcementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAnnouncementOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">群公告</h3>
              <button onClick={() => setAnnouncementOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-2 text-xs text-[var(--muted-foreground)]">发布后全群可见，重新发布会覆盖旧的，只保留最新一条。</p>
            <textarea
              value={announcementText}
              onChange={(e) => setAnnouncementText(e.target.value)}
              placeholder="写一条群公告…"
              rows={4}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={() => setAnnouncementOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">取消</button>
              <button
                onClick={saveAnnouncement}
                disabled={announcementSaving}
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {announcementSaving ? "发布中…" : "发布"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 群头像设置（群主） */}
      {groupAvatarOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setGroupAvatarOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">群头像</h3>
              <button onClick={() => setGroupAvatarOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">上传一张图片当群头像，或使用默认群图标。全群可见。</p>
            <div className="mb-4 flex justify-center">
              {activeGroup?.avatar ? (
                <img src={imgSrc(activeGroup.avatar)} alt="群头像" className="size-20 rounded-2xl object-cover" />
              ) : (
                <span className="flex size-20 items-center justify-center rounded-2xl bg-[color-mix(in_oklch,var(--primary),var(--background)_82%)] text-[var(--primary)]">
                  <Users className="size-10" />
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => groupAvatarInputRef.current?.click()}
                disabled={groupAvatarSaving}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] px-3 py-2 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                <ImagePlus className="size-4" />
                上传图片
              </button>
              <button
                onClick={() => applyGroupAvatar("")}
                disabled={groupAvatarSaving}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50"
              >
                <Users className="size-4" />
                默认图标
              </button>
            </div>
            <input ref={groupAvatarInputRef} type="file" accept="image/*" onChange={handleGroupAvatarPick} className="hidden" />
          </div>
        </div>
      )}

      {/* 群改名（群主） */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRenameOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">修改群名称</h3>
              <button onClick={() => setRenameOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <input
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              placeholder="输入新的群名称"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--ring)]"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button onClick={() => setRenameOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">取消</button>
              <button
                onClick={saveRename}
                disabled={renameSaving}
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {renameSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 群成员列表（所有人可看，群主可管理） */}
      {membersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMembersOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">群成员</h3>
              <button onClick={() => setMembersOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <label className="mb-1 block text-xs text-[var(--muted-foreground)]">成员名单（{(activeGroup?.members ?? []).length}）</label>
            <div className="mb-3 max-h-[30vh] overflow-y-auto rounded-md border border-[var(--border)] p-1">
              {(activeGroup?.members ?? []).map((name) => {
                const isOwner = name === activeGroup?.owner;
                const av = avatarOf(name);
                return (
                  <div key={name} className="flex items-center gap-2 rounded px-2 py-1.5">
                    {av ? (
                      <img src={imgSrc(av)} alt={name} className="size-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_80%)] text-xs text-[var(--primary)]">{name.charAt(0)}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--foreground)]">{name}</span>
                    {isOwner ? (
                      <span className="shrink-0 rounded-full bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--primary)]">群主</span>
                    ) : isGroupOwner ? (
                      <>
                        <button
                          onClick={() => confirmTransfer(name)}
                          disabled={membersSaving || transferSaving}
                          className="shrink-0 rounded px-2 py-0.5 text-xs text-[var(--primary)] transition-colors hover:bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)] disabled:opacity-50"
                        >
                          转让
                        </button>
                        <button
                          onClick={() => removeMember(name)}
                          disabled={membersSaving || transferSaving}
                          className="shrink-0 rounded px-2 py-0.5 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                        >
                          移除
                        </button>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {isGroupOwner && (
              <>
                <label className="mb-1 block text-xs text-[var(--muted-foreground)]">邀请成员（从员工里选）</label>
                <div className="max-h-[28vh] overflow-y-auto rounded-md border border-[var(--border)] p-2">
                  {contacts.filter((c) => !(activeGroup?.members ?? []).includes(c.name)).length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-[var(--muted-foreground)]">没有可邀请的员工</p>
                  ) : (
                    contacts.filter((c) => !(activeGroup?.members ?? []).includes(c.name)).map((c) => (
                      <label key={c.name} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--muted)]">
                        <input
                          type="checkbox"
                          checked={inviteCandidates.includes(c.name)}
                          onChange={() => toggleInvite(c.name)}
                          className="size-4 accent-[var(--primary)]"
                        />
                        <span className="text-sm text-[var(--foreground)]">{c.name}</span>
                        <span className="text-xs text-[var(--muted-foreground)]">{c.role === "admin" ? "管理员" : "员工"}</span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}

            {membersError && <p className="mt-2 text-xs text-red-500">{membersError}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setMembersOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">关闭</button>
              {isGroupOwner && (
                <button
                  onClick={inviteMembers}
                  disabled={membersSaving || inviteCandidates.length === 0}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
                >
                  {membersSaving ? "处理中…" : inviteCandidates.length > 0 ? `邀请（${inviteCandidates.length}）` : "邀请"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 转让群主确认 */}
      {transferTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!transferSaving) setTransferTarget(null); }}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">转让群主</h3>
              <button onClick={() => setTransferTarget(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-4 text-sm text-[var(--foreground)]">
              确定将群主转让给「{transferTarget}」吗？转让后你将变成普通成员。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setTransferTarget(null)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">取消</button>
              <button
                onClick={doTransfer}
                disabled={transferSaving}
                className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {transferSaving ? "转让中…" : "确认转让"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 退群确认（普通成员） */}
      {leaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!leaveSaving) setLeaveOpen(false); }}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">退出群聊</h3>
              <button onClick={() => setLeaveOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-4 text-sm text-[var(--foreground)]">
              确定退出群聊「{selected?.kind === "group" ? selected.name : ""}」吗？退出后将看不到这个群，也收不到群消息。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setLeaveOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">取消</button>
              <button
                onClick={leaveGroup}
                disabled={leaveSaving}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {leaveSaving ? "退出中…" : "确认退出"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 解散群确认（群主） */}
      {disbandOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!disbandSaving) setDisbandOpen(false); }}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">解散群聊</h3>
              <button onClick={() => setDisbandOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-4 text-sm text-[var(--foreground)]">
              确定解散群聊「{selected?.kind === "group" ? selected.name : ""}」吗？解散后所有成员都将看不到这个群，群里的聊天记录会被删除，此操作不可恢复。
            </p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDisbandOpen(false)} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">取消</button>
              <button
                onClick={disbandGroup}
                disabled={disbandSaving}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {disbandSaving ? "解散中…" : "确认解散"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 长按消息操作菜单 */}
      {menuState && (() => {
        const m = messages.find((x) => x.id === menuState.id);
        if (!m) return null;
        const canRecall = m.sender === me && !m.recalled && within2Min(m.created_at);
        const items: { label: string; onClick: () => void }[] = [
          { label: "复制", onClick: () => copyMessage(m) },
          { label: "翻译", onClick: () => { toggleTranslate(m.id); setMenuState(null); } },
          ...(canRecall ? [{ label: "撤回", onClick: () => { recallMessage(m); setMenuState(null); } }] : []),
          { label: "引用回复", onClick: () => { setReplyTo({ id: m.id, sender: m.sender, preview: quotePreview(m) }); setMenuState(null); } },
          { label: "表情反应", onClick: () => openEmojiPicker(m.id, menuState.x, menuState.y) },
        ];
        return (
          <>
            <div className="fixed inset-0 z-[99]" onClick={closeMenu} />
            <div
              className="fixed z-[100] min-w-[128px] rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 shadow-xl"
              style={{ left: menuState.x, top: menuState.y }}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  onClick={it.onClick}
                  className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
                >
                  {it.label}
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {/* 表情反应选择器 */}
      {emojiPickerState && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setEmojiPickerState(null)} />
          <div
            className="fixed z-[100] flex gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-xl"
            style={{ left: emojiPickerState.x, top: emojiPickerState.y }}
          >
            {REACTION_EMOJIS.map((r) => (
              <button
                key={r.emoji}
                onClick={() => toggleReaction(emojiPickerState.id, r.emoji)}
                title={r.label}
                className="flex size-10 items-center justify-center rounded-xl text-xl transition-colors hover:bg-[var(--muted)]"
              >
                {r.emoji}
              </button>
            ))}
          </div>
        </>
      )}

      {/* 群消息已读详情 */}
      {readDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReadDetail(null)}>
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-[var(--foreground)]">已读详情</h3>
              <button onClick={() => setReadDetail(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              已读 {readDetail.readMembers.length}/{readDetail.readMembers.length + readDetail.unreadMembers.length} 人
            </p>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-[var(--muted-foreground)]">已读（{readDetail.readMembers.length}）</p>
                <p className="text-sm text-[var(--foreground)]">{readDetail.readMembers.length ? readDetail.readMembers.join("、") : "—"}</p>
              </div>
              <div>
                <p className="mb-1 text-xs text-[var(--muted-foreground)]">未读（{readDetail.unreadMembers.length}）</p>
                <p className="text-sm text-[var(--muted-foreground)]">{readDetail.unreadMembers.length ? readDetail.unreadMembers.join("、") : "—"}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
