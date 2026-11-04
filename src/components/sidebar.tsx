"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { useBossPending } from "@/lib/use-boss-pending";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BOTTOM_NAV, TOP_NAV, groupsForRole, isActiveRoute, navForRole, type NavGroup, type NavItem } from "@/components/sidebar-nav";

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

function NavGroupSection({ group, pathname, onClose, badgeMap }: { group: NavGroup; pathname: string; onClose: () => void; badgeMap: Record<string, number> }) {
  return (
    <div className="mt-3">
      {/* 灰色小标题：固定文字标签，不可点、无箭头、不折叠（窄侧栏 md 放不下，隐藏标题只显示菜单项） */}
      <div className="px-3 py-1.5 text-xs font-medium text-[var(--sidebar-foreground)]/55 md:hidden lg:block">
        {group.label}
      </div>
      <div className="mt-1">
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
  }

  const groups = useMemo(() => groupsForRole(user?.role, agencyEnabled), [user?.role, agencyEnabled]);
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
          <NavGroupSection key={group.key} group={group} pathname={pathname} onClose={close} badgeMap={badgeMap} />
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
