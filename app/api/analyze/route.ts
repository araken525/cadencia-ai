import { NextResponse } from "next/server";

/**
 * Cadencia AI analyze API
 * Input: { selectedNotes: string[] }  e.g. ["C", "Eb", "G", "Bb"]
 * Output: { engineChord: string, candidates: CandidateObj[], analysis: string }
 */

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
    .replaceAll("−", "-"); // just in case
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
  tags?: string[];       // for UI/analysis
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

  // 6th chords (optional but useful)
  { name: "6",      intervals: [0, 4, 7, 9],         tags: ["sixth"] },
  { name: "m6",     intervals: [0, 3, 7, 9],         tags: ["sixth"] },
];

const PC_TO_NAME_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const PC_TO_NAME_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

// prefer spelling based on user's input
function preferFlat(input: ParsedNote[]) {
  return input.some(n => n.acc.includes("b"));
}

function pcToName(pc: number, useFlat: boolean) {
  return useFlat ? PC_TO_NAME_FLAT[pc] : PC_TO_NAME_SHARP[pc];
}

function scoreMatch(target: Set<number>, candidate: Set<number>) {
  // simple scoring: reward common tones, penalize missing/extras
  let common = 0;
  for (const x of candidate) if (target.has(x)) common += 1;
  const missing = [...target].filter(x => !candidate.has(x)).length;
  const extra   = [...candidate].filter(x => !target.has(x)).length;

  // weights tuned for "feel good" ranking
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

  const tensions = extraTones.map(t => `add(${t})`); // light-touch

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

// -------------------- Main Analyze --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const parsed = selectedNotes
      .map(parseNote)
      .filter(Boolean) as ParsedNote[];

    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    // Unique by exact spelling (so C# and Db can co-exist if you ever allow)
    const uniqParsed = uniqBy(parsed, n => n.raw);

    const inputPcs = new Set<number>(uniqParsed.map(n => n.pc));
    const bassPc = uniqParsed[0].pc; // your UI has no order guarantee; but keep "first chosen" as bass

    const useFlat = preferFlat(uniqParsed);

    // Root candidates: every input note's pitch class as possible root
    const rootCandidates = [...new Set<number>(uniqParsed.map(n => n.pc))];

    const candidates: CandidateObj[] = [];

    for (const rootPc of rootCandidates) {
      for (const tpl of TEMPLATES) {
        candidates.push(buildCandidate(rootPc, tpl, inputPcs, useFlat, bassPc));
      }
    }

    // Sort by score desc
    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const top = candidates[0];
    const engineChord = top?.chord ?? "判定不能";

    const analysisLines: string[] = [];
    analysisLines.push(`入力: ${uniqParsed.map(n => n.raw).join(", ")}`);
    analysisLines.push(`最有力: ${engineChord}`);
    if (top?.reason) {
      const r = Array.isArray(top.reason) ? top.reason : [top.reason];
      analysisLines.push(...r);
    }
    if (top?.extraTones?.length) {
      analysisLines.push(`※ 追加音があるため、テンション/経過音の可能性があります。`);
    }

    // Return top N (UIで候補表示するので10くらい)
    const outCandidates = candidates.slice(0, 10);

    return NextResponse.json({
      engineChord,
      candidates: outCandidates,
      analysis: analysisLines.join("\n"),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}