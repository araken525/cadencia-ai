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

function uniq(arr: string[]) {
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
あなたは音楽理論（古典和声・機能和声）の専門家です。

【この /ask の役割】
- 「判定結果の説明」ではなく、基本は「入力された音についての質問」に答える。
- ただし質問が“結果(コード名・候補)”に触れている場合のみ、engineChord/candidatesも参照してよい。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を統合しない。A#とBb、CbとBを同一視しない）
- 押下順は意味を持たない（こちらで表記順に整列済み）
- rootHint（根音指定）があれば「根音はそれ」として扱う（推測で別の根音に変えない）
- keyHint（調性指定）があれば、その調性の中での機能（主/属/下属など）を優先して説明する
- 文脈が無い限り sus4 / add9 / 分数コード を断定しない（可能性・情報不足と言う）
- 「半音」「ピッチクラス」「実音高」などの語を出さない
- 不明点は推測で埋めず「情報不足」と言い切ってよい

【出力】
- プレーンテキストで、短く。
- 形式は「結論 → 根拠 → 次に分かると強い情報（あれば）」。
`.trim();
}

function buildUserPrompt(params: {
  notes: string[];
  question: string;
  rootHint: string | null;
  keyHint: string | null;
  engineChord: string | null;
  candidates: string[] | null;
}) {
  const keyLine = params.keyHint ? params.keyHint : "（指定なし）";
  const rootLine = params.rootHint ? params.rootHint : "（指定なし）";
  const engineLine = params.engineChord ? params.engineChord : "（未提供）";
  const candLine = params.candidates?.length ? params.candidates.join(", ") : "（未提供）";

  return `
入力音（表記順・重複なし）:
${params.notes.join(", ")}

根音指定 rootHint:
${rootLine}

調性指定 keyHint:
${keyLine}

（参考）判定ラベル engineChord:
${engineLine}

（参考）候補一覧:
${candLine}

ユーザーの質問:
${params.question}

注意:
- まずは「入力音そのもの」について答える（質問が結果に触れている場合のみ結果も扱う）
- rootHint があるのに「根音が分からない」とは言わない
- keyHint があるのに「調性が分からない」とは言わない
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

    // rootHintは「C」みたいなベース指定が来がちなので、選択音と整合する形に寄せる
    const rootHintRaw = asNoteOrNull(body?.rootHint);
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

    // rootHintが「C」しか来てない時、選択音の中に「C#」等があるならそれを優先して合わせたいが、
    // 異名同音統合は禁止なので、ここでは「完全一致のみ採用」。
    const rootHint = rootHintRaw && notesSorted.includes(rootHintRaw) ? rootHintRaw : rootHintRaw;

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

    // 2音以下でも「入力音についての質問」なら答えられるので弾かない（ここが重要）
    const system = buildSystemPrompt();
    const user = buildUserPrompt({
      notes: notesSorted,
      question,
      rootHint,
      keyHint,
      engineChord,
      candidates,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
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