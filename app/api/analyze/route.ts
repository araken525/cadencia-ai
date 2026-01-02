// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的: 「判定(engineChord)」「候補(candidates)」「考察(analysis)」を全部AIで生成する
 * - 入力表記は絶対に尊重（異名同音の統合禁止）
 * - 押下順は意味なし（コード側でソートしてからAIに渡す）
 * - rootHint（根音指定）が来たら、それを最優先で解釈させる（ただし入力音に存在する場合のみ）
 * - keyHint（調性指定）が来たら、機能和声の語りで優先する
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

  try {
    return JSON.parse(t);
  } catch {}

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
  chord: string;
  score?: number;        // 0..100（AI基準でOK）
  confidence?: number;   // 0..1（AI基準でOK）
  chordTones?: string[];
  extraTones?: string[];
  reason?: string;
  // 追加してもOK（使わなくてもOK）
  root?: string;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  chordType?: string; // 追加: 「長三和音」「属七」などをUIに出したい用（AIに出させる）
  confidence: number; // 0..1
  analysis: string;
  candidates: CandidateObj[];
  notes: string[];
  keyHint?: string;
  rootHint?: string | null;
};

// -------------------- Prompt --------------------
function buildSystemPrompt(opts: {
  rootHint: string | null;
  keyHint: string | null;
}) {
  const { rootHint, keyHint } = opts;

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

【重要：根音指定(rootHint)がある場合】
- rootHint が与えられている場合、engineChord と candidates は「その根音(rootHint)を根音として扱う解釈」を最優先にしてください。
- rootHint を無視して別の根音にしてはいけません。
- ただし rootHint が入力音に含まれない場合は「拘束条件としては無効」とし、通常通り判断してOKです。

【調性指定(keyHint)がある場合】
- keyHint が与えられている場合、analysis はその調性の機能（主/属/下属など）に寄せて説明してください。
- ただし keyHint が不確かな場合は断定せず「その調性だと〜と解釈しやすい」程度に留める。

【出力は必ず application/json の“JSONのみ”】【説明文やコードブロック禁止】
必ず次の形で返す：

{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "chordType": string,        // 例: "長三和音" "短三和音" "属七の和音" "減七" など（わからなければ "不明"）
  "confidence": number,       // 0..1
  "analysis": string,         // やさしめ。機能和声。
  "candidates": [
    {
      "chord": string,
      "score": number,        // 0..100
      "confidence": number,   // 0..1
      "root": string,         // 候補の根音表記（入力表記に合わせる）
      "chordTones": string[],
      "extraTones": string[],
      "reason": string
    }
  ]
}

【candidatesについて】
- 最大10件。上から有力順。
- rootHint が有効な場合、候補は原則その root を共有（rootHintと同じ）するのが望ましい。
- chordTones/extraTones は入力表記をそのまま使う。
`.trim();
}

function buildUserPrompt(notesSorted: string[], opts: { rootHint: string | null; keyHint: string | null }) {
  const { rootHint, keyHint } = opts;

  return `
入力音（表記順・重複なし）:
${notesSorted.join(", ")}

rootHint（根音指定）:
${rootHint ?? "なし"}

keyHint（調性指定）:
${keyHint ?? "なし"}

依頼:
- candidates を必ず返して（最大10）
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」の順で
- rootHint が有効なら、その根音を前提に engineChord と candidates を作る
- 曖昧なら status を ambiguous にしてよいが、candidatesは必ず出す
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    // 追加: keyHint / rootHint
    const keyHintRaw: string | null = typeof body?.keyHint === "string" ? body.keyHint : null;
    const rootHintRaw: string | null = typeof body?.rootHint === "string" ? body.rootHint : null;

    // 正規化 → note形式だけ残す → 重複排除 → 表記ソート
    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    // rootHintも同じ正規化＆検証（※入力音に含まれないroot指定は無効化）
    const rootHintNorm = rootHintRaw ? normalizeAccidentals(rootHintRaw) : null;
    const rootHintValid =
      rootHintNorm && /^[A-G]((?:bb|b|##|#)?)$/.test(rootHintNorm) && notesSorted.includes(rootHintNorm)
        ? rootHintNorm
        : null;

    // keyHintは文字列としては残す（"none" なら無効）
    const keyHintNorm =
      keyHintRaw && keyHintRaw !== "none" && keyHintRaw.trim().length > 0 ? keyHintRaw.trim() : null;

    // AI未接続でもAPIが落ちないように
    if (!model) {
      const res: AnalyzeResponse = {
        status: notesSorted.length < 3 ? "insufficient" : "ambiguous",
        engineChord: notesSorted[0] ? `${notesSorted[0]}（暫定）` : "判定不能",
        chordType: "不明",
        confidence: 0,
        analysis: "（AI未接続）GEMINI_API_KEY が未設定です。",
        candidates: [],
        notes: notesSorted,
        keyHint: keyHintNorm ?? undefined,
        rootHint: rootHintValid,
      };
      return NextResponse.json(res);
    }

    // 3音未満は「和音としては不十分」だが、常に何かは返す（UI都合）
    if (notesSorted.length < 3) {
      const res: AnalyzeResponse = {
        status: "insufficient",
        engineChord: notesSorted[0] ? `${notesSorted[0]}（暫定）` : "判定不能",
        chordType: "不明",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: notesSorted[0]
          ? [
              {
                chord: `${notesSorted[0]}（暫定）`,
                score: 1,
                confidence: 0.1,
                root: rootHintValid ?? notesSorted[0],
                chordTones: notesSorted,
                extraTones: [],
                reason: "音数不足のため暫定表示",
              },
            ]
          : [],
        notes: notesSorted,
        keyHint: keyHintNorm ?? undefined,
        rootHint: rootHintValid,
      };
      return NextResponse.json(res);
    }

    const system = buildSystemPrompt({ rootHint: rootHintValid, keyHint: keyHintNorm });
    const user = buildUserPrompt(notesSorted, { rootHint: rootHintValid, keyHint: keyHintNorm });

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

    // 最低限の形に整える
    const candidates = Array.isArray((json as any).candidates) ? (json as any).candidates.slice(0, 10) : [];

    let engineChord =
      typeof json.engineChord === "string" && json.engineChord.trim().length > 0 ? json.engineChord.trim() : "判定不能";

    // ★最小改修方針：常に最有力候補を表示（AIが判定不能でも補正）
    if (engineChord === "判定不能" || engineChord === "---") {
      if (candidates?.[0]?.chord) engineChord = String(candidates[0].chord);
      else if (notesSorted[0]) engineChord = `${notesSorted[0]}（暫定）`;
    }

    const res: AnalyzeResponse = {
      status: (json.status as any) || "ambiguous",
      engineChord,
      chordType: typeof (json as any).chordType === "string" ? String((json as any).chordType) : "不明",
      confidence: typeof json.confidence === "number" ? json.confidence : 0.3,
      analysis: typeof json.analysis === "string" ? json.analysis : "（出力が不完全でした）",
      candidates,
      notes: notesSorted,
      keyHint: keyHintNorm ?? undefined,
      rootHint: rootHintValid,
    };

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}