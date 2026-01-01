export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const notes: string[] = body.selectedNotes ?? [];
    const question: string = body.question ?? "";

    if (notes.length < 3) {
      return NextResponse.json({
        status: "insufficient",
        engineChord: "判定不能",
        analysis: "音が3つ未満のため、和音として判断できません。",
        notes,
      });
    }

    const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない）
- 押された順番は意味を持たない
- 無理にコード名を決めない
- 居場所が無い場合は「情報不足」「曖昧」と明言する
- sus4 / add / 9th などは文脈が無い場合、断定しない
- 半音・ピッチクラスという言葉を出さない
- 説明は人間向けの自然文で

【出力は必ずJSON】
{
  status: "ok | ambiguous | insufficient",
  engineChord: string,
  confidence: number (0〜1),
  analysis: string
}
`.trim();

    const user = `
入力音:
${notes.join(", ")}

質問:
${question || "（質問なし。自動解析）"}
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
    const json = JSON.parse(text);

    return NextResponse.json({
      ...json,
      notes,
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: e.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}