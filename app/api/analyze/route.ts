// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  normalizeAccidentals,
  parseNote,
  transpose,
  intervalBetween,
  uniqBy,
  type ParsedNote,
  type IntervalSpec,
} from "@/lib/theory/interval";

/**
 * 方針
 * - ルールベースで候補(candidates)は必ず返す（UIの「候補一覧」を維持）
 * - AIは「analysis（文章）」と「status/confidence」を返す（ただし判定はAIに丸投げしない）
 * - 押下順は排除（表記順で正規化）
 * - 異名同音は統合しない（CbはCb / FbはFbのまま）
 * - sus4暴れ対策：3度が入ってる場合はsus系のスコアを下げる
 */

// -------------------- Gemini --------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = process.env.GEMINI_API_KEY
  ? genAI.getGenerativeModel({ model: geminiModelName })
  : null;

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;
  base?: string;
  score?: number;
  root?: string;
  has7?: boolean;
  tensions?: string[];
  chordTones?: string[];
  extraTones?: string[];
  reason?: string | string[];
};

type Template = {
  name: string;
  intervals: IntervalSpec[]; // root以外（表記・度数ベース）
  tags?: string[];
  kind?: "triad" | "seventh" | "sixth";
};

const TEMPLATES: Template[] = [
  // triads
  { name: "",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }], kind: "triad" },
  { name: "m",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }], kind: "triad" },
  { name: "dim", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }], kind: "triad" },
  { name: "aug", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }], kind: "triad" },

  // sus
  { name: "sus2", intervals: [{ number: 2, quality: "M" }, { number: 5, quality: "P" }], kind: "triad" },
  { name: "sus4", intervals: [{ number: 4, quality: "P" }, { number: 5, quality: "P" }], kind: "triad" },

  // sevenths
  { name: "7",     intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], kind: "seventh" },
  { name: "maj7",  intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], kind: "seventh" },
  { name: "m7",    intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], kind: "seventh" },
  { name: "mMaj7", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], kind: "seventh" },
  { name: "m7b5",  intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }], kind: "seventh" },
  { name: "dim7",  intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }], kind: "seventh" },

  // sixths
  { name: "6",  intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], kind: "sixth" },
  { name: "m6", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], kind: "sixth" },
];

// ---- 表記ソート（押した順排除）----
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

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function chordTonesFrom(rootRaw: string, tpl: Template): string[] {
  const tones: string[] = [rootRaw];
  for (const spec of tpl.intervals) {
    const t = transpose(rootRaw, spec);
    if (t) tones.push(t);
  }
  return tones;
}

// sus暴れ対策込み（表記一致を最優先）
function scoreBySpelling(inputSet: Set<string>, chordTones: string[], tpl: Template) {
  let common = 0;
  for (const t of chordTones) if (inputSet.has(t)) common += 1;

  const missing = chordTones.filter(t => !inputSet.has(t)).length;
  const extra = [...inputSet].filter(n => !chordTones.includes(n)).length;

  // まず「一致」が最優先
  let score = common * 45 - missing * 90 - extra * 12;

  // susは「3度が入っているとき」かなり下げる（暴れ防止）
  if (tpl.name === "sus4" || tpl.name === "sus2") {
    const root = chordTones[0];
    const maj3 = transpose(root, { number: 3, quality: "M" });
    const min3 = transpose(root, { number: 3, quality: "m" });
    const has3 = (maj3 && inputSet.has(maj3)) || (min3 && inputSet.has(min3));
    if (has3) score -= 120; // 3度があるならsusを強く避ける
    else score += 10;       // 3度が無いなら少しだけ押す
  }

  // 9thが出ない対策：テンプレに無い音を「extra」として落としすぎない
  // （ただし“add9と断定”はしない。候補順位が死なない程度に緩める）
  if (extra >= 1) score += Math.max(0, 12 - extra * 3);

  return score;
}

function buildCandidate(params: {
  rootRaw: string;
  tpl: Template;
  inputSet: Set<string>;
  bassRaw: string;
}): CandidateObj {
  const chordTones = chordTonesFrom(params.rootRaw, params.tpl);

  const extraTones = [...params.inputSet].filter(n => !chordTones.includes(n));
  const tensions = extraTones.map(t => `add(${t})`);

  const score = scoreBySpelling(params.inputSet, chordTones, params.tpl);

  const chord =
    params.bassRaw !== params.rootRaw
      ? `${params.rootRaw}${params.tpl.name}/${params.bassRaw}`
      : `${params.rootRaw}${params.tpl.name}`;

  const has7 = params.tpl.intervals.some(s => s.number === 7);

  const reasonLines: string[] = [];
  reasonLines.push(`Root(表記): ${params.rootRaw}`);
  reasonLines.push(`Chord tones(表記): ${chordTones.join(", ")}`);
  if (extraTones.length) reasonLines.push(`Extra(表記): ${extraTones.join(", ")}`);

  return {
    chord,
    base: params.bassRaw,
    root: params.rootRaw,
    score,
    has7,
    tensions,
    chordTones,
    extraTones,
    reason: reasonLines,
  };
}

