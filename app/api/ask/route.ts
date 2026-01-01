export const runtime = "nodejs";

import OpenAI from "openai";
import { normalizeAccidentals, intervalBetween } from "@/lib/theory/interval";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ReqBody = {
  selectedNotes?: string[];
  analysis?: any;
  engineChord?: string;
  question?: string;
};

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function extractRootFromChordName(chord: string): string | null {
  const s = (chord ?? "").trim();
  const m = s.match(/^([A-G])((?:bb|b|##|#)?)/);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ""}`.trim();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;

    const selectedNotes = (body.selectedNotes ?? []).map(normalizeAccidentals).filter(Boolean);
    const engineChord = (body.engineChord ?? "").trim();
    const analysis = body.analysis ?? null;
    const question = (body.question ?? "").trim();

    if (selectedNotes.length < 3) {
      return new Response("3音以上選んでください。", { status: 400 });
    }
    if (!engineChord || engineChord === "---" || engineChord === "判定不能") {
      return new Response("まず判定してください。", { status: 400 });
    }
    if (!question) {
      return new Response("質問が空です。", { status: 400 });
    }

    const root = extractRootFromChordName(engineChord);
    const intervalMap =
      root
        ? selectedNotes
            .map(n => `${root}→${n}: ${intervalBetween(root, n)?.label ?? "（算出不可）"}`)
            .join("\n")
        : "（engineChordから根音表記を取得できませんでした）";

    const SYSTEM = `
あなたは古典和声（機能和声）を専門とする音楽理論家です。
音程・度数は必ず「音名の文字間隔（C–D–E–F–G–A–B）」で扱い、
半音数・実音高・ピッチクラスを基準に説明してはいけません。
あなたの役割は【説明だけ】です。コード名の判定は行いません。

【最重要ルール（嘘防止）】
- engineChord の表記を変更しない（言い換え・再判定しない）。
- 入力された音名表記を最優先する（CbはCb、FbはFb）。
- 「一般論」「別の可能性」を勝手に新規追加しない（必要なら“情報不足”と言い切る）。
- 調性（キー）は断定しない。可能性を2〜3個まで。
- 異名同音は同一視しない（ただし誤解ポイントとして触れるのは可）。
- 前後の進行が無い前提なので断言を避け、仮説として述べる。
`.trim();

    const USER = `
【入力（表記そのまま）】
選択音: ${selectedNotes.join(", ")}

【engineChord（絶対に変更しない）】
${engineChord}

【参考：engineChord根音→各音の音程ラベル（文字間隔）】
${intervalMap}

【参考：analyzeの解析データ（再判定は禁止）】
${safeJson(analysis)}

【質問】
${question}

【出力フォーマット】
A. ひとことで（1〜2行）
B. 質問への回答（根拠は入力表記と音程ラベルに限定）
C. 不明点（情報不足なら明確に）
D. 次に分かると強い情報（前後/旋律）
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.15,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return new Response(text || "（AIの応答が空でした）", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err: any) {
    return new Response(err?.message ?? "Unknown error", { status: 500 });
  }
}