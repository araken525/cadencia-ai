import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Waon AI | 音楽理論特化型AI解析",
  description: "入力された和音の「根拠」「機能」「構造」をAIが解説。ポケットに、あなた専属の音楽理論家を。プロの音楽家の思考プロセスを可視化する、新しい和音解析アプリです。",
  
  // ★ここに正式なURLを設定しました
  metadataBase: new URL("https://waon-ai.com"), 

  openGraph: {
    title: "Waon AI | 音楽理論特化型AI解析",
    description: "プロの音楽家の思考プロセスを可視化する、新しい和音解析アプリ。",
    siteName: "Waon AI",
    locale: "ja_JP",
    type: "website",
    url: "https://waon-ai.com",
  },

  twitter: {
    card: "summary_large_image",
    title: "Waon AI | 音楽理論特化型AI解析",
    description: "ポケットに、あなた専属の音楽理論家を。",
  },

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
      <body className={`${inter.className} bg-slate-50 text-slate-900`}>
        {children}
      </body>
    </html>
  );
}