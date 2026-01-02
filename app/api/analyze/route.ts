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
  chord: string;           // 表示用コード名（ただし断定しすぎない運用OK）
  chordType?: string;      // 例: "属七の和音" / "長三和音" / "短三和音" / "半減七" など
  score: number;           // 0..100（AI基準）
  confidence: number;      // 0..1（AI基準）
  chordTones: string[];    // 入力表記ベース
  extraTones: string[];    // 入力表記ベース
  reason: string;          // 短い根拠
  provisional?: boolean;   // 暫定判定フラグ（AIまたは補正で付与）
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;     // 最有力表示（最終的に candidates[0] に補正）
  chordType?: string;      // 最有力の種類（あれば）
  confidence: number;      // 0..1（最有力）
  analysis: string;        // 人間向け文章
  candidates: CandidateObj[];
  notes: string[];         // 正規化・表記ソート後
  keyHint: string;         // 受け取った keyHint（整形）
  rootHint: string | null; // 受け取った rootHint（整形）
  bassHint: string | null; // 受け取った bassHint（整形）
};

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（こちらで既に表記順に整列済み）
- rootHint が与えられている場合は「根音候補として強く尊重」する（ただし絶対視はせず、矛盾があれば reason に書く）
- bassHint が与えられている場合は「最低音（バス）候補として強く尊重」し、転回形/分数コードの表記に反映してよい（矛盾があれば reason に書く）
- keyHint が与えられている場合は、機能（主/属/下属など）の説明に必ず反映する
- 文脈が無い限り sus4 / add9 などを断定しない（「可能性」か「情報不足」と言う）
- 3音未満なら status="insufficient"
- 無理にコード名を決めない。曖昧なら status="ambiguous"（ただし candidates は必ず出す）
- 「半音」「ピッチクラス」「実音高」などの語を出さない（説明は音名と機能和声の言葉で）

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
- 断定できない候補は provisional=true にして reason に「文脈不足」等を書く
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
- candidates[0] は「現時点で最有力」として扱える形で（ただし曖昧なら provisional=true でOK）
- bassHint がある場合、転回形/分数コードの候補（例: C/G など）を上位に置いてよい
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」
- 機能和声の言い方で（主/属/下属、導音、倚音・掛留など）
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
        score: clampScore(c?.score, 0),
        confidence: clamp01(c?.confidence, 0),
        chordTones: safeArrStr(c?.chordTones),
        extraTones: safeArrStr(c?.extraTones),
        reason: safeStr(c?.reason, ""),
        provisional: typeof c?.provisional === "boolean" ? c.provisional : false,
      }))
      // ↓ ここで型エラーが出ていたので修正しました（CandidateObj型を明示）
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

    // まずAIのengineChordが弱い/空ならtopに寄せる
    if (!engineChord || engineChord === "判定不能") {
      engineChord = top?.chord || `${notesSorted.join("-")}(暫定)`;
    }

    // 最終的な表示は「topを正」とする（UI方針：常に最有力候補）
    if (top?.chord) engineChord = top.chord;

    const chordType = (safeStr((json as any).chordType, "").trim() || top?.chordType || "情報不足").trim();

    const statusRaw = safeStr((json as any).status, "ambiguous") as any;
    const status: AnalyzeResponse["status"] =
      statusRaw === "ok" || statusRaw === "ambiguous" || statusRaw === "insufficient"
        ? statusRaw
        : "ambiguous";

    let confidence = clamp01((json as any).confidence, 0);
    if ((!confidence || confidence === 0) && top) confidence = clamp01(top.confidence, 0.3);

    // 暫定バッジ用
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