import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Waon AI",
  description: "Chord analysis application",
};

// ここでブラウザのテーマカラーを設定します
export const viewport: Viewport = {
  themeColor: "#020617", // slate-950のカラーコード
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // アプリのように操作させるため拡大縮小を無効化
  viewportFit: "cover", // ノッチエリアまで色を浸透させる
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-950 text-slate-100`}
      >
        {children}
      </body>
    </html>
  );
}