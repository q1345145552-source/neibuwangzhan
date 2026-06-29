import { Sidebar } from "@/components/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-[var(--primary)] focus:px-4 focus:py-2 focus:text-sm focus:text-[var(--primary-foreground)]"
      >
        跳过导航，直达内容
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 md:pl-16 lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-8 sm:px-6 md:px-6 lg:px-8 lg:pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}
