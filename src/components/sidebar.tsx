"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Tag,
  ShieldCheck,
  FileCheck,
  Car,
  Ship,
  MapPin,
  Store,
  Radio,
  CheckSquare,
  FileText,
  DollarSign,
  Settings,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const navigation = [
  { name: "仪表盘", href: "/", icon: LayoutDashboard },
];

const businessLines = [
  { name: "公司注册", href: "/company-registration", icon: Building2 },
  { name: "商标", href: "/trademark", icon: Tag },
  { name: "FDA认证", href: "/fda-certification", icon: ShieldCheck },
  { name: "TISI", href: "/tisi", icon: FileCheck },
  { name: "DLD", href: "/dld", icon: Car },
  { name: "清关", href: "/customs-clearance", icon: Ship },
  { name: "地址认证", href: "/address-certification", icon: MapPin },
  { name: "Mall开店", href: "/mall-store", icon: Store },
  { name: "NBTC", href: "/nbtc", icon: Radio },
];

const utilityNav = [
  { name: "任务看板", href: "/tasks", icon: CheckSquare },
  { name: "文档管理", href: "/documents", icon: FileText },
  { name: "费用管理", href: "/finance", icon: DollarSign },
  { name: "设置", href: "/settings", icon: Settings },
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavSection({ items, pathname, onClose }: { items: typeof navigation; pathname: string; onClose: () => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        return (
          <li key={item.name}>
            <Link
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)]"
                  : "text-[var(--sidebar-foreground)]/70 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-foreground)]"
              )}
            >
              <item.icon className="size-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const { user, logout } = useAuth();
  const router = useRouter();

  // 路由变化时关闭移动端菜单：渲染期间派生状态，避免在 effect 中直接 setState
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  const sidebarContent = (
    <>
      <div className="flex h-14 items-center gap-3 border-b border-[var(--sidebar-border)] px-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--sidebar-primary)]">
          <span className="font-display text-sm font-medium tracking-tight text-[var(--sidebar-primary-foreground)]">X</span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-medium tracking-tight">湘泰</span>
          <span className="text-xs uppercase tracking-widest text-[var(--sidebar-foreground)]/50">Internal Portal</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <NavSection items={navigation} pathname={pathname} onClose={close} />

        <div className="mt-4 mb-2 px-3">
          <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--sidebar-foreground)]/40">业务线</span>
        </div>
        <NavSection items={businessLines} pathname={pathname} onClose={close} />

        <div className="mt-4 mb-2 px-3">
          <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--sidebar-foreground)]/40">工具</span>
        </div>
        <NavSection items={utilityNav} pathname={pathname} onClose={close} />
      </nav>

      <div className="border-t border-[var(--sidebar-border)] px-5 py-3">
        <div className="flex items-center gap-3">
{(() => {
            const initial = user?.name?.charAt(0) || "?";
            const roleLabel = user?.role === "admin" ? "管理员" : user?.role === "client" ? "客户" : "员工";
            return (<>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--sidebar-accent)] text-xs font-medium text-[var(--sidebar-accent-foreground)]">{initial}</div>
          <div className="flex min-w-0 flex-col leading-tight">
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
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="sidebar-nav"
        aria-label={open ? "关闭菜单" : "打开菜单"}
        className="fixed left-4 top-3 z-40 flex size-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] shadow-sm transition-colors hover:bg-[var(--muted)] md:hidden focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        {open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
      </button>

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
