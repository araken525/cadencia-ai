// app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的: 判定結果(engineChord)ではなく、「入力された音(selectedNotes)」について質問に答える
 * - 異名同音は統合禁止（A# と Bb を同一視しない）
 * - 押下順は意味なし（フロント/サーバで整列済み想定。ここでも保険で整列）
 * - rootHint / keyHint は “参考情報”。断定材料が不足なら「情報不足」と明言
 * - 出力は text/plain（フロントがそのまま表示できる）
 */

const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

// ---- Utils ----
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##")
    .replaceAll("−", "-");
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

function ensureNoteList(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const normalized = arr.map(normalizeAccidentals).filter(Boolean);
  const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
  return uniq(onlyNotes).sort(sortSpelling);
}

// ---- Prompt ----
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を統合しない：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（入力は既に整列済み）
- 文脈がない限り、sus / add9 / 分数コード / 転回形 / 機能 を断定しない（可能性 or 情報不足）
- 「半音」「ピッチクラス」「実音高」などの語を出さない
- 機能和声の語彙を優先（主・属・下属、導音、倚音/経過音/掛留 など）
- rootHint/keyHint は“参考情報”。矛盾があれば従わず「矛盾/情報不足」と言う

【あなたの仕事】
- 質問に対して、入力音から説明する
- 必要なら「この音が何度に当たるか」「どういう和音候補がありうるか」を“断定せず”説明
- 最後に「追加で分かると強い情報」を1行で添える
`.trim();
}

function buildUserPrompt(params: {
  notes: string[];
  question: string;
  keyHint?: string;
  rootHint?: string | null;
  engineChord?: string; // 参考として渡すだけ（なくてもOK）
  topChord?: string;    // 参考（候補1位など）
}) {
  const keyLine =
    params.keyHint && params.keyHint !== "none" ? `調性ヒント: ${params.keyHint}` : "調性ヒント: （指定なし）";

  const rootLine =
    params.rootHint ? `根音ヒント(rootHint): ${params.rootHint}` : "根音ヒント(rootHint): （指定なし）";

  const engineLine =
    params.engineChord && params.engineChord.trim()
      ? `参考ラベル(engineChord): ${params.engineChord.trim()}`
      : "参考ラベル(engineChord): （なし）";

  const topLine =
    params.topChord && params.topChord.trim()
      ? `参考（候補1位など）: ${params.topChord.trim()}`
      : "参考（候補1位など）: （なし）";

  return `
入力音（表記順・重複なし）:
${params.notes.join(", ")}

${keyLine}
${rootLine}
${engineLine}
${topLine}

ユーザーの質問:
${params.question}

回答条件:
- 結論→根拠→補足→追加で分かると強い情報（1行）の順
- 断定できない場合は「情報不足」と明言
`.trim();
}

// ---- Route ----
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const question = String(body?.question ?? "").trim();
    if (!question) {
      return new NextResponse("質問が空です。", { status: 400 });
    }

    const notes = ensureNoteList(body?.selectedNotes);
    if (notes.length === 0) {
      return new NextResponse("入力音がありません。", { status: 400 });
    }

    // 任意パラメータ（なくてもOK）
    const keyHint = typeof body?.keyHint === "string" ? body.keyHint : undefined;
    const rootHint = typeof body?.rootHint === "string" ? body.rootHint : null;

    // フロント都合で engineChord を渡してくる場合もあるが、「参考」として扱う
    const engineChord = typeof body?.engineChord === "string" ? body.engineChord : "";

    // candidates[0].chord を topChord として渡してもOK（なくても動く）
    const topChord = typeof body?.topChord === "string" ? body.topChord : "";

    if (!model) {
      return new NextResponse("（AI未接続）GEMINI_API_KEY が未設定です。", { status: 500 });
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt({ notes, question, keyHint, rootHint, engineChord, topChord });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
      },
    });

    const text = result.response.text()?.trim() ?? "";
    return new NextResponse(text || "（空の応答でした）", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(`システムエラー: ${e?.message ?? "Unknown error"}`, { status: 500 });
  }
}