// -------------------- AI analysis（JSON） --------------------
async function buildAiAnalysis(params: {
  selectedRaw: string[];
  engineChord: string; // ここは「候補1位」をそのまま渡す（AIに再判定させない）
  candidates: CandidateObj[];
}) {
  if (!model) {
    return {
      status: "ok" as const,
      confidence: 0,
      analysis:
        "（AI未接続）OPENAI/GeminiのAPIキーが未設定です。候補はルールベースで表示しています。",
    };
  }

  const top = params.candidates.slice(0, 5).map(c => ({
    chord: c.chord,
    score: c.score,
    chordTones: c.chordTones,
    extraTones: c.extraTones,
  }));

  // engineChord根音→各音の音程ラベル（文字間隔ベース）
  const rootGuess = params.engineChord.match(/^([A-G])((?:bb|b|##|#)?)/)?.[0] ?? "";
  const intervalMap =
    rootGuess
      ? params.selectedRaw.map(n => `${rootGuess}→${n}: ${intervalBetween(rootGuess, n)?.label ?? "（算出不可）"}`).join("\n")
      : "（engineChordから根音表記を取得できませんでした）";

  const system = `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール】
- 入力された音名表記をそのまま使う（異名同音を勝手に統合しない）
- 押された順番は意味を持たない（提示された順＝表記順）
- engineChord を言い換え・再判定しない（そのまま引用するだけ）
- sus4 / add9 / 9th は文脈が無ければ断定しない（“可能性”か“情報不足”）
- 「半音」「ピッチクラス」「実音高」などの語を出さない
- 機能和声の言い方を優先（主/属/下属、導音、倚音・経過音など）
- 不明点は推測で埋めず「情報不足」と言い切ってよい

【出力は必ずJSONだけ】
{
  "status": "ok" | "ambiguous" | "insufficient",
  "confidence": number, // 0〜1
  "analysis": string
}
`.trim();

  const user = `
選択音（表記順）:
${params.selectedRaw.join(", ")}

engineChord（変更禁止）:
${params.engineChord}

根音→各音の音程ラベル（文字間隔）:
${intervalMap}

候補上位（参考・再判定禁止）:
${safeJson(top)}

出力条件:
- 文章はやさしく（専門語は必要最小限）
- まず1行結論、その後に根拠、最後に「次に分かると強い情報」
`.trim();

  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: user }] }],
    systemInstruction: system,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const text = result.response.text();
  return JSON.parse(text);
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalizedRaw = selectedNotes.map(normalizeAccidentals).filter(Boolean);
    const parsed = normalizedRaw
      .map(parseNote)
      .filter((n): n is ParsedNote => n !== null);

    // 表記ユニーク→表記順ソート（押下順排除）
    const uniqParsed = uniqBy(parsed, n => n.raw);
    const selectedRaw = uniqParsed.map(n => n.raw).sort(sortSpelling);

    // 候補生成は「3音未満でも」一応返す（UI都合）
    // ただし status は insufficient にする
    const inputSet = new Set<string>(selectedRaw);
    const rootCandidates = [...selectedRaw]; // 表記をそのまま root 候補にする

    const candidates: CandidateObj[] = [];
    if (selectedRaw.length >= 1) {
      // bassは押下順を使わず、表記順先頭に固定
      const bassRaw = selectedRaw[0];

      for (const rootRaw of rootCandidates) {
        for (const tpl of TEMPLATES) {
          candidates.push(buildCandidate({ rootRaw, tpl, inputSet, bassRaw }));
        }
      }

      // 同点タイブレークを固定（順序ブレ防止）
      candidates.sort((a, b) => {
        const ds = (b.score ?? 0) - (a.score ?? 0);
        if (ds !== 0) return ds;
        return (a.chord ?? "").localeCompare(b.chord ?? "");
      });
    }

    const outCandidates = candidates.slice(0, 10);
    const top = outCandidates[0];

    // 3音未満は「判定不能」だが、候補とanalysisは返す
    if (selectedRaw.length < 3) {
      return NextResponse.json({
        status: "insufficient",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: outCandidates,
        notes: selectedRaw,
        orderPolicy: "spelling-sorted",
      });
    }

    // topが弱すぎる時は ambiguous/no_match 扱い（ただし候補は返す）
    const engineChord = top?.chord ?? "判定不能";
    const weak = !top || (top.score ?? -999999) < 0;

    const ai = await buildAiAnalysis({
      selectedRaw,
      engineChord,
      candidates: outCandidates,
    }).catch(() => ({
      status: weak ? "ambiguous" : "ok",
      confidence: 0,
      analysis: weak
        ? "この入力はテンプレ一致が弱く、判定が曖昧です（情報不足）。"
        : "（AI考察の生成に失敗しました。候補表示は動作しています。）",
    }));

    return NextResponse.json({
      status: weak ? "ambiguous" : (ai.status ?? "ok"),
      engineChord,
      confidence: typeof ai.confidence === "number" ? ai.confidence : (weak ? 0.2 : 0.6),
      analysis: ai.analysis ?? "",
      candidates: outCandidates,
      notes: selectedRaw,
      orderPolicy: "spelling-sorted",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}