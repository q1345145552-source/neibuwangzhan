"use client";
import Link from 'next/link';
import { createContext, useContext, useState } from 'react';
const ViewerContext = createContext<(role: string) => void>(() => {});
export const useVisualizationViewer = () => useContext(ViewerContext);
import { usePathname } from 'next/navigation';
import { BarChart3, ArrowLeft, Package, DollarSign, LayoutDashboard, Search, FolderOpen } from 'lucide-react';
/** Intentionally no AuthProvider/ChatNotifier/legacy badge pollers on this read-only route. */
export function VisualizationShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [viewer, setViewer] = useState('unknown');
  return <ViewerContext.Provider value={setViewer}><div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
    <aside className="border-b border-[var(--border)] bg-[var(--sidebar)] px-5 py-5 text-[var(--sidebar-foreground)] lg:fixed lg:inset-y-0 lg:w-60 lg:border-r lg:border-b-0 lg:py-8">
      <Link prefetch={false} href="/" className="flex items-center gap-3 text-lg font-semibold"><span className="rounded-xl bg-[var(--sidebar-primary)] p-2 text-[var(--sidebar-primary-foreground)]"><BarChart3 size={20} /></span>湘泰内部系统</Link>
      <p className="mt-2 hidden pl-12 text-xs opacity-60 lg:block">业务数据 · 只读总览</p>
      <nav aria-label="系统导航" className="mt-6 flex flex-wrap gap-2 lg:mt-10 lg:flex-col">
        {[[LayoutDashboard, '仪表盘', '/'], [Search, '全局搜索', '/search'], [FolderOpen, '我的文件夹', '/my-folder'], [BarChart3, '数据总览', '/visualization'], [Package, '订单交付', '/visualization/delivery'], [BarChart3, '异常清单', '/visualization/exceptions'], [Package, '订单管理', '/orders'], [DollarSign, '费用管理', '/finance']].filter(([, , href]) => href === '/visualization/delivery' ? ['admin','employee'].includes(viewer) : (href === '/visualization' || href === '/visualization/exceptions') ? viewer === 'admin' : true).map(([Icon, name, href]) => { const Glyph = Icon as typeof BarChart3; return <Link key={String(href)} prefetch={false} href={String(href)} aria-current={href === pathname ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${href === pathname ? 'bg-[var(--sidebar-primary)] text-[var(--sidebar-primary-foreground)]' : 'opacity-75 hover:bg-[var(--sidebar-accent)]'}`}><Glyph size={17} />{String(name)}</Link>; })}
      </nav>
      <div className="mt-6 hidden border-t border-current/15 pt-5 text-xs leading-6 opacity-60 lg:absolute lg:inset-x-5 lg:bottom-6 lg:block">原业务功能保持独立<br />总览不执行业务操作</div>
    </aside>
    <main id="main-content" className="min-w-0 px-4 py-6 sm:px-6 lg:ml-60 lg:px-9 lg:py-9"><div className="mx-auto max-w-7xl">{children}<Link prefetch={false} href="/" className="mt-8 inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]"><ArrowLeft size={15} />返回原仪表盘</Link></div></main>
  </div></ViewerContext.Provider>;
}
