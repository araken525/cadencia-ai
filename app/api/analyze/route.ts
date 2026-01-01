export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeAccidentals,
  parseNote,
  intervalBetween,
  uniqBy,
  transpose,
  type ParsedNote,
  type IntervalSpec,
} from "@/lib/theory/interval";

/* =========================================================
 * OpenAI（考察用・判定には一切関与しない）
 * ======================================================= */
const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

/* =========================================================
 * Types
 * ======================================================= */
type CandidateObj = {
  chord: string;
  root: string;
  base: string;
  score: number;
  has7: boolean;
  chordTones: string[];
  extraTones: string[];
  reason: string[];
};

type Template = {
  name: string;
  intervals: IntervalSpec[];
};

/* =========================================================
 * Chord templates（文字間隔ベース）
 * ======================================================= */
const TEMPLATES: Template[] = [
  { name: "",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }] },
  { name: "m",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }] },
  { name: "dim", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }] },
  { name: "aug", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }] },

  { name: "7",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }] },
  { name: "maj7", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }] },
  { name: "m7",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }] },
  { name: "mMaj7",intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }] },
  { name: "m7b5", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }] },
  { name: "dim7", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }] },
];

/* =========================================================
 * Helpers
 * ======================================================= */
function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function extractRootFromChord(chord: string): string | null {
  const m = chord.match(/^([A-G])((?:bb|b|##|#)?)/);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ""}`;
}

function scoreBySpelling(input: Set<string>, chordTones: string[]) {
  let common = 0;
  for (const t of chordTones) if (input.has(t)) common++;

  const missing = chordTones.filter(t => !input.has(t)).length;
  const extra   = [...input].filter(t => !chordTones.includes(t)).length;

  return common * 40 - missing * 60 - extra * 12;
}

/* =========================================================
 * Candidate builder（判定ロジック本体・AI不使用）
 * ======================================================= */
async function buildCandidate(params: {
  rootRaw: string;
  bassRaw: string;
  tpl: Template;
  inputSet: Set<string>;
}): Promise<CandidateObj> {
  const chordTones = [params.rootRaw];
  for (const spec of params.tpl.intervals) {
    const t = transpose(params.rootRaw, spec);
    if (t) chordTones.push(t);
  }

  const extraTones = [...params.inputSet].filter(n => !chordTones.includes(n));
  const score = scoreBySpelling(params.inputSet, chordTones);

  const chord =
    params.bassRaw !== params.rootRaw
      ? `${params.rootRaw}${params.tpl.name}/${params.bassRaw}`
      : `${params.rootRaw}${params.tpl.name}`;

  return {
    chord,
    root: params.rootRaw,
    base: params.bassRaw,
    score,
    has7: params.tpl.intervals.some(i => i.number === 7),
    chordTones,
    extraTones,
    reason: [
      `root=${params.rootRaw}`,
      `tones=${chordTones.join(", ")}`,
      ...(extraTones.length ? [`extra=${extraTones.join(", ")}`] : []),
    ],
  };
}

/* =========================================================
 * AI analysis（説明専用）
 * ======================================================= */
async function buildAiAnalysis(params: {
  selectedRaw: string[];
  engineChord: string;
  candidates: CandidateObj[];
  bassRaw: string;
}) {
  if (!openai) {
    return [
      "（AI未接続）",
      `入力: ${params.selectedRaw.join(", ")}`,
      `判定: ${params.engineChord}`,
    ].join("\n");
  }

  const root = extractRootFromChord(params.engineChord);
  const intervalLines =
    root
      ? params.selectedRaw.map(n => {
          const itv = intervalBetween(root, n);
          return `${root}→${n}: ${itv ? itv.label : "算出不可"}`;
        }).join("\n")
      : "root抽出不可";

  const SYSTEM = `
あなたは古典和声（機能和声）を専門とする音楽理論家です。
音程・度数は必ず「音名の文字間隔」で扱い、
半音数・実音高・ピッチクラスを基準に説明してはいけません。

【厳守】
- engineChord を変更・言い換え・再判定しない
- 入力表記を最優先（CbはCb、FbはFb）
- 推測で埋めず、不明なら「情報不足」と言う
- 調性は2〜3個の仮説まで
`.trim();

  const USER = `
【入力】
${params.selectedRaw.join(", ")}

【engineChord】
${params.engineChord}

【音程（文字間隔）】
${intervalLines}

【候補（参考・再判定禁止）】
${safeJson(params.candidates.slice(0, 3))}

【出力】
1) ひとことで
2) 構成音の整理（文字間隔）
3) 機能仮説
4) 調性仮説
5) 誤解ポイント
6) 次に必要な情報
`.trim();

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  });

  return res.choices[0]?.message?.content?.trim() ?? "";
}

/* =========================================================
 * Route
 * ======================================================= */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalized = selectedNotes.map(normalizeAccidentals).filter(Boolean);

    // ★ ここが重要：型ガードで null を完全排除
    const parsed: ParsedNote[] = normalized
      .map(parseNote)
      .filter((n): n is ParsedNote => n !== null);

    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    const uniqParsed = uniqBy(parsed, n => n.raw);
    const selectedRaw = uniqParsed.map(n => n.raw);

    const bassRaw = parseNote(normalized[0])?.raw ?? selectedRaw[0];
    const inputSet = new Set(selectedRaw);

    const candidates: CandidateObj[] = [];
    for (const rootRaw of selectedRaw) {
      for (const tpl of TEMPLATES) {
        candidates.push(await buildCandidate({
          rootRaw,
          bassRaw,
          tpl,
          inputSet,
        }));
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const outCandidates = candidates.slice(0, 10);
    const engineChord = outCandidates[0]?.chord ?? "判定不能";

    const analysis = await buildAiAnalysis({
      selectedRaw,
      engineChord,
      candidates: outCandidates,
      bassRaw,
    });

    return NextResponse.json({
      engineChord,
      candidates: outCandidates,
      analysis,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}