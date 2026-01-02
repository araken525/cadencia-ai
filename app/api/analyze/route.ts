// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的: 「判定(engineChord)」「候補(candidates)」「考察(analysis)」を全部AIで生成する
 * - 入力表記は絶対に尊重（異名同音の統合禁止）
 * - 押下順は意味なし（コード側でソートしてからAIに渡す）
 * - 文脈不足なら "ambiguous" / "insufficient" を明言
 * - 出力は必ずJSON
 */

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

// Geminiがたまに余計な文字を返しても拾えるようにする
function parseJsonSafely(text: string) {
  const t = (text ?? "").trim();

  // まず素直にJSON.parse
  try {
    return JSON.parse(t);
  } catch {}

  // JSONっぽい塊だけ抜く
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }

  throw new Error("AIのJSONパースに失敗しました");
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;              // 表記込み（例: "C7", "Dsus4", "Fadd9" など。ただし断定しない運用もOK）
  score?: number;             // 0..100（AI基準でOK）
  confidence?: number;        // 0..1（AI基準でOK）
  chordTones?: string[];      // 入力表記ベース
  extraTones?: string[];      // 入力表記ベース
  reason?: string;            // 短い根拠
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;        // UI表示用の“最有力ラベル”（曖昧なら "判定不能" でもOK）
  confidence: number;         // 0..1
  analysis: string;           // 人間向け文章（機能和声ベース）
  candidates: CandidateObj[]; // 候補一覧（UI維持）
  notes: string[];            // 正規化・ソート後
};

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール（嘘防止）】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（こちらで既に表記順に整列済み）
- 文脈が無い限り、sus4 / add9 / 9th / 分数コード を断定しない（「可能性」か「情報不足」と言う）
- 無理にコード名を決めない。曖昧なら status="ambiguous"、3音未満なら status="insufficient"
- 「半音」「ピッチクラス」「実音高」などの語を出さない（説明は音名と機能和声の言葉で）
- 機能和声の語彙を優先（主和音/属和音/下属和音、導音、倚音/経過音/掛留など）
- 不明点は推測で埋めず「情報不足」と言い切ってよい

【出力は必ず application/json の“JSONのみ”】【説明文やコードブロック禁止】
必ず次の形で返す：

{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "confidence": number,   // 0..1
  "analysis": string,     // 人間向け。やさしめ。機能和声。
  "candidates": [
    {
      "chord": string,
      "score": number,        // 0..100
      "confidence": number,   // 0..1
      "chordTones": string[],
      "extraTones": string[],
      "reason": string
    }
  ]
}

【candidatesについて】
- 最大10件。上から有力順。
- “断定できない候補”は、reasonに「文脈不足」などを明記してOK。
- chordTones/extraTones は入力表記をそのまま使う。
`.trim();
}

function buildUserPrompt(notesSorted: string[]) {
  return `
入力音（表記順・重複なし）:
${notesSorted.join(", ")}

依頼:
- candidates を必ず返して（最大10）
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」の順で
- 曖昧なら status を ambiguous にして、engineChord は "判定不能" でもOK
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    // 正規化 → 無効文字を落とす → 重複排除 → 表記ソート（押下順排除）
    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter(n => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    // AI未接続でもAPIが落ちないように
    if (!model) {
      const res: AnalyzeResponse = {
        status: notesSorted.length < 3 ? "insufficient" : "ambiguous",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "（AI未接続）GEMINI_API_KEY が未設定です。",
        candidates: [],
        notes: notesSorted,
      };
      return NextResponse.json(res);
    }

    // 3音未満はAIに投げてもいいが、安定のためここで打ち切り（UI的にも明確）
    if (notesSorted.length < 3) {
      const res: AnalyzeResponse = {
        status: "insufficient",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: [],
        notes: notesSorted,
      };
      return NextResponse.json(res);
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt(notesSorted);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const text = result.response.text();
    const json = parseJsonSafely(text) as Partial<AnalyzeResponse>;

    // 最低限の形に整える（壊れたJSONでもアプリが落ちないように）
    const res: AnalyzeResponse = {
      status: (json.status as any) || "ambiguous",
      engineChord: typeof json.engineChord === "string" ? json.engineChord : "判定不能",
      confidence: typeof json.confidence === "number" ? json.confidence : 0.3,
      analysis: typeof json.analysis === "string" ? json.analysis : "（出力が不完全でした）",
      candidates: Array.isArray((json as any).candidates) ? (json as any).candidates.slice(0, 10) : [],
      notes: notesSorted,
    };

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}