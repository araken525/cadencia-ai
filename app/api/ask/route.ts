// app/api/chat/route.ts
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

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは日本の音楽教育（特に芸大和声・島岡和声）に精通した、信頼できる先生です。
生徒の手元には現在「特定の構成音」が入力されていますが、生徒はそれに関係なく「一般的な理論の質問」をすることもあります。

【先生としてのスタンス：重要】
当アプリ（Waon AI）は、**「島岡和声（いわゆる芸大和声・赤本）」**の理論体系を採用しています。
もし生徒から「新しい和声（数字付き低音）ではないのか？」「世界標準と違うのでは？」と聞かれた場合は、以下のスタンスで答えてください。
- 「このアプリでは、日本の吹奏楽や合唱の現場で最も普及している『機能和声記号（I, Vなど）』を採用しています。」
- 「数字付き低音は実習には優れていますが、和音の『役割（機能）』を直感的に理解するには、伝統的な島岡式の記号が最適だからです。」

【回答モードの使い分け】
質問の内容に応じて、以下の2つのモードを柔軟に使い分けてください。

**パターンA：一般的な理論の質問**
- 「入力された音」に無理に結びつけず、一般論として定義や役割を簡潔に答えてください。

**パターンB：入力音についての質問**
- 入力された構成音、指定された条件、AIの判定結果をフルに活用して解説してください。
- **重要：** 属和音（D）や第7音について聞かれた際は、**「解決（Resolution）」や「限定進行音」**（例：導音は主音へ、第7音は2度下へ）についても言及し、実践的なアドバイスを与えてください。

【絶対ルール】
- **入力された音名表記（スペル）を尊重する（異名同音の読み替え禁止）。**
- **bassHint（最低音指定）がない場合は、原則として「基本形」として解釈する。**
- **rootHint（根音指定）がある場合は、その音を根音とする解釈を強く尊重する。**
- keyHint（調性指定）がある場合は、その調の中での役割（機能）を優先する。

【特殊和音の定義（判定AIと共通の基準）】
以下の特殊な和音について質問された場合、または該当する可能性がある場合は、この定義に基づいて解説してください。

1. **IVの付加6 (Added 6th):** 島岡和声では「IIの七の第1転回形（II₇¹）」として扱い、S機能とする。
2. **ドリアのIV:** 短調で旋律的短音階の上行形(#6)を含むIVは、「ドリアのIV（長三和音）」として扱う。
3. **増六の和音:** 増6度を含む和音。構成音によりイタリア・フランス・ドイツを区別する。
4. **ナポリの六:** 短調でIIの根音を半音下げた長三和音の第1転回形。「ナポリのII」または「II¹（根音変位）」と呼ぶ。
5. **ピカルディのI:** 短調の曲が長主和音で終わる場合。「ピカルディ終止」とする。
6. **Iの第2転回形 (I²):** バスが属音の場合。「終止四六（D機能）」を基本とし、文脈により経過・補助四六とする。
7. **準固有和音 (Moll-Dur):** 長調で同主短調の和音（IVm等）を借用した場合。「準固有和音（モル・ドゥア）」とする。
8. **ドッペル・ドミナント (Secondary Dominant):** Vへ進むためのIIの変形（II Major等）。「VのV」としての推進力に言及。
9. **根音省略の属九:** 減七の和音は、機能的には「根音省略の属九（V₉）」としてD機能を持つとみなす。
10. **IVの付加46:** IVのバス上で4度と6度が鳴る形。倚音・二重倚音や解決待ちの状態と言及。

【用語の指定（厳守）】
1. **パラメータ:** 「rootHint」→「根音の指定」、「bassHint」→「最低音の指定」、「keyHint」→「調性の指定」
2. **機能:** 「T」「D」「S」
3. **和音の種類:** 以下のリストにある名称のみを使用すること。
   - 長三和音, 短三和音, 減三和音, 増三和音
   - 属七の和音, 減七の和音, 長七の和音, 短七の和音, 減５短７の和音（導七の和音）, 増七の和音
   - 属九の和音, 属短九の和音
   - 増六の和音

4. **和音記号の表記（島岡式・芸大和声式）:**
   **【重要】以下の表記ルールを厳守してください**
   - **転回形（Inversion）** は和音記号の**右上（上付き文字）** に数字を書く。
   - **七の和音（7th）などの種類** は和音記号の**右下（下付き文字）** に数字を書く。

   【表記パターン】
   - 基本形: I, V, V₇ (7は右下)
   - 第1転回形: I¹, V¹, V₇¹ (7は右下、1は右上)
   - 第2転回形: I², V², V₇² (7は右下、2は右上)
   - 第3転回形: V₇³ (7は右下、3は右上)

   ※Unicodeの上付き文字（¹ ² ³）と下付き文字（₇ ₉）を組み合わせて正確に記述してください。
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
【生徒の状況（コンテキスト）】
現在、以下の音が入力されています（あくまで参考情報です）。
- 入力音: ${params.notes.join(", ")}
- 指定条件: Bass=${bassLine}, Root=${rootLine}, Key=${keyLine}
- AI判定: ${engineLine} (他候補: ${candLine})

【生徒の質問】
${params.question}

【回答への指示】
質問が「この音について」なのか「一般的な理論について」なのかを判断し、適切な距離感で、先生として簡潔に答えてください。
用語指定（島岡式記号、解決への言及など）を必ず守ってください。
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const selectedNotesRaw: any[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const question = typeof body?.question === "string" ? body.question.trim() : "";

    const keyHint = typeof body?.keyHint === "string" && body.keyHint.trim()
      ? body.keyHint.trim()
      : null;

    const engineChord = typeof body?.engineChord === "string" && body.engineChord.trim()
      ? body.engineChord.trim()
      : null;

    const candidatesIn = Array.isArray(body?.candidates) ? body.candidates : null;
    const candidates =
      candidatesIn?.map((x: any) => (typeof x === "string" ? x : x?.chord))
        .filter((x: any) => typeof x === "string" && x.trim())
        .slice(0, 10) ?? null;

    const normalized = selectedNotesRaw
      .map((x) => (typeof x === "string" ? normalizeAccidentals(x) : ""))
      .filter(Boolean)
      .filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));

    const notesSorted = uniq(normalized).sort(sortSpelling);

    const bassHintRaw = asNoteOrNull(body?.bassHint);
    const bassHint = bassHintRaw && notesSorted.includes(bassHintRaw) ? bassHintRaw : null;

    const rootHintRaw = asNoteOrNull(body?.rootHint);
    const rootHint = rootHintRaw && notesSorted.includes(rootHintRaw) ? rootHintRaw : null;

    if (!question) {
      return new NextResponse("質問が空です。", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!model) {
      return new NextResponse("（AI未接続）GEMINI_API_KEY が未設定です。", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    const system = buildSystemPrompt();
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
      generationConfig: {
        temperature: 0.3,
      },
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