// app/layout.tsx または app/page.tsx (親)

import type { Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#020617", // slate-950 の色
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // アプリっぽく操作させるため
  // iOSでノッチ部分まで色を浸透させる設定
  viewportFit: "cover", 
};

export default function RootLayout({ children }) {
  // ...省略
}