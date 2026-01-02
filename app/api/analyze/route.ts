// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的:
 * - 「判定(engineChord)」「候補(candidates)」「考察(analysis)」「信頼度(confidence)」をAIで生成
 * - 入力表記は絶対に尊重
 * - keyHint / rootHint / bassHint をAIに明示的に渡す
 * - 保険ロジック:
 * 1. bassHintがあれば、ベース音が一致するものを最優先
 * 2. rootHintがあれば、ルート音が一致するものを最優先
 * 3. どちらもなければ、スラッシュ(/)を含まない「基本形」を強制的に最優先
 */

// -------------------- Gemini --------------------
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

// -------------------- Utils --------------------
function normalizeAccidentals(s: string) {
  return (s ?? "").trim().replaceAll("♭", "b").replaceAll("♯", "#").replaceAll("𝄫", "bb").replaceAll("𝄪", "##");
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

function parseJsonSafely(text: string) {
  const t = (text ?? "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error("AIのJSONパースに失敗しました");
}

function clamp01(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
}
function clampScore(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : fallback;
}
function safeStr(s: any, fallback = "") { return typeof s === "string" ? s : fallback; }
function safeArrStr(a: any) { return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; }

// コード名からルート音とベース音を抽出するヘルパー
function getChordRoot(chordName: string): string {
  const core = chordName.split("/")[0];
  const m = core.match(/^([A-G](?:bb|b|##|#)?)/);
  return m ? normalizeAccidentals(m[1]) : "";
}

function getChordBass(chordName: string): string {
  if (chordName.includes("/")) {
    return normalizeAccidentals(chordName.split("/")[1]);
  }
  return getChordRoot(chordName);
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;
  chordType?: string;
  inversion?: string;
  romanNumeral?: string;
  tds?: "T" | "D" | "S" | "SD" | "?";
  score: number;
  confidence: number;
  chordTones: string[];
  extraTones: string[];
  reason: string;
  provisional?: boolean;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  chordType?: string;
  confidence?: number;
  candidates: CandidateObj[];
  analysis: string;
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
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない）
- 押された順番は意味を持たない
- rootHint がある場合は「根音候補として強く尊重」する
- bassHint がある場合は「最低音（バス）候補として強く尊重」し、転回形や分数コード表記に反映する
- **bassHint の指定がない場合は、原則として「基本形」（分数コードでない形）を最優先の候補として扱ってください。**
- keyHint がある場合は、機能（TDS）と和音記号を必ず算出する
- 3音未満なら status="insufficient"

【用語と言語の指定：重要】
- **chordType（和音の種類）は必ず日本語の伝統的な名称で答えてください。**
  例：長三和音、短三和音、増三和音、減三和音、属七の和音、長七の和音、短七の和音、減七の和音、半減七の和音など。
- **tds（機能）は必ず大文字一文字 "T", "D", "S" のいずれか（不明なら "?"）で答えてください。**
- **inversion（転回形）は "root", "1st", "2nd", "3rd", "unknown" のいずれかで返してください。**

【出力はJSONのみ】
{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "analysis": string,
  "candidates": [
    {
      "chord": string,
      "chordType": string,
      "inversion": "root" | "1st" | "2nd" | "3rd" | "unknown",
      "tds": "T" | "D" | "S" | "?",
      "romanNumeral": string,
      "score": number, (0-100)
      "confidence": number, (0-1)
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

function buildUserPrompt(params: { notesSorted: string[]; keyHint: string; rootHint: string | null; bassHint: string | null; }) {
  return `
入力音: ${params.notesSorted.join(", ")}
keyHint: ${params.keyHint}
rootHint: ${params.rootHint || "none"}
bassHint: ${params.bassHint || "none"}

依頼:
- candidates[0] は現時点で最有力なものにしてください。
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const keyHintRaw = typeof body?.keyHint === "string" ? body.keyHint : "none";
    const rootHintRaw = typeof body?.rootHint === "string" ? body.rootHint : null;
    const bassHintRaw = typeof body?.bassHint === "string" ? body.bassHint : null;

    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    const keyHint = (keyHintRaw || "none").trim();
    const rootHint = rootHintRaw && notesSorted.includes(normalizeAccidentals(rootHintRaw)) ? normalizeAccidentals(rootHintRaw) : null;
    const bassHint = bassHintRaw && notesSorted.includes(normalizeAccidentals(bassHintRaw)) ? normalizeAccidentals(bassHintRaw) : null;

    if (!model) return NextResponse.json({ error: "AI未接続" }, { status: 500 });
    if (notesSorted.length < 3) {
      return NextResponse.json({ status: "insufficient", engineChord: "判定不能", analysis: "音が不足しています。", candidates: [], notes: notesSorted });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildUserPrompt({ notesSorted, keyHint, rootHint, bassHint }) }] }],
      systemInstruction: buildSystemPrompt(),
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });

    const json = parseJsonSafely(result.response.text());
    
    let candidates: CandidateObj[] = (json.candidates || []).map((c: any) => ({
      chord: safeStr(c.chord, "判定不能"),
      chordType: safeStr(c.chordType, ""),
      inversion: safeStr(c.inversion, "unknown"),
      romanNumeral: safeStr(c.romanNumeral, ""),
      tds: (["T", "D", "S"].includes(c.tds) ? c.tds : "?") as any,
      score: clampScore(c.score, 0),
      confidence: clamp01(c.confidence, 0),
      chordTones: safeArrStr(c.chordTones),
      extraTones: safeArrStr(c.extraTones),
      reason: safeStr(c.reason, ""),
      provisional: !!c.provisional,
    })).filter((c: CandidateObj) => !!c.chord);

    // --------------------
    // 順位の保険（修正済み）
    // --------------------
    if (candidates.length > 0) {
      if (bassHint) {
        // bassHintがある場合: ベース音が一致するものを最優先
        candidates.sort((a, b) => {
          const aMatch = getChordBass(a.chord) === bassHint;
          const bMatch = getChordBass(b.chord) === bassHint;
          if (aMatch && !bMatch) return -1; 
          if (!aMatch && bMatch) return 1;  
          return 0; 
        });
      } else if (rootHint) {
        // rootHintがある場合: ルート音が一致するものを最優先
        candidates.sort((a, b) => {
          const aMatch = getChordRoot(a.chord) === rootHint;
          const bMatch = getChordRoot(b.chord) === rootHint;
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return 0;
        });
      } else {
        // ★ここを追加しました
        // どちらのヒントも無い場合: 「/」を含まないもの（基本形）を強制的に最優先
        candidates.sort((a, b) => {
          const aHasSlash = a.chord.includes("/");
          const bHasSlash = b.chord.includes("/");
          // aが基本形、bが転回形なら、aを優先(-1)
          if (!aHasSlash && bHasSlash) return -1;
          // aが転回形、bが基本形なら、bを優先(1)
          if (aHasSlash && !bHasSlash) return 1;
          return 0; // 両方基本形、または両方転回形ならAIの順序に従う
        });
      }
    }

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