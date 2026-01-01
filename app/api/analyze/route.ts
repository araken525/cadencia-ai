export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --------- Gemini ---------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
});

// --------- small helpers ---------
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

// 押下順を消す（表記順に並べるだけ。厳密でなくてOK）
type Acc = "" | "#" | "##" | "b" | "bb";
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const ACC_INDEX: Record<Acc, number> = { bb: 0, b: 1, "": 2, "#": 3, "##": 4 };

function parseSpelling(s: string): { letter: string; acc: Acc } | null {
  const m = (s ?? "").match(/^([A-G])((?:bb|b|##|#)?)$/);
  if (!m) return null;
  return { letter: m[1], acc: (m[2] ?? "") as Acc };
}
function sortSpelling(a: string, b: string) {
  const pa = parseSpelling(a);
  const pb = parseSpelling(b);
  if (!pa || !pb) return a.localeCompare(b);
  const la = LETTER_INDEX[pa.letter] ?? 999;
  const lb = LETTER_INDEX[pb.letter] ?? 999;
  if (la !== lb) return la - lb;
  const aa = ACC_INDEX[pa.acc] ?? 999;
  const ab = ACC_INDEX[pb.acc] ?? 999;
  if (aa !== ab) return aa - ab;
  return a.localeCompare(b);
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const question: string = (body?.question ?? "").toString();

    const notes = uniq(rawNotes.map(normalizeAccidentals).filter(Boolean)).sort(sortSpelling);

    if (notes.length < 3) {
      return NextResponse.json({
        status: "insufficient",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません。",
        candidates: [],
        notes,
      });
    }

    const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない）
- 押された順番は意味を持たない（入力は既に順序除去済み）
- 無理にコード名を決めない
- 居場所が無い場合は status="ambiguous" にして「情報不足」「曖昧」と明言する
- sus4 / add / 9th などは文脈が無い場合、断定せず候補として提示するに留める
- 「半音」「ピッチクラス」などの語を出さない（説明は“音名の文字間隔”ベースの言い回しで）
- 出力は必ずJSON。余計な文章を混ぜない。

【出力JSONスキーマ】
{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,                 // もっとも有力な表示名（決めきれなければ "判定不能"）
  "confidence": number,                  // 0〜1
  "analysis": string,                    // 人間向けの短い説明（難しい言葉は避ける）
  "candidates": [
    { "chord": string, "confidence": number, "reason": string }
  ]
}

【candidatesのルール】
- 最大10件
- confidenceは 0〜1
- reasonは短く（例：「3度が無いのでsus4っぽい」など）
`.trim();

    const user = `
入力音（順序なし）:
${notes.join(", ")}

質問:
${question ? question : "（質問なし：自動解析＋候補提示）"}
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

    // 互換：フロントが candidates 前提でも崩れないように
    if (!Array.isArray(json.candidates)) json.candidates = [];

    return NextResponse.json({
      ...json,
      notes,
      orderPolicy: "spelling-sorted",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}