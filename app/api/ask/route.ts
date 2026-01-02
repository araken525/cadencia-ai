// app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { normalizeAccidentals, intervalBetween } from "@/lib/theory/interval";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = process.env.GEMINI_API_KEY
  ? genAI.getGenerativeModel({ model: geminiModelName })
  : null;

type ReqBody = {
  selectedNotes?: string[];
  engineChord?: string;     // "判定不能" でもOK
  analysis?: any;           // /api/analyze のレスポンス丸ごと想定
  candidates?: any;         // /api/analyze の候補
  question?: string;
};

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// engineChord から根音表記だけ抜く（見つからない時は null）
function extractRootFromChordName(chord: string): string | null {
  const s = (chord ?? "").trim();
  const m = s.match(/^([A-G])((?:bb|b|##|#)?)/);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ""}`.trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ReqBody | null;
    if (!body) return new Response("Bad request", { status: 400 });

    const selectedNotes = (body.selectedNotes ?? []).map(normalizeAccidentals).filter(Boolean);
    const question = (body.question ?? "").trim();

    // ★ここ重要：判定不能でも質問できる
    if (!question) {
      return new Response("質問が空です。", { status: 400 });
    }
    if (selectedNotes.length === 0) {
      return new Response("音が空です。", { status: 400 });
    }

    const engineChord = (body.engineChord ?? "判定不能").trim() || "判定不能";
    const analysis = body.analysis ?? null;
    const candidates = body.candidates ?? null;

    if (!model) {
      return new Response("GEMINI_API_KEY が未設定です。", { status: 500 });
    }

    // 根音推定（判定不能なら作らない）
    const root = engineChord !== "判定不能" ? extractRootFromChordName(engineChord) : null;
    const intervalMap =
      root
        ? selectedNotes
            .map(n => `${root}→${n}: ${intervalBetween(root, n)?.label ?? "（算出不可）"}`)
            .join("\n")
        : "（engineChordが判定不能のため、根音→各音の音程は提示できません）";

    const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない）
- 半音・ピッチクラス・実音高という言葉を出さない
- 「機能和声」の言い回しを優先（主/属/下属、導音、非和声音）
- engineChord を勝手に言い換え・再判定しない（判定不能なら“判定不能”のまま）
- 文脈不足なら推測で埋めず「情報不足」と言い切る
- sus4/add9/9th 等は、前後文脈が無ければ断定しない

【出力（自然文）フォーマット】
A. ひとことで（1〜2行）
B. 質問への回答（根拠は「入力音名」「engineChord」「候補」「解析」に限定）
C. 情報不足（あれば明確に）
D. 次に分かると強い情報（前後の進行/旋律）
`.trim();

    const user = `
入力音（表記そのまま）:
${selectedNotes.join(", ")}

engineChord（変更禁止）:
${engineChord}

根音→各音の音程ラベル（文字間隔）:
${intervalMap}

候補/解析（参考。再判定は禁止）:
analysis:
${safeJson(analysis)}

candidates:
${safeJson(candidates)}

質問:
${question}
`.trim();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
      },
    });

    const text = result.response.text()?.trim() ?? "";
    return new Response(text || "（AIの応答が空でした）", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}