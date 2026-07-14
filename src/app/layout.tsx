import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Inter, Cormorant_Garamond, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "湘泰内部管理系统",
  description: "企业内部管理平台",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "湘泰系统",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

const systemCJK =
  '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans SC", sans-serif';
const systemCJKSerif =
  '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", serif';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${cormorant.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <meta name="theme-color" content="#0f172a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="湘泰系统" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <style>{`
          :root {
            --font-sans: ${inter.style.fontFamily}, ${systemCJK};
            --font-display: ${cormorant.style.fontFamily}, ${systemCJKSerif};
            --font-mono: ${jetbrains.style.fontFamily}, monospace;
          }
          .font-display {
            font-family: var(--font-display);
            font-weight: 300;
          }
        `}</style>
        <script dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js'); }); }`
        }} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
