// src/app/layout.tsx

import type { Metadata, Viewport } from "next";
// ... (他のimport)

export const metadata: Metadata = {
  title: "Waon AI",
  description: "Chord analysis application",
};

// ▼ここを修正
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // ここを変更！配列にして「どんな時でも #020617」と指定します
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#020617" },
    { media: "(prefers-color-scheme: dark)", color: "#020617" },
  ],
};

export default function RootLayout({
// ... (以下同じ)