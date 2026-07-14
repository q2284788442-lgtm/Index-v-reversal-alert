import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "指数分钟模型左右侧预警",
  description: "上证指数、中证1000与创业板指的模型报警、严格形态确认和右侧路径展示",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
