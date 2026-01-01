export const runtime = "nodejs";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ReqBody = {
  selectedNotes?: string[];
  analysis?: any;     // /api/analyze のレスポンス丸ごとでもOK
  engineChord?: string;
  question?: string; // 空なら「自動解説」でもOK
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

    const SYSTEM = `
あなたは「古典和声（機能和声）」の先生です。
あなたの役割は【説明だけ】です。コード名の判定は行いません。

【絶対ルール】
1) 調性（キー）は断定しない。「可能性」を2〜3個まで。
2) 候補の序列：主解釈 / 準解釈 / 別解釈（最大3つ）
3) 異名同音は同一視しない。A# と Bb は別。入力表記を尊重する（Cbも同様）。
4) 非和声音（経過音・刺繍音・倚音・掛留など）の可能性を必ず検討する。
5) 文章は日本語で、親しみやすく、でも嘘は言わない。
6) 前後の進行が無い前提なので断言を避け「仮説」として述べる。
7) ローマ数字は調性仮説とセットで（例：『調性がFなら V7』）。

【出力フォーマット（この順）】
A. ひとことで（1〜2行）
B. 主解釈（和音名 / 機能 / 調性仮説つき和音記号）
C. 準解釈（同上）
D. 別解釈（同上、無ければ省略）
E. 非和声音の見立て（どの音が、どの種類っぽいか）
F. 次に分かること（前後が分かると何が確定するか）
`.trim();

    const userPrompt = question
      ? `
【入力（表記はそのまま尊重）】
選択音: ${selectedNotes.join(", ")}
エンジン表示: ${engineChord || "（未指定）"}

【解析データ（参考）】
${safeJson(analysis)}

【質問】
${question}

【依頼】
質問に答えつつ、必要なら A〜F も簡潔に補ってください。
`.trim()
      : `
【入力（表記はそのまま尊重）】
選択音: ${selectedNotes.join(", ")}
エンジン表示: ${engineChord || "（未指定）"}

【解析データ（参考）】
${safeJson(analysis)}

【依頼】
A〜F で「自動解説」を出してください。
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