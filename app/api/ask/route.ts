// app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##")
    .replaceAll("−", "-");
}

function parseJsonSafely(text: string) {
  const t = (text ?? "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("AIのJSONパースに失敗しました");
}

type AskBody = {
  question?: string;
  // analyze結果をそのまま渡せるようにする（無くても動く）
  notes?: string[];
  engineChord?: string;
  candidates?: any[];
  analysis?: string;
};

type AskResponse = {
  ok: true;
  answer: string;
};

function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール（嘘防止）】
- 入力された音名表記をそのまま使う（異名同音を統合しない）
- 文脈が無い場合は断定しない（情報不足と言う）
- 「半音」「ピッチクラス」「実音高」などの語は出さない
- 機能和声の観点で説明する（主/属/下属、導音、倚音・経過音・掛留など）
- engineChord が "判定不能" でも、質問には答える（ただし情報不足を明記）

【出力は必ずJSONのみ】
{ "answer": string }
`.trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as AskBody;

    const question = (body.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "質問が空です。" }, { status: 400 });
    }

    const notes = Array.isArray(body.notes) ? body.notes.map(normalizeAccidentals) : [];
    const engineChord = (body.engineChord ?? "").trim() || "判定不能";
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 10) : [];
    const analysis = (body.analysis ?? "").trim();

    if (!model) {
      return NextResponse.json({ error: "GEMINI_API_KEY が未設定です。" }, { status: 500 });
    }

    const system = buildSystemPrompt();

    const user = `
入力音（表記そのまま）:
${notes.length ? notes.join(", ") : "（未提供）"}

engineChord（参考。判定不能の可能性あり）:
${engineChord}

候補（参考。無い場合あり）:
${candidates.length ? JSON.stringify(candidates, null, 2) : "（なし）"}

既存のanalysis（参考。無い場合あり）:
${analysis || "（なし）"}

質問:
${question}

条件:
- まず結論を短く
- 次に根拠（入力表記に基づく）
- 最後に「次に分かると強い情報」
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const text = result.response.text();
    const json = parseJsonSafely(text) as { answer?: string };

    const res: AskResponse = {
      ok: true,
      answer: typeof json.answer === "string" ? json.answer : "（回答が空でした）",
    };

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}