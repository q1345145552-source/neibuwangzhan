"use client";

import { useState, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { useBossPending } from "@/lib/use-boss-pending";
import { ChevronRight, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BOTTOM_NAV, TOP_NAV, groupKeyOf, groupsForRole, isActiveRoute, navForRole, type NavGroup, type NavItem } from "@/components/sidebar-nav";

// 哪些分组展开着：记在这台电脑的浏览器里（存不了就只在这次打开时有效）
const OPEN_GROUPS_KEY = "sidebar-open-groups-v1";
let openGroupsMemory: string | null = null;
const openGroupListeners = new Set<() => void>();
function readOpenGroups(): string {
  if (openGroupsMemory !== null) return openGroupsMemory;
  try { return localStorage.getItem(OPEN_GROUPS_KEY) ?? ""; } catch { return ""; }
}
function subscribeOpenGroups(listener: () => void) {
  openGroupListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => { openGroupListeners.delete(listener); window.removeEventListener("storage", listener); };
}
function parseOpenGroups(raw: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    return value && typeof value === "object" ? value as Record<string, boolean> : {};
  } catch { return {}; }
}
function saveOpenGroup(key: string, open: boolean) {
  const next = JSON.stringify({ ...parseOpenGroups(readOpenGroups()), [key]: open });
  try { localStorage.setItem(OPEN_GROUPS_KEY, next); openGroupsMemory = null; }
  catch { openGroupsMemory = next; /* 存不了（写满、被禁用）：这次打开时还能用，只影响下次打开 */ }
  openGroupListeners.forEach((listener) => listener());
}

function NavSection({ items, pathname, onClose, badgeMap }: { items: NavItem[]; pathname: string; onClose: () => void; badgeMap?: Record<string, number> }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        const badge = badgeMap?.[item.name];
        return (
          <li key={item.name}>
            <Link
              href={item.href}
              onClick={onClose}
              title={item.name}
              className={cn(
                // 窄侧栏（md）放不下文字：只显示图标，鼠标放上去显示名字，红点贴在图标右上角
                "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 md:justify-center md:px-0 lg:justify-start lg:px-3",
                active
                  ? "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)]"
                  : "text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span className="flex-1 md:hidden lg:inline">{item.name}</span>
              {badge != null && badge > 0 && (
                <span aria-label={item.href === "/boss-supervision" ? `${badge} 条待处理` : undefined} className={cn("flex h-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white md:absolute md:-right-1 md:-top-1 lg:static", item.href === "/boss-supervision" ? "min-w-5 px-1" : "w-5")}>{item.href === "/boss-supervision" ? badge : badge > 99 ? "99+" : badge}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NavGroupSection({ group, open, onToggle, pathname, onClose, badgeMap }: { group: NavGroup; open: boolean; onToggle: () => void; pathname: string; onClose: () => void; badgeMap: Record<string, number> }) {
  const badgeTotal = group.items.reduce((sum, item) => sum + (badgeMap[item.name] ?? 0), 0);
  const listId = `sidebar-group-${group.key}`;
  return (
    <div className="mt-3">
      {/* 平板那种窄侧栏（md）放不下标题：不显示标题，组里的项全部显示，组之间用横线隔开 */}
      <div className="mx-3 mb-3 hidden border-t border-[var(--sidebar-border)] md:block lg:hidden" />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--sidebar-foreground)]/55 transition-colors hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)] md:hidden lg:flex"
      >
        <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150", open && "rotate-90")} aria-hidden="true" />
        <span className="flex-1 text-left">{group.label}</span>
        {!open && badgeTotal > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{badgeTotal > 99 ? "99+" : badgeTotal}</span>
        )}
      </button>
      <div id={listId} className={cn("mt-1", !open && "hidden md:block lg:hidden")}>
        <NavSection items={group.items} pathname={pathname} onClose={onClose} badgeMap={badgeMap} />
      </div>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { user, logout } = useAuth();
  const { data: bossPending } = useBossPending();
  const router = useRouter();
  const [todoCount, setTodoCount] = useState(0);
  const [msgUnreadCount, setMsgUnreadCount] = useState(0);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [finPendingVerifyCount, setFinPendingVerifyCount] = useState(0);
  const [unclassifiedCount, setUnclassifiedCount] = useState(0);
  const [agencyEnabled, setAgencyEnabled] = useState(true);
  const openGroupsRaw = useSyncExternalStore(subscribeOpenGroups, readOpenGroups, () => "");
  // 当前页面所在的分组：打开页面时自动展开，手动收起后不再强行展开
  const [focusGroup, setFocusGroup] = useState(() => groupKeyOf(pathname));
  const [pageGroup, setPageGroup] = useState(() => groupKeyOf(pathname));

  // 我的待办角标：未看过的新增/新跟进待办数量（客户账号没有待办，不轮询）
  useEffect(() => {
    if (!user?.name || user.role === "client") return;
    const fetchUnseen = () => {
      const token = getStoredAuthToken();
      if (!token) return;
      fetch("/api/todos/unseen", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(d => { if (typeof d.count === "number") setTodoCount(d.count); })
        .catch(() => {});
    };
    fetchUnseen();
    const interval = setInterval(fetchUnseen, 3000); // poll every 3s
    return () => clearInterval(interval);
  }, [user?.name, user?.role]);

  // 消息未读数：侧栏「消息」入口的红色角标，每 3 秒轮询，新消息/已读都无需刷新即可更新（客户账号不能用聊天，不轮询）
  useEffect(() => {
    if (!user?.name || user.role === "client") return;
    const fetchUnread = () => {
      const token = getStoredAuthToken();
      if (!token) return;
      fetch("/api/chat/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => { if (typeof d.count === "number") setMsgUnreadCount(d.count); })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 3000); // poll every 3s
    return () => clearInterval(interval);
  }, [user?.name, user?.role]);

  // 消息中心未读数：侧栏「消息中心」入口的红色角标，每 3 秒轮询（客户账号没有，不轮询）
  useEffect(() => {
    if (!user?.name || user.role === "client") return;
    const fetchUnread = () => {
      const token = getStoredAuthToken();
      if (!token) return;
      fetch("/api/notifications/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => { if (typeof d.count === "number") setNotifUnreadCount(d.count); })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 3000); // poll every 3s
    return () => clearInterval(interval);
  }, [user?.name, user?.role]);

  // 待分类（待领取）角标：还没人认领的待分类单，每 15 秒轮询（客户账号不轮询）
  useEffect(() => {
    if (!user?.name || user.role === "client") return;
    const fetchCount = () => {
      const token = getStoredAuthToken();
      if (!token) return;
      fetch("/api/orders/unclassified-count", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => { if (typeof d.count === "number") setUnclassifiedCount(d.count); })
        .catch(() => {});
    };
    fetchCount();
    const interval = setInterval(fetchCount, 15000);
    return () => clearInterval(interval);
  }, [user?.name, user?.role]);

  // 费用管理待核对角标：侧栏「费用管理」入口的红色角标，每 3 秒轮询（仅管理员有数，客户不轮询）
  useEffect(() => {
    if (!user?.name || user.role === "client") return;
    const fetchPending = () => {
      const token = getStoredAuthToken();
      if (!token) return;
      fetch("/api/finances/pending-verify-count", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => { if (typeof d.count === "number") setFinPendingVerifyCount(d.count); })
        .catch(() => {});
    };
    fetchPending();
    const interval = setInterval(fetchPending, 3000); // poll every 3s
    return () => clearInterval(interval);
  }, [user?.name, user?.role]);

  // 机构业务总开关：关闭时隐藏机构入口
  useEffect(() => {
    const token = getStoredAuthToken();
    if (!token) return;
    fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (typeof d.agency_enabled === "boolean") setAgencyEnabled(d.agency_enabled); })
      .catch(() => {});
  }, []);

  // 路由变化时关闭移动端菜单：渲染期间派生状态，避免在 effect 中直接 setState
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
    const nextGroup = groupKeyOf(pathname);
    if (nextGroup !== pageGroup) {
      setPageGroup(nextGroup);
      setFocusGroup(nextGroup);
    }
  }

  const groups = useMemo(() => groupsForRole(user?.role, agencyEnabled), [user?.role, agencyEnabled]);
  const savedOpen = parseOpenGroups(openGroupsRaw);
  const isGroupOpen = (group: NavGroup) => group.key === focusGroup || (savedOpen[group.key] ?? !!group.defaultOpen);
  const toggleGroup = (group: NavGroup) => {
    saveOpenGroup(group.key, !isGroupOpen(group));
    if (group.key === focusGroup) setFocusGroup(null);
  };
  const badgeMap: Record<string, number> = {
    "监督看板": bossPending?.total ?? 0,
    "我的待办": todoCount,
    "消息": msgUnreadCount,
    "消息中心": notifUnreadCount,
    "待分类（待领取）": unclassifiedCount,
    "费用管理": finPendingVerifyCount,
  };

  const sidebarContent = (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-[var(--sidebar-border)] px-5 md:justify-center md:px-0 lg:justify-start lg:px-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-primary)]">
          <span className="font-display text-sm font-medium tracking-tight text-[var(--sidebar-primary-foreground)]">X</span>
        </div>
        <div className="flex flex-col leading-tight md:hidden lg:flex">
          <span className="text-sm font-medium tracking-tight">湘泰</span>
          <span className="text-xs uppercase tracking-widest text-[var(--sidebar-foreground)]/50">Internal Portal</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavSection items={navForRole(TOP_NAV, user?.role)} pathname={pathname} onClose={close} badgeMap={badgeMap} />

        {groups.map((group) => (
          <NavGroupSection key={group.key} group={group} open={isGroupOpen(group)} onToggle={() => toggleGroup(group)} pathname={pathname} onClose={close} badgeMap={badgeMap} />
        ))}

        <div className="mt-3">
          <NavSection items={navForRole(BOTTOM_NAV, user?.role)} pathname={pathname} onClose={close} />
        </div>
      </nav>

      <div className="border-t border-[var(--sidebar-border)] px-5 py-3 md:px-0 lg:px-5">
        <div className="flex items-center gap-3 md:flex-col lg:flex-row">
{(() => {
            const initial = user?.name?.charAt(0) || "?";
            const roleLabel = user?.role === "admin" ? "管理员" : user?.role === "client" ? "客户" : "员工";
            return (<>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">{initial}</div>
          <div className="flex min-w-0 flex-col leading-tight md:hidden lg:flex">
            <span className="truncate text-sm font-medium">{user?.name || "—"}</span>
            <span className="truncate text-xs text-[var(--sidebar-foreground)]/50">{roleLabel}</span>
          </div>
          <ThemeToggle />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="退出登录"
            onClick={() => { logout(); router.push("/login"); }}
            className="text-[var(--sidebar-foreground)]/50 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
          >
            <LogOut className="size-3" aria-hidden="true" />
          </Button>
            </>);
            })()}
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* 手机端打开侧栏的三条杠按钮：消息页不显示，其余页面显示 */}
      {pathname !== "/messages" && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="sidebar-nav"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          className="fixed left-4 top-3 z-40 flex size-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--muted)] md:hidden focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        >
          {open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
        </button>
      )}

      {open && (
        <div
          role="button"
          tabIndex={0}
          aria-label="关闭菜单"
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={close}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") close(); }}
        />
      )}

      <aside
        id="sidebar-nav"
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] transition-transform duration-200 ease-out-quart",
          "w-60",
          open ? "translate-x-0" : "-translate-x-full",
          "md:w-16 md:translate-x-0 lg:w-60"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
