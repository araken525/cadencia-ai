// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的:
 * - 「判定(engineChord)」「候補(candidates)」「考察(analysis)」「信頼度(confidence)」をAIで生成
 * - 入力表記は絶対に尊重（異名同音の統合禁止）
 * - 押下順は意味なし（サーバ側で表記順ソートしてからAIに渡す）
 * - keyHint / rootHint / bassHint をAIに明示的に渡す
 * - 返却直前に「常に最有力候補を表示」へ補正（engineChordは candidates[0] を採用）
 * - 順位の保険: bassHint優先 → rootHint
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

// Geminiが余計な文を返しても拾う
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

function clamp01(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(1, x));
}
function clampScore(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.min(100, Math.round(x)));
}
function safeStr(s: any, fallback = "") {
  return typeof s === "string" ? s : fallback;
}
function safeArrStr(a: any) {
  return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;           // 表示用コード名
  chordType?: string;      // 日本語の和音名
  inversion?: string;      // root, 1st, 2nd, 3rd, unknown
  romanNumeral?: string;   // I, V7 etc
  tds?: "T" | "D" | "S" | "SD" | "?";
  score: number;           // 0..100
  confidence: number;      // 0..1
  chordTones: string[];
  extraTones: string[];
  reason: string;
  provisional?: boolean;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  chordType?: string;
  confidence: number;
  analysis: string;
  candidates: CandidateObj[];
  notes: string[];
  keyHint: string;
  rootHint: string | null;
  bassHint: string | null;
};

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（こちらで既に表記順に整列済み）
- rootHint が与えられている場合は「根音候補として強く尊重」する（ただし絶対視はせず、矛盾があれば reason に書く）
- bassHint が与えられている場合は「最低音（バス）候補として強く尊重」し、転回形/分数コードの表記に反映してよい
- keyHint が与えられている場合は、機能（TDS）と和音記号を必ず算出する
- 3音未満なら status="insufficient"

【用語と言語の指定：重要】
- **chordType（和音の種類）は必ず日本語の伝統的な名称で答えてください。**
  例：長三和音、短三和音、増三和音、減三和音、属七の和音、長七の和音、短七の和音、減七の和音、半減七の和音など。
- **tds（機能）は必ず大文字一文字 "T", "D", "S" のいずれか（不明なら "?"）で答えてください。**
  ※準固有和音などで迷う場合は最も近い機能を選んでください。
- **inversion（転回形）は "root", "1st", "2nd", "3rd", "unknown" のいずれかで返してください。**

【出力はJSONのみ】（説明文やコードブロック禁止）
必ず次の形で返す：

{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "chordType": string,
  "confidence": number,   // 0..1（engineChordの自信）
  "analysis": string,     // やさしめ。機能和声。 1行結論→根拠→次に分かると強い情報
  "candidates": [
    {
      "chord": string,
      "chordType": string,
      "inversion": "root" | "1st" | "2nd" | "3rd" | "unknown",
      "tds": "T" | "D" | "S" | "?",
      "romanNumeral": string,  // 例: I, V7, ii6, Ger+6
      "score": number,        // 0..100
      "confidence": number,   // 0..1
      "chordTones": string[],
      "extraTones": string[],
      "reason": string,
      "provisional": boolean
    }
  ]
}

【candidatesの条件】
- 最大10件、上から有力順
- chordTones/extraTones は入力表記をそのまま使う
`.trim();
}

function buildUserPrompt(params: {
  notesSorted: string[];
  keyHint: string;
  rootHint: string | null;
  bassHint: string | null;
}) {
  const { notesSorted, keyHint, rootHint, bassHint } = params;

  return `
入力音（表記順・重複なし）:
${notesSorted.join(", ")}

keyHint:
${keyHint || "none"}

rootHint:
${rootHint || "none"}

bassHint:
${bassHint || "none"}

依頼:
- candidates を必ず返して（最大10）
- candidates[0] は「現時点で最有力」として扱える形で
- bassHint がある場合、転回形/分数コードの候補（例: C/G など）を上位に置いてよい
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」
- chordType は必ず日本語で（例: 長三和音）
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    // 追加入力（UIから来る）
    const keyHintRaw = typeof body?.keyHint === "string" ? body.keyHint : "none";
    const rootHintRaw = typeof body?.rootHint === "string" ? body.rootHint : null;
    const bassHintRaw = typeof body?.bassHint === "string" ? body.bassHint : null;

    // 正規化 → 無効文字を落とす → 重複排除 → 表記ソート（押下順排除）
    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    const keyHint = (keyHintRaw || "none").trim();

    // rootHint / bassHint も正規化し、かつ「選択音に含まれているか」をチェック
    const rootHintNormalized = rootHintRaw ? normalizeAccidentals(rootHintRaw).trim() : null;
    const bassHintNormalized = bassHintRaw ? normalizeAccidentals(bassHintRaw).trim() : null;

    const rootHint =
      rootHintNormalized && notesSorted.includes(rootHintNormalized) ? rootHintNormalized : null;

    const bassHint =
      bassHintNormalized && notesSorted.includes(bassHintNormalized) ? bassHintNormalized : null;

    // AI未接続でも落とさない
    if (!model) {
      const res: AnalyzeResponse = {
        status: notesSorted.length < 3 ? "insufficient" : "ambiguous",
        engineChord: notesSorted.length ? `${notesSorted[0]}(暫定)` : "判定不能",
        chordType: "情報不足",
        confidence: 0,
        analysis: "（AI未接続）GEMINI_API_KEY が未設定です。",
        candidates: [],
        notes: notesSorted,
        keyHint,
        rootHint,
        bassHint,
      };
      return NextResponse.json(res);
    }

    // 3音未満
    if (notesSorted.length < 3) {
      const label = notesSorted.length ? `${notesSorted.join("-")}(暫定)` : "判定不能";
      const res: AnalyzeResponse = {
        status: "insufficient",
        engineChord: label,
        chordType: "情報不足",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: [],
        notes: notesSorted,
        keyHint,
        rootHint,
        bassHint,
      };
      return NextResponse.json(res);
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt({ notesSorted, keyHint, rootHint, bassHint });

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

    // candidates 整形
    const rawCandidates = Array.isArray((json as any).candidates) ? (json as any).candidates : [];
    
    let candidates: CandidateObj[] = rawCandidates
      .slice(0, 10)
      .map((c: any): CandidateObj => ({
        chord: safeStr(c?.chord, "判定不能"),
        chordType: safeStr(c?.chordType, ""),
        inversion: safeStr(c?.inversion, "unknown"),
        romanNumeral: safeStr(c?.romanNumeral, ""),
        tds: (["T", "D", "S"].includes(c?.tds) ? c.tds : "?") as any,
        score: clampScore(c?.score, 0),
        confidence: clamp01(c?.confidence, 0),
        chordTones: safeArrStr(c?.chordTones),
        extraTones: safeArrStr(c?.extraTones),
        reason: safeStr(c?.reason, ""),
        provisional: typeof c?.provisional === "boolean" ? c.provisional : false,
      }))
      .filter((c: CandidateObj) => !!c.chord);

    // --------------------
    // 順位の保険（重要）
    // --------------------
    if (candidates.length > 0 && bassHint) {
      const hasSlashBass = (ch: string) => ch.includes(`/${bassHint}`);
      candidates = [
        ...candidates.filter(c => hasSlashBass(c.chord)),
        ...candidates.filter(c => !hasSlashBass(c.chord)),
      ];
    } else if (candidates.length > 0 && rootHint) {
      const startsWithRoot = (ch: string) => ch.startsWith(rootHint);
      candidates = [
        ...candidates.filter(c => startsWithRoot(c.chord)),
        ...candidates.filter(c => !startsWithRoot(c.chord)),
      ];
    }

    // --------------------
    // 「常に最有力候補を表示」補正
    // --------------------
    const top = candidates[0];
    let engineChord = safeStr((json as any).engineChord, "").trim();

    if (!engineChord || engineChord === "判定不能") {
      engineChord = top?.chord || `${notesSorted.join("-")}(暫定)`;
    }
    if (top?.chord) engineChord = top.chord;

    const chordType = (safeStr((json as any).chordType, "").trim() || top?.chordType || "情報不足").trim();

    const statusRaw = safeStr((json as any).status, "ambiguous") as any;
    const status: AnalyzeResponse["status"] =
      statusRaw === "ok" || statusRaw === "ambiguous" || statusRaw === "insufficient"
        ? statusRaw
        : "ambiguous";

    let confidence = clamp01((json as any).confidence, 0);
    if ((!confidence || confidence === 0) && top) confidence = clamp01(top.confidence, 0.3);

    if (top) {
      const prov = status !== "ok" || confidence < 0.5;
      top.provisional = top.provisional || prov;
    }

    const analysis = safeStr((json as any).analysis, "（出力が不完全でした）");

    const res: AnalyzeResponse = {
      status,
      engineChord,
      chordType,
      confidence,
      analysis,
      candidates,
      notes: notesSorted,
      keyHint,
      rootHint,
      bassHint,
    };

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}