export const runtime = "nodejs";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ReqBody = {
  selectedNotes?: string[];
  analysis?: any;     // /api/analyze のレスポンス丸ごとでもOK
  engineChord?: string;
  question?: string;
};

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
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

    // fallback (APIキー無しでも壊れない)
    if (!process.env.OPENAI_API_KEY) {
      const msg = [
        "（AI未接続）",
        `入力: ${selectedNotes.join(", ")}`,
        `判定: ${engineChord || "（未指定）"}`,
        "",
        "OPENAI_API_KEY を設定すると質問にAIが答えます。",
      ].join("\n");
      return new Response(msg, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }

    const SYSTEM = `
あなたは古典和声（機能和声）を専門とする音楽理論家です。
音程・度数は必ず「音名の文字間隔（C–D–E–F–G–A–B）」で扱い、
半音数・実音高・ピッチクラスを基準に説明してはいけません。
あなたの役割は【説明だけ】です。コード名の判定は行いません。
質問に答える際も、入力された音名表記を最優先し、
「一般論」「別の可能性」を新しく作ってはいけません。

【最重要ルール（嘘防止）】
- engineChord の表記を変更しない（言い換え・再判定しない）。
- 調性（キー）は断定しない。「可能性」を2〜3個まで。
- 異名同音は同一視しない。A# と Bb、Cb と B を同じと断言しない（ただし誤解ポイントとして触れるのは可）。
- 前後の進行が無い前提なので断言を避け「仮説」として述べる。
- 不明な点は「情報不足」と言い切ってよい（推測で埋めない）。

【出力フォーマット（この順）】
A. ひとことで（1〜2行）
B. 主解釈（engineChord / 機能 / 調性仮説つきローマ数字）
C. 準解釈（同上）
D. 別解釈（同上、無ければ省略）
E. 非和声音の見立て（どの音がどの種類っぽいか）
F. 次に分かること（前後が分かると何が確定するか）
`.trim();

    const userPrompt = `
【入力（表記はそのまま尊重）】
選択音: ${selectedNotes.join(", ")}
engineChord: ${engineChord || "（未指定）"}

【解析データ（参考。判定は変えない）】
${safeJson(analysis)}

【質問】
${question || "（質問なし：自動解説してください）"}

【依頼】
質問に答えつつ、A〜F で説明してください。
特に異名同音（Cb等）について、必要なら誤解ポイントとして触れてください。
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
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