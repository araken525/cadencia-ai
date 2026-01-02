// app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// -------------------- Gemini --------------------
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

// -------------------- Utils --------------------
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes)
      ? body.selectedNotes
      : [];

    const engineChord: string = body?.engineChord ?? "";
    const question: string = body?.question ?? "";
    const rootHint: string | null = body?.rootHint ?? null;
    const keyHint: string | null = body?.keyHint ?? null;

    if (!model) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY が未設定です。" },
        { status: 500 }
      );
    }

    if (!question.trim()) {
      return NextResponse.json(
        { error: "質問が空です。" },
        { status: 400 }
      );
    }

    const notes = selectedNotesRaw
      .map(normalizeAccidentals)
      .filter(n => /^[A-G]((?:bb|b|##|#)?)$/.test(n));

    // -------------------- Prompt --------------------
    const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【最重要ルール】
- rootHint が与えられている場合、それを「根音として確定扱い」する
- rootHint があるのに別の根音を仮定してはいけない
- 異名同音は統合しない（A# ≠ Bb）
- 押された順番は意味を持たない
- 文脈不足の場合は「情報不足」と明言してよい
- 「半音」「ピッチクラス」などの語は禁止
- 機能和声の語彙を優先する（主和音・属和音・下属和音・導音など）

【役割】
- 判定のやり直しは禁止
- engineChord を前提に「解釈・意味・機能」を説明する
- ユーザーの質問にだけ答える

`.trim();

    const user = `
入力音（表記）:
${notes.join(", ")}

判定された和音:
${engineChord}

${rootHint ? `ユーザー指定の根音（最優先）:\n${rootHint}` : "根音指定: なし"}

${keyHint ? `想定調性:\n${keyHint}` : "調性指定: なし"}

質問:
${question}

出力条件:
- 結論 → 理由 → 注意点 の順で
- 100〜200字程度
- やさしい日本語
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.3,
      },
    });

    return new NextResponse(result.response.text(), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}