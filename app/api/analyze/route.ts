export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Cadencia AI analyze API
 * Input: { selectedNotes: string[] }  e.g. ["C", "Eb", "G", "Bb"]
 * Output: { engineChord: string, candidates: CandidateObj[], analysis: string }
 *
 * ✅ ここで「ルールベース判定（候補生成）」をしつつ
 * ✅ AIに考察文（analysis）を書かせて返す
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
  intervals: number[];   // in semitones from root
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

const PC_TO_NAME_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const PC_TO_NAME_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

// prefer flat-ish spelling if user typed any "b"
function preferFlat(input: ParsedNote[]) {
  return input.some(n => n.acc.includes("b"));
}

function pcToName(pc: number, useFlat: boolean) {
  return useFlat ? PC_TO_NAME_FLAT[pc] : PC_TO_NAME_SHARP[pc];
}

function scoreMatch(target: Set<number>, candidate: Set<number>) {
  let common = 0;
  for (const x of candidate) if (target.has(x)) common += 1;
  const missing = [...target].filter(x => !candidate.has(x)).length;
  const extra   = [...candidate].filter(x => !target.has(x)).length;
  return common * 30 - missing * 40 - extra * 15;
}

function buildCandidate(
  rootPc: number,
  tpl: Template,
  inputPcs: Set<number>,
  useFlat: boolean,
  bassPc: number
): CandidateObj {
  const chordPcs = new Set<number>(tpl.intervals.map(i => (rootPc + i) % 12));

  const chordTones = [...chordPcs].map(pc => pcToName(pc, useFlat));
  const extraTones = [...inputPcs]
    .filter(pc => !chordPcs.has(pc))
    .map(pc => pcToName(pc, useFlat));

  const tensions = extraTones.map(t => `add(${t})`);

  const base = pcToName(bassPc, useFlat);
  const root = pcToName(rootPc, useFlat);
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
  // OpenAI未設定でもアプリ自体は動かしたいので fallback も用意
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
- 異名同音は同一視しない。入力表記を尊重する（Cb は B と“同じ音”と書かない）。
- ただし、ピッチクラス上の一致が誤解の原因になる場合は「誤解ポイント」として言及してよい。
- 調性は断定しない。可能性を2〜3個まで。
- 文章は日本語で、短く読みやすく。箇条書きOK。
- 出力は“ユーザー向けの自然な文章”だけ（JSONなどは出さない）。
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

【エンジン判定】
${params.engineChord}

【候補上位（参考）】
${safeJson(top)}

【お願い】
この和音を「機能和声/古典和声」の観点で、次の順で説明して：
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

    const parsed = normalizedRaw
      .map(parseNote)
      .filter(Boolean) as ParsedNote[];

    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    // ✅ spelling単位で重複排除（CbはCbのまま生きる）
    const uniqParsed = uniqBy(parsed, n => n.raw);

    const inputPcs = new Set<number>(uniqParsed.map(n => n.pc));
    const bassPc = uniqParsed[0].pc; // 最初に選ばれたものをベース扱い
    const useFlat = preferFlat(uniqParsed);

    // Root candidates: every input note's pitch class as possible root
    const rootCandidates = [...new Set<number>(uniqParsed.map(n => n.pc))];

    const candidates: CandidateObj[] = [];
    for (const rootPc of rootCandidates) {
      for (const tpl of TEMPLATES) {
        candidates.push(buildCandidate(rootPc, tpl, inputPcs, useFlat, bassPc));
      }
    }

    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const top = candidates[0];
    const engineChord = top?.chord ?? "判定不能";

    // UI用は上位10件
    const outCandidates = candidates.slice(0, 10);

    // ✅ ここが本題：AIに「analysis文章」を書かせる
    let analysisText = "";
    try {
      analysisText = await buildAiAnalysis({
        selectedRaw: uniqParsed.map(n => n.raw),
        engineChord,
        candidates: outCandidates,
      });
    } catch (e: any) {
      // AI失敗時のフォールバック（最低限は返す）
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
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}