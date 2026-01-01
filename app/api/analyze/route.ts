export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Cadencia AI analyze API
 * Input:  { selectedNotes: string[] }  e.g. ["C", "Eb", "G", "Bb"]
 * Output: { engineChord: string, candidates: CandidateObj[], analysis: string }
 *
 * ✅ engineChord / candidates はルールベースのみ（AIは関与しない）
 * ✅ analysis（考察文章）だけAIが生成
 */

// -------------------- OpenAI --------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

// -------------------- Utils: Normalize --------------------
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##")
    .replaceAll("−", "-");
}

type ParsedNote = {
  raw: string;      // e.g. "Cb"
  letter: string;   // "C"
  acc: string;      // "", "#", "b", "##", "bb"
  pc: number;       // 0..11 pitch class
};

const LETTER_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function accToDelta(acc: string) {
  if (acc === "") return 0;
  if (acc === "#") return 1;
  if (acc === "##") return 2;
  if (acc === "b") return -1;
  if (acc === "bb") return -2;
  return 0;
}

function parseNote(noteInput: string): ParsedNote | null {
  const raw = normalizeAccidentals(noteInput);
  // Accept: C, C#, Cb, C##, Cbb
  const m = raw.match(/^([A-Ga-g])([#b]{0,2})$/);
  if (!m) return null;

  const letter = m[1].toUpperCase();
  const acc = m[2] ?? "";
  const base = LETTER_TO_PC[letter];
  if (base === undefined) return null;

  const pc = (base + accToDelta(acc) + 12) % 12;
  return { raw: `${letter}${acc}`, letter, acc, pc };
}

function uniqBy<T>(arr: T[], keyFn: (x: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

// -------------------- Chord Templates --------------------
type Template = {
  name: string;          // e.g. "maj7"
  intervals: number[];   // semitones from root
  tags?: string[];
};

const TEMPLATES: Template[] = [
  { name: "",       intervals: [0, 4, 7],            tags: ["triad", "major"] },
  { name: "m",      intervals: [0, 3, 7],            tags: ["triad", "minor"] },
  { name: "dim",    intervals: [0, 3, 6],            tags: ["triad", "diminished"] },
  { name: "aug",    intervals: [0, 4, 8],            tags: ["triad", "augmented"] },

  { name: "7",      intervals: [0, 4, 7, 10],        tags: ["seventh", "dominant7"] },
  { name: "maj7",   intervals: [0, 4, 7, 11],        tags: ["seventh", "major7"] },
  { name: "m7",     intervals: [0, 3, 7, 10],        tags: ["seventh", "minor7"] },
  { name: "mMaj7",  intervals: [0, 3, 7, 11],        tags: ["seventh", "minorMajor7"] },
  { name: "dim7",   intervals: [0, 3, 6, 9],         tags: ["seventh", "diminished7"] },
  { name: "m7b5",   intervals: [0, 3, 6, 10],        tags: ["seventh", "halfDiminished"] },

  { name: "6",      intervals: [0, 4, 7, 9],         tags: ["sixth"] },
  { name: "m6",     intervals: [0, 3, 7, 9],         tags: ["sixth"] },
];

// fallback naming (only used when input spelling doesn't provide a hint)
const PC_TO_NAME_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const PC_TO_NAME_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

function preferFlat(input: ParsedNote[]) {
  return input.some(n => n.acc.includes("b"));
}

// ✅ ここがCb/B#/E#みたいな「綴り」を尊重するポイント
// inputで出てきたpcに対して、ユーザーのraw綴りを優先表示する
function buildPreferredSpellingMap(input: ParsedNote[]) {
  const map = new Map<number, string>();
  for (const n of input) {
    if (!map.has(n.pc)) map.set(n.pc, n.raw);
  }
  return map;
}

function pcToName(pc: number, useFlat: boolean, preferred?: Map<number, string>) {
  const p = preferred?.get(pc);
  if (p) return p; // 例: pc=11 でも "Cb" を返せる
  return useFlat ? PC_TO_NAME_FLAT[pc] : PC_TO_NAME_SHARP[pc];
}

function scoreMatch(inputPcs: Set<number>, chordPcs: Set<number>) {
  let common = 0;
  for (const x of chordPcs) if (inputPcs.has(x)) common += 1;

  const missing = [...inputPcs].filter(x => !chordPcs.has(x)).length;
  const extra   = [...chordPcs].filter(x => !inputPcs.has(x)).length;

  // feel-good tuning
  return common * 30 - missing * 40 - extra * 15;
}

function buildCandidate(
  rootPc: number,
  tpl: Template,
  inputPcs: Set<number>,
  useFlat: boolean,
  bassPc: number,
  preferred: Map<number, string>
): CandidateObj {
  const chordPcs = new Set<number>(tpl.intervals.map(i => (rootPc + i) % 12));

  const chordTones = [...chordPcs].map(pc => pcToName(pc, useFlat, preferred));
  const extraTones = [...inputPcs]
    .filter(pc => !chordPcs.has(pc))
    .map(pc => pcToName(pc, useFlat, preferred));

  const tensions = extraTones.map(t => `add(${t})`);

  const base = pcToName(bassPc, useFlat, preferred);
  const root = pcToName(rootPc, useFlat, preferred);
  const chord = `${root}${tpl.name}${bassPc !== rootPc ? `/${base}` : ""}`;

  const score = scoreMatch(inputPcs, chordPcs);

  const reasonLines: string[] = [];
  reasonLines.push(`Root候補: ${root}`);
  reasonLines.push(`Chord tones: ${chordTones.join(", ")}`);
  if (extraTones.length) reasonLines.push(`Extra tones: ${extraTones.join(", ")}`);

  return {
    chord,
    base,
    root,
    score,
    has7: tpl.intervals.includes(10) || tpl.intervals.includes(11),
    tensions,
    chordTones,
    extraTones,
    reason: reasonLines,
  };
}

// -------------------- AI (analysis text) --------------------
function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

async function buildAiAnalysis(params: {
  selectedRaw: string[];
  engineChord: string;
  candidates: CandidateObj[];
}) {
  // fallback (APIキー未設定でもUIが壊れない)
  if (!process.env.OPENAI_API_KEY) {
    return [
      "（AI未接続のため、簡易ログを表示しています）",
      `入力: ${params.selectedRaw.join(", ")}`,
      `判定: ${params.engineChord}`,
      "",
      "OPENAI_API_KEY を設定すると、ここにAIの考察が表示されます。",
    ].join("\n");
  }

  const SYSTEM = `
あなたは音楽理論の先生です。役割は「説明（考察文章）」だけです。
【ルール】
- 和音名の判定をしない（engineChordの言い換え・変更もしない）。
- 異名同音は同一視しない。入力表記を尊重する（Cb は B と同じと断定しない）。
- ただし“ピッチ上は同じに聞こえるため誤解されやすい”は誤解ポイントとして述べてよい。
- 調性は断定しない。可能性を2〜3個まで。
- 前後関係がない前提なので断言を避ける。
- 出力は日本語。短く読みやすく。
- 出力はユーザー向け文章のみ（JSONやコードは出さない）。
`.trim();

  const top = params.candidates.slice(0, 5).map(c => ({
    chord: c.chord,
    score: c.score,
    chordTones: c.chordTones,
    extraTones: c.extraTones,
    base: c.base,
    root: c.root,
  }));

  const USER = `
【入力（表記はそのまま）】
${params.selectedRaw.join(", ")}

【エンジン判定（この表記を尊重して説明）】
${params.engineChord}

【候補上位（参考。判定の変更には使わない）】
${safeJson(top)}

【お願い】次の順で説明して：
1) ひとことで（1行）
2) こう聞こえる理由（構成音 / 3度・5度・7度の役割）
3) あり得る調性仮説（2〜3）
4) 誤解しがちな点（特に Cb などの表記が意味を持つケース）
5) 次に分かると強い情報（前後の進行や主旋律）
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.25,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "（AIの応答が空でした）";
}

// -------------------- Main Analyze --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalizedRaw = selectedNotes.map(normalizeAccidentals).filter(Boolean);

    const parsed = normalizedRaw.map(parseNote).filter(Boolean) as ParsedNote[];

    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    // spelling単位で重複排除（CbはCbのまま残る）
    const uniqParsed = uniqBy(parsed, n => n.raw);

    const preferred = buildPreferredSpellingMap(uniqParsed);

    const inputPcs = new Set<number>(uniqParsed.map(n => n.pc));

    // NOTE: UIの順序保証がないので「最初の要素」をベース扱い（必要なら後で改善）
    const bassPc = uniqParsed[0].pc;

    const useFlat = preferFlat(uniqParsed);

    const rootCandidates = [...new Set<number>(uniqParsed.map(n => n.pc))];

    const candidates: CandidateObj[] = [];
    for (const rootPc of rootCandidates) {
      for (const tpl of TEMPLATES) {
        candidates.push(buildCandidate(rootPc, tpl, inputPcs, useFlat, bassPc, preferred));
      }
    }

    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const top = candidates[0];
    const engineChord = top?.chord ?? "判定不能";

    const outCandidates = candidates.slice(0, 10);

    // ✅ analysisだけAI
    let analysisText = "";
    try {
      analysisText = await buildAiAnalysis({
        selectedRaw: uniqParsed.map(n => n.raw),
        engineChord,
        candidates: outCandidates,
      });
    } catch (e: any) {
      const fallback = [
        "（AI考察の生成に失敗したため、簡易ログを表示しています）",
        `入力: ${uniqParsed.map(n => n.raw).join(", ")}`,
        `最有力: ${engineChord}`,
        ...(top?.reason ? (Array.isArray(top.reason) ? top.reason : [top.reason]) : []),
      ];
      analysisText = fallback.join("\n");
    }

    return NextResponse.json({
      engineChord,
      candidates: outCandidates,
      analysis: analysisText,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}