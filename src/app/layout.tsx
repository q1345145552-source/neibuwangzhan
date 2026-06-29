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
  title: "公司内部管理系统",
  description: "企业内部管理平台",
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
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
