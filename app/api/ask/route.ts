export const runtime = "nodejs";

import OpenAI from "openai";

// -----------------------------
// Types
// -----------------------------
type ReqBody = {
  selectedNotes?: unknown;
  analysis?: unknown;     // /api/analyze のレスポンス丸ごとでもOK
  engineChord?: unknown;
  question?: unknown;     // 空なら「自動解説」
};

// -----------------------------
// Helpers
// -----------------------------
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => String(x)).filter(Boolean);
}

function safeJson(v: unknown, maxChars = 6000): string {
  let s = "";
  try {
    s = JSON.stringify(v, null, 2);
  } catch {
    s = String(v);
  }
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n...（省略）";
}

// ざっくり安全策：選択音は最大12、質問は最大400文字、engineChordは最大60
function clampText(s: string, max: number) {
  const t = (s ?? "").trim();
  return t.length <= max ? t : t.slice(0, max);
}

// -----------------------------
// Route
// -----------------------------
export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(
        "サーバー設定エラー: OPENAI_API_KEY が未設定です。",
        { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    const body = (await req.json().catch(() => null)) as ReqBody | null;

    // raw（表記尊重）と normalized（事故防止）の両方を持つ
    const selectedNotesRaw = asStringArray(body?.selectedNotes).slice(0, 12);
    const selectedNotes = selectedNotesRaw.map(normalizeAccidentals);

    const engineChord = clampText(asString(body?.engineChord), 60);
    const analysis = body?.analysis ?? null;
    const question = clampText(asString(body?.question), 400);

    if (selectedNotes.length < 3) {
      return new Response("3音以上選んでください。", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // ========= AIに守らせるルール（古典和声モード） =========
    const SYSTEM = `
あなたは「古典和声（機能和声）」の先生です。
あなたの役割は【説明だけ】です。コード名の判定は行いません。

【絶対ルール】
1) 調性（キー）は断定しない。「可能性」を2〜3個まで出す。
2) 候補の序列をつける：主解釈 / 準解釈 / 別解釈（最大3つ）
3) 異名同音は同一視しない。A# と Bb は別。入力表記を尊重する（Cb も B に置き換えない）。
4) 非和声音（経過音・刺繍音・倚音・掛留など）の可能性を必ず検討する。
5) 文章は日本語で、親しみやすく、でも嘘は言わない。
6) 前後の進行が無い前提なので、断言を避け「仮説」として述べる。
7) ローマ数字（和音記号）は「調性仮説」とセットで提示する（例：『調性がFなら V7』）。

【出力フォーマット（この順で）】
A. ひとことで（1〜2行）
B. 主解釈（和音名 / 機能 / 調性仮説つき和音記号）
C. 準解釈（同上）
D. 別解釈（同上、無ければ省略）
E. 非和声音の見立て（どの音が、どの種類っぽいか。断定しない）
F. 次に分かること（前後の和音 or 旋律が分かると何が確定するか）
`.trim();

    const analysisText = safeJson(analysis, 7000);

    const commonHeader = `
【入力（表記はそのまま尊重）】
選択音(生): ${selectedNotesRaw.join(", ")}
選択音(正規化): ${selectedNotes.join(", ")}
エンジン表示: ${engineChord || "（未指定）"}

【解析データ（ルールベース判定の結果。あなたは“説明”にだけ使う）】
${analysisText}
`.trim();

    const userPrompt = question
      ? `
${commonHeader}

【質問】
${question}

【依頼】
質問に答えつつ、必要なら「主解釈/非和声音/調性仮説」も添えてください。
`.trim()
      : `
${commonHeader}

【依頼】
上のフォーマット A〜F で、古典和声として説明してください。
`.trim();

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: process.env.CADENCIA_MODEL || "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() ?? "";

    return new Response(text || "（AIの応答が空でした）", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });

  } catch (err: any) {
    // OpenAI SDKのエラーはここに落ちる（401/429など含む）
    const msg = err?.message ?? "Unknown error";
    return new Response(`エラー: ${msg}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}