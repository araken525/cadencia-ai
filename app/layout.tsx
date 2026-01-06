import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Google Fonts (Inter) の設定
const inter = Inter({ subsets: ["latin"] });

// ▼ ここがSNSや検索エンジン向けの設定です
export const metadata: Metadata = {
  // 1. 基本設定
  title: "Waon AI | 音楽理論特化型AI解析",
  description: "入力された和音の「根拠」「機能」「構造」をAIが解説。ポケットに、あなた専属の音楽理論家を。プロの音楽家の思考プロセスを可視化する、新しい和音解析アプリです。",
  
  // 2. サイトのベースURL (デプロイ後に書き換えてください)
  metadataBase: new URL("https://waon-ai.vercel.app"), 

  // 3. SNSシェア設定 (Open Graph)
  openGraph: {
    title: "Waon AI | 音楽理論特化型AI解析",
    description: "プロの音楽家の思考プロセスを可視化する、新しい和音解析アプリ。",
    siteName: "Waon AI",
    locale: "ja_JP",
    type: "website",
    // 画像は app/opengraph-image.png が自動で読み込まれます
  },

  // 4. X (Twitter) 用設定
  twitter: {
    card: "summary_large_image", // 大きな画像で表示
    title: "Waon AI | 音楽理論特化型AI解析",
    description: "ポケットに、あなた専属の音楽理論家を。",
    // 画像は app/opengraph-image.png が自動で読み込まれます
  },

  // 5. アイコン設定 (ファイルがあれば自動ですが、念のため記述も可)
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/* 以前作成した背景色や文字色があればここに反映されます */}
      <body className={`${inter.className} bg-slate-50 text-slate-900`}>
        {children}
      </body>
    </html>
  );
}