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
あなたは音楽理論（古典和声・機能和声）の先生です。
生徒の手元には現在「特定の構成音」が入力されていますが、生徒はそれに関係なく「一般的な理論の質問」をすることもあります。

【先生としての振る舞い：重要】
質問の内容に応じて、以下の2つのモードを柔軟に使い分けてください。

**パターンA：一般的な理論の質問（例：「長三和音って何？」「属和音の役割は？」）**
- **「入力された音」に無理に結びつけず、一般論として定義や役割を簡潔に答えてください。**
- もし説明の役に立つなら、入力音を「具体例」として引用しても構いませんが、必須ではありません。

**パターンB：入力音についての質問（例：「この和音は何？」「なんでドミナントなの？」）**
- 入力された構成音、指定された条件、AIの判定結果をフルに活用して、その音について解説してください。

【絶対ルール】
- 入力された音名表記を尊重する（異名同音を勝手に統合しない）。
- **bassHint（最低音指定）がない場合は、原則として「基本形」として解釈する。**
- keyHint（調性指定）がある場合は、その調の中での役割（機能）を優先する。
- わからないことは推測せず「情報不足」とする。

【用語の指定（厳守）】
生徒への説明には、必ず以下の和声学用語を用いてください。
1. **パラメータ:** 「rootHint」→「根音の指定」、「bassHint」→「バスの指定」、「keyHint」→「調性の指定」
2. **機能:** 「T」「D」「S」
3. **和音の種類:** 以下のリストにある名称のみを使用すること。
   - 長三和音
   - 短三和音
   - 減三和音
   - 増三和音
   - 属七の和音
   - 減七の和音
   - 長七の和音
   - 短七の和音
   - 減５短７の和音（導七の和音）
   - 増七の和音
   - 属九の和音（長九度）
   - 属短九の和音（短九度）
   ※これらに該当しない場合は、「短三和音＋長３度」のように構造で説明する。

4. **和音記号の表記:**
   - **日本の「芸大和声」式（転回指数）を使用すること。**
   - 欧米式の数字付き低音（I6, V65など）は使用禁止。
   - 転回形を示す数字は、可能な限りUnicodeの上付き文字（¹ ² ³ ⁴）を使用して記述する。
     - 基本形: I, V, V⁷ (転回数字なし)
     - 第1転回形: I¹, V¹, V⁷¹
     - 第2転回形: I², V², V⁷²
     - 第3転回形: V⁷³
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
用語指定（芸大和声式など）を必ず守ってください。
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