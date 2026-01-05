import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Waon AI",
  description: "ポケットに、専属の音楽理論家を。",
};

// ★ここが修正ポイント1
// ブラウザのアドレスバーやステータスバーを「漆黒(#020617)」にする設定
export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/* ★ここが修正ポイント2 */}
      {/* bodyタグ自体に bg-slate-950 を追加。これでスクロールの端っこも黒くなる */}
      <body className={`${inter.className} bg-slate-950`}>{children}</body>
    </html>
  );
}