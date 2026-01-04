export const runtime = "nodejs";
export const maxDuration = 60;

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

function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

function asNoteOrNull(x: any): string | null {
  if (typeof x !== "string") return null;
  const n = normalizeAccidentals(x);
  if (!/^[A-G]((?:bb|b|##|#)?)$/.test(n)) return null;
  return n;
}

// ============================================================
// 共通の特殊和音ロジック
// ============================================================
const SPECIAL_CHORD_RULES = `
【特殊和音判定 (優先度:最高)】
以下の条件合致時は必ずこれに従え。

1. [IVの付加6] (構成音:IV+6th)
   - 判定: II₇¹ または IV6
   - 解説: 「機能的にはVへ進むII₇¹、あるいはIVの装飾」と言及。
2. [ドリアのIV] (短調で旋律的短音階#6を含むIV)
   - 判定: IV または IV₇
   - 解説: 「ドリアのIV。独特の明るさを持つ準属的な響き」と言及。
3. [増六の和音] (増6度を含む)
   - 判定: 増六の和音
   - 解説: 国名(伊・仏・独)を区別し、「主にVへ解決するD機能」と言及。
4. [ナポリの六] (短調IIの根音を半音下げた1転)
   - 判定: ナポリのII または II¹(根音変位)
   - 解説: 「ナポリの六(N⁶)。S機能として劇的な効果」と言及。
5. [ピカルディのI] (短調終止が長主和音)
   - 判定: I (長三和音)
   - 解説: 「ピカルディ終止」と言及。
6. [Iの第2転回形] (Bassが属音)
   - 判定: I² (機能:D)
   - 解説: 「終止四六・経過四六・補助四六」のいずれか文脈に合わせて言及。
7. [準固有和音] (長調で同主短調の和音を使用)
   - 判定: °VI 等 (左上に○を付す)
   - 解説: 「準固有和音(モル・ドゥア)。長調の中に切ない響き」と言及。
8. [ドッペル・ドミナント] (Vの完全5度上に位置するII)
   - 判定: II または II₇
   - 解説: 「VのV(ドッペル・ドミナント)。強い推進力」と言及。
9. [根音省略の属九] (減七の和音)
   - 判定: VII₇ (記号は減七)
   - 解説: 「機能的には根音を省略した属九の和音(V₉)としてD機能を持つ」と言及。
10. [Iの付加6] (I+6th)
    - 判定: VI₇¹
    - 解説: 「芸大和声ではVIの七の第1転回形として扱うことが多い」と言及。
11. [導七の和音] (短調VII または 長調で減5短7を持つ和音)
    - 判定: VII₇ (導七)
    - 解説: 「減七とは区別される導七の和音。より穏やかなD機能」と言及。
`;

// ============================================================
// 共通の表記ルール
// ============================================================
const NOTATION_RULES = `
【用語・音名表記（絶対厳守）】
以下の3パターン以外の組み合わせ（「F長調」「ド長調」等）は禁止。
1. 独: C-dur, a-moll (ドイツ音名)
2. 英: C Major, A Minor (英語音名)
3. 日: ハ長調, イ短調 (日本音名)

【和音種別名(厳守)】
和音の種類を表す際は以下のみを使用せよ。カタカナ語(メジャーコード等)は禁止。
- 長三和音, 短三和音, 減三和音, 増三和音
- 属七の和音, 減七の和音, 長七の和音, 短七の和音
- 減五短七の和音(導七の和音), 増七の和音
- 属九の和音, 属短九の和音, 増六の和音

【記号ルール】
- 転回形: 右上 (I¹)
- 種類: 右下 (V₇)
- 機能: T, D, S
- 長三和音に "Major" は付けない
`;

// ============================================================
// Prompt: Expert (専門家)
// ============================================================
function buildExpertSystemPrompt() {
  return `
あなたは日本の音楽大学(芸大和声)に精通した専門家である。

【回答スタイル】
- Markdown禁止。プレーンテキストのみ。
- 挨拶不要。結論から記述せよ。
- 口調: 断定的(「〜である」)。

【重要ルール】
1. **入力尊重**: スペルを厳守せよ。異名同音(F#/Gb)は区別せよ。
2. **順序**: 入力リスト順≠バス音である。BassHintが無い限り転回形を決めつけるな。

【用語・言語】
- 解説文では "Key" を使わず「調」とせよ。
- 上記「用語・音名表記」を厳守せよ。
- 属和音(D)や第7音は「解決(進行方向)」に必ず言及せよ。

${SPECIAL_CHORD_RULES}
${NOTATION_RULES}
`.trim();
}

// ============================================================
// Prompt: Beginner (初心者)
// ============================================================
function buildBeginnerSystemPrompt() {
  return `
あなたは中高生に教える親切な音楽の先生である。
判定は「芸大和声」に基づき正確に、解説は優しく噛み砕くこと。

【回答スタイル】
- Markdown禁止。プレーンテキストのみ。
- 挨拶不要。すぐに回答を始めよ。
- 口調: 丁寧語(「〜ですね」)。

【重要ルール】
1. **入力尊重**: スペルを厳守せよ。異名同音(F#/Gb)は区別せよ。
2. **順序**: 入力リスト順≠バス音である。

【用語・言語】
- 調名は必ず「日本音名(ハ長調)」または「ドイツ音名(C-dur)」を使用せよ。「ファ長調」等は禁止。
- 専門用語は使用しつつ、補足を添えること。
- 解決は「不安定なので、次に〇〇へ行きたがっている」等と表現せよ。

${SPECIAL_CHORD_RULES}
${NOTATION_RULES}
`.trim();
}

function buildUserPrompt(params: {
  notes: string[];
  question: string;
  bassHint: string | null;
  rootHint: string | null;
  keyHint: string | null;
  engineChord: string | null;
  candidates: string[] | null;
}) {
  const keyLine = params.keyHint ? params.keyHint : "（指定なし）";
  const bassLine = params.bassHint ? params.bassHint : "（指定なし）";
  const rootLine = params.rootHint ? params.rootHint : "（指定なし）";
  
  const engineLine = params.engineChord ? params.engineChord : "（未提供）";
  const candLine = params.candidates && params.candidates.length > 0 
    ? params.candidates.join(", ") 
    : "（なし）";

  return `
【生徒の状況】
- 音: ${params.notes.join(", ")}
- 指定: Bass=${bassLine}, Root=${rootLine}, 調=${keyLine}
- AI判定: ${engineLine} (他: ${candLine})

【生徒の質問】
${params.question}

【回答への指示】
- プレーンテキストで答えてください。
- 和音名は「C」や「Cm」のように記述してください。
- 挨拶は省略し、すぐに回答を始めてください。
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // ★ モード判定
    const mode = (body?.mode === "beginner") ? "beginner" : "expert";

    const selectedNotesRaw: any[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const question = typeof body?.question === "string" ? body.question.trim() : "";

    const keyHint = typeof body?.keyHint === "string" && body.keyHint.trim() ? body.keyHint.trim() : null;
    const engineChord = typeof body?.engineChord === "string" && body.engineChord.trim() ? body.engineChord.trim() : null;
    const candidatesIn = Array.isArray(body?.candidates) ? body.candidates : null;
    const candidates = candidatesIn?.map((x: any) => (typeof x === "string" ? x : x?.chord))
        .filter((x: any) => typeof x === "string" && x.trim())
        .slice(0, 10) ?? null;

    const normalized = selectedNotesRaw
      .map((x) => (typeof x === "string" ? normalizeAccidentals(x) : ""))
      .filter(Boolean)
      .filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));

    // ★ アルファベット順にソートしてバイアス排除
    const notesSorted = uniq(normalized).sort(sortSpelling);
    
    const bassHintRaw = asNoteOrNull(body?.bassHint);
    const bassHint = bassHintRaw && notesSorted.includes(bassHintRaw) ? bassHintRaw : null;
    const rootHintRaw = asNoteOrNull(body?.rootHint);
    const rootHint = rootHintRaw && notesSorted.includes(rootHintRaw) ? rootHintRaw : null;

    if (!question) {
      return new NextResponse("質問が空です。", { status: 400 });
    }
    if (!model) {
      return new NextResponse("（AI未接続）GEMINI_API_KEY が未設定です。", { status: 500 });
    }

    // ★ モードに応じてプロンプトを切り替え
    const system = mode === "beginner" ? buildBeginnerSystemPrompt() : buildExpertSystemPrompt();
    
    const user = buildUserPrompt({
      notes: notesSorted,
      question,
      bassHint,
      rootHint,
      keyHint,
      engineChord,
      candidates,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: { temperature: 0.3 },
    });

    const text = result.response.text()?.trim() || "（回答を生成できませんでした）";

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(`エラー: ${e?.message ?? "Unknown error"}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}