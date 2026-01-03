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
生徒が提示した「構成音」と、AIエンジンによる「分析結果」を見て、質問に答えてください。

【先生としての振る舞い】
- **柔軟性:** 形式張らず、質問の意図を汲んで自然に答えてください。
- **簡潔さ:** 冗長な前置きや挨拶は省略し、核心を短く（1〜2文程度で）伝えてください。
- **視点:** 基本的には「構成音」から判断しますが、迷う場合は「判定結果」も参考にしてください。

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
   ※これらに該当しない場合は、「短三和音＋長３度」のように構造で説明する。
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
  // ★ここで「その他の候補」もAIに見せるように修正しました
  const candLine = params.candidates && params.candidates.length > 0 
    ? params.candidates.join(", ") 
    : "（なし）";

  return `
【生徒が提示した音】
${params.notes.join(", ")}

【指定条件】
- 最低音(バス): ${bassLine}
- 根音: ${rootLine}
- 調性: ${keyLine}

【（参考）AIエンジンの判定結果】
- 最有力判定: ${engineLine}
- その他の候補: ${candLine}

【生徒の質問】
${params.question}

【回答への指示】
この質問に対し、提示された音と判定結果（候補含む）をすべて把握した上で、先生として簡潔に答えてください。
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