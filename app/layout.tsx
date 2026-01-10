import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// アプリの知的な雰囲気に合わせて、ブラウザバーの色を設定（例: 深い藍色や白）
export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://waon-ai.com"),

  // 検索結果で「何ができるか」が一目でわかるタイトル
  title: {
    default: "Waon AI | 音楽理論特化型の和音・機能和声解析アプリ",
    template: "%s | Waon AI (ワオンAI)",
  },

  // 専門用語を散りばめて、ニッチな検索ニーズ（音大生・作曲家）をキャッチ
  description: "あなたのポケットに専属の音楽理論家を。Waon AIは、単なるコードネームだけでなく、和声学的な「根拠」「機能」「構造」をAIが解説するアプリです。芸大和声、増六の和音、借用和音などの高度な解析に対応。プロの音楽家の思考プロセスを可視化します。",

  // ターゲット層が検索しそうなキーワード（専門用語重視）
  keywords: [
    "音楽理論",
    "和声学",
    "コード解析",
    "機能和声",
    "芸大和声",
    "和音判定",
    "増六の和音",
    "ナポリの六",
    "借用和音",
    "Gemini AI",
    "作曲",
    "吹奏楽",
    "オーケストラ",
    "音大受験"
  ],

  // 製作者情報
  authors: [{ name: "Waon AI Team" }],
  creator: "Waon AI Team",

  // 検索エンジンのロボットへの指示
  robots: {
    index: true,
    follow: true,
  },

  // SNSでシェアされた時のリッチな表示（Musician界隈での拡散を狙う）
  openGraph: {
    title: "Waon AI | 音楽理論特化型AI解析",
    description: "「なぜその和音なのか？」をAIが解説。芸大和声やドイツの六も判別できる、プロ仕様の和音解析ツール。",
    siteName: "Waon AI",
    locale: "ja_JP",
    type: "website",
    url: "https://waon-ai.com",
    images: [
      {
        url: "/opengraph-image.png", // appフォルダ直下に配置
        width: 1200,
        height: 630,
        alt: "Waon AI アプリインターフェース",
      },
    ],
  },

  twitter: {
    card: "summary_large_image",
    title: "Waon AI | ポケットに音楽理論家を。",
    description: "Gemini 2.5 Flash搭載。機能和声や構造まで解説する、新しい音楽理論パートナー。",
    // images: ["/twitter-image.png"], // 必要なら設定
  },

  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  
  // 正規URL
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 🧠 Googleに「これは高度な音楽教育ツール/アプリです」と伝える構造化データ
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Waon AI",
    "url": "https://waon-ai.com",
    "image": "https://waon-ai.com/opengraph-image.png",
    "description": "入力された音の集合から和音を判定し、その音楽的な意味を「和声学の言葉」で解説するAI解析アプリケーション。",
    "applicationCategory": "MusicEducationApplication", // 音楽教育アプリとして定義
    "operatingSystem": "All",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "JPY",
      "availability": "https://schema.org/InStock"
    },
    "featureList": [
      "機能和声解析",
      "芸大和声準拠",
      "増六の和音・ナポリの六対応",
      "異名同音の区別",
      "Gemini 2.5 Flash搭載ハイブリッドエンジン",
      "対話型解説機能"
    ],
    "author": {
      "@type": "Organization",
      "name": "Waon AI Team"
    }
  };

  return (
    <html lang="ja">
      <body className={`${inter.className} bg-slate-50 text-slate-900`}>
        {/* 👇 JSON-LDを埋め込み */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}