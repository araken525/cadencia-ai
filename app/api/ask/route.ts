// app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// -------------------- Gemini --------------------
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

type CandidateObj = {
  chord: string;
  chordType?: string;
  score?: number;
  confidence?: number;
  chordTones?: string[];
  extraTones?: string[];
  reason?: string;
};

type ReqBody = {
  selectedNotes?: string[];
  engineChord?: string;
  candidates?: CandidateObj[];
  analysis?: string;
  question?: string;
  keyHint?: string;  // "C major" etc / "none"
  rootHint?: string; // "C", "F#" etc / null
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReqBody;

    const selectedNotes = Array.isArray(body.selectedNotes) ? body.selectedNotes : [];
    const engineChord = (body.engineChord ?? "").trim();
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const analysis = typeof body.analysis === "string" ? body.analysis : "";
    const question = (body.question ?? "").trim();
    const keyHint = (body.keyHint ?? "none").trim() || "none";
    const rootHint = (body.rootHint ?? "").trim() || null;

    if (!question) {
      return NextResponse.json({ error: "質問が空です。" }, { status: 400 });
    }

    if (!model) {
      return NextResponse.json({ error: "（AI未接続）GEMINI_API_KEY が未設定です。" }, { status: 500 });
    }

    const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を同一視しない）
- 半音・ピッチクラス等の語を出さない
- 文脈不足なら「情報不足」と明言する
- 調性指定(keyHint)がある場合は、その前提で機能の説明をしてよい（ただし断定しすぎない）

【重要：根音指定(rootHint)がある場合】
- ユーザーが手動で「これが根音だ」と指定しています。
- 解説はその根音を基準とした解釈（コードネーム）を最優先・正解として扱ってください。
- 他の解釈（転回形など）はあくまで「可能性」や「補足」として触れる程度に留めてください。

【やること】
- ユーザーの質問に答える（余計な追加提案はしない）
- 初心者にもわかりやすく、かつ理論的に正しく。
- 必要なら「前後の和音/旋律が分かると確定できる」と短く添える
`.trim();

    const user = `
入力音:
${selectedNotes.join(", ") || "（なし）"}

rootHint（ユーザー指定の根音）:
${rootHint || "（指定なし）"}

keyHint（調性指定）:
${keyHint}

engineChord（現在の判定結果）:
${engineChord || "（未指定）"}

candidates（AIによる分析候補）:
${JSON.stringify(candidates.slice(0, 10), null, 2)}

analysis（AIによる分析コメント）:
${analysis || "（なし）"}

ユーザーからの質問:
${question}
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: { temperature: 0.2 },
    });

    const text = result.response.text().trim();
    return new NextResponse(text || "（AIの応答が空でした）", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}