export const runtime = "nodejs";

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type ReqBody = {
  selectedNotes?: string[]; // 例: ["C","E","G","A#"] ※表記のまま
};

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

type ResBody = {
  engineChord: string;
  candidates: CandidateObj[]; // UIで別解釈に使える
  reason?: string;           // デバッグ用（従来）
  analysis?: string;         // ✅ AI文章
};

/** ========= 音名パース（表記を保持） ========= */
type ParsedNote = {
  raw: string;
  letter: "A" | "B" | "C" | "D" | "E" | "F" | "G";
  acc: number; // #=+1, b=-1
  pc: number;  // pitch class 0..11
};

const LETTER_TO_PC: Record<ParsedNote["letter"], number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

function parseNote(raw: string): ParsedNote | null {
  const s = (raw ?? "").trim();
  const m = s.match(/^([A-Ga-g])([#b]{0,2})$/);
  if (!m) return null;

  const letter = m[1].toUpperCase() as ParsedNote["letter"];
  const accStr = m[2] ?? "";
  let acc = 0;
  for (const ch of accStr) acc += ch === "#" ? 1 : -1;

  const base = LETTER_TO_PC[letter];
  const pc = (base + acc + 1200) % 12;

  return { raw: s, letter, acc, pc };
}

/** ========= “音名間隔（文字）優先” の度数・質 ========= */
type IntervalQuality = "P" | "M" | "m" | "A" | "d";

type SpelledInterval = {
  number: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  quality: IntervalQuality;
  semitones: number; // 0..11
  label: string; // 例: "m7" / "A6" / "P5"
};

const MAJOR_SCALE_SEMITONES: Record<number, number> = {
  1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11,
};

const LETTER_INDEX: Record<ParsedNote["letter"], number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function spelledInterval(root: ParsedNote, note: ParsedNote): SpelledInterval {
  const diatonic = mod(LETTER_INDEX[note.letter] - LETTER_INDEX[root.letter], 7);
  const number = (diatonic + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;

  const semitones = mod(note.pc - root.pc, 12);

  const base = MAJOR_SCALE_SEMITONES[number];
  const diff = mod(semitones - base, 12);
  const signed = diff <= 6 ? diff : diff - 12; // 例: 11 -> -1

  const isPerfectClass = number === 1 || number === 4 || number === 5;
  let quality: IntervalQuality = "P";

  if (isPerfectClass) {
    if (signed === 0) quality = "P";
    else if (signed === 1) quality = "A";
    else if (signed === -1) quality = "d";
    else if (signed >= 2) quality = "A";
    else quality = "d";
  } else {
    if (signed === 0) quality = "M";
    else if (signed === -1) quality = "m";
    else if (signed === 1) quality = "A";
    else if (signed === -2) quality = "d";
    else if (signed >= 2) quality = "A";
    else quality = "d";
  }

  const label = `${quality}${number}`;
  return { number, quality, semitones, label };
}

/** ========= テンション（9/11/13）表記 ========= */
function tensionToken(iv: SpelledInterval): string | null {
  if (iv.number === 2) {
    if (iv.quality === "M") return "9";
    if (iv.quality === "m") return "b9";
    if (iv.quality === "A") return "#9";
    if (iv.quality === "d") return "bb9";
  }
  if (iv.number === 4) {
    if (iv.quality === "P") return "11";
    if (iv.quality === "A") return "#11";
    if (iv.quality === "d") return "b11";
  }
  if (iv.number === 6) {
    if (iv.quality === "M") return "13";
    if (iv.quality === "m") return "b13";
    if (iv.quality === "A") return "#13";
    if (iv.quality === "d") return "bb13";
  }
  return null;
}

/** triad: add9... / 7th: 7(9,#11,13) */
function addTensionsToSymbol(baseSymbol: string, has7: boolean, ivs: SpelledInterval[]): { symbol: string; tensions: string[] } {
  const tokens = ivs.map(tensionToken).filter(Boolean) as string[];
  const uniq = Array.from(new Set(tokens));

  const order = (t: string) => {
    const n = t.replace(/^[b#]+/, "");
    const base = parseInt(n, 10);
    const sharpness = t.startsWith("bb") ? -2 : t.startsWith("b") ? -1 : t.startsWith("#") ? 1 : 0;
    return base * 10 + (sharpness + 1);
  };
  uniq.sort((a, b) => order(a) - order(b));

  if (uniq.length === 0) return { symbol: baseSymbol, tensions: [] };

  if (!has7) {
    return { symbol: baseSymbol + uniq.map((t) => `add${t}`).join(""), tensions: uniq };
  }
  return { symbol: `${baseSymbol}(${uniq.join(",")})`, tensions: uniq };
}

/** ========= コードテンプレ（骨格） ========= */
type Template = {
  suffix: string;
  required: Array<{ number: SpelledInterval["number"]; quality: IntervalQuality }>;
  has7: boolean;
};

const TEMPLATES: Template[] = [
  { suffix: "",    has7: false, required: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }] },
  { suffix: "m",   has7: false, required: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }] },
  { suffix: "dim", has7: false, required: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }] },
  { suffix: "aug", has7: false, required: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }] },
  { suffix: "sus4",has7: false, required: [{ number: 4, quality: "P" }, { number: 5, quality: "P" }] },
  { suffix: "sus2",has7: false, required: [{ number: 2, quality: "M" }, { number: 5, quality: "P" }] },

  { suffix: "7",    has7: true, required: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }] },
  { suffix: "maj7", has7: true, required: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }] },
  { suffix: "m7",   has7: true, required: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }] },
  { suffix: "m7b5", has7: true, required: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }] },
  { suffix: "dim7", has7: true, required: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }] },
];

type Match = {
  chord: string;
  base: string;
  score: number;
  root: string;
  has7: boolean;
  tensions: string[];
  chordTones: string[];
  extraTones: string[];
  reason: string[];
};

function buildChordSymbol(rootRaw: string, suffix: string) {
  return `${rootRaw}${suffix}`;
}

function matchTemplates(root: ParsedNote, notes: ParsedNote[]): Match[] {
  const ivs = notes
    .filter((n) => n.raw !== root.raw)
    .map((n) => spelledInterval(root, n));

  const byNumber = new Map<number, IntervalQuality[]>();
  for (const iv of ivs) {
    const arr = byNumber.get(iv.number) ?? [];
    arr.push(iv.quality);
    byNumber.set(iv.number, arr);
  }

  const matches: Match[] = [];

  for (const tpl of TEMPLATES) {
    // 必須条件
    const missing: string[] = [];
    for (const req of tpl.required) {
      const qs = byNumber.get(req.number) ?? [];
      if (!qs.includes(req.quality)) missing.push(`${req.quality}${req.number}`);
    }
    if (missing.length > 0) continue;

    // 余分音（テンション 2/4/6 は減点しない）
    const requiredCount = tpl.required.length;
    const extraNonTension = ivs.filter((iv) => {
      const isRequired = tpl.required.some((r) => r.number === iv.number && r.quality === iv.quality);
      const isTension = iv.number === 2 || iv.number === 4 || iv.number === 6;
      return !isRequired && !isTension;
    }).length;

    const score = requiredCount * 10 - extraNonTension * 2;

    const base = buildChordSymbol(root.raw, tpl.suffix);
    const t = addTensionsToSymbol(base, tpl.has7, ivs);

    // chordTones / extraTones をそれっぽく作る（UI用）
    const chordTones: string[] = [];
    const extraTones: string[] = [];
    const requiredKeys = new Set(tpl.required.map((r) => `${r.quality}${r.number}`));
    for (const iv of ivs) {
      const key = `${iv.quality}${iv.number}`;
      const rawNote = notes.find((nn) => nn.pc === mod(root.pc + iv.semitones, 12) && nn.letter === notes.find(x=>x.raw===nn.raw)?.letter)?.raw;
      // rawNote を厳密には取りにくいので、notes側のrawを使う：rootとの比較で並べる
      // ここは「表示用」なので、厳密な音名対応は selected から引く
    }

    // 表記保持のため：入力順から拾う
    const selectedRaw = notes.map((n) => n.raw);
    // chord tones = root + テンプレ必須に該当する音（入力の中から）
    const chordToneSet = new Set<string>([root.raw]);
    for (const n of notes) {
      if (n.raw === root.raw) continue;
      const iv = spelledInterval(root, n);
      if (requiredKeys.has(`${iv.quality}${iv.number}`)) chordToneSet.add(n.raw);
    }
    for (const n of selectedRaw) (chordToneSet.has(n) ? chordTones : extraTones).push(n);

    const reason: string[] = [];
    reason.push(`root=${root.raw}`);
    reason.push(`base=${base}`);
    if (t.symbol !== base) reason.push(`tensions=${t.tensions.join(",")}`);
    if (extraNonTension > 0) reason.push(`extraNonTension=${extraNonTension}`);

    matches.push({
      chord: t.symbol,
      base,
      score,
      root: root.raw,
      has7: tpl.has7,
      tensions: t.tensions,
      chordTones,
      extraTones,
      reason,
    });
  }

  return matches;
}

/** ========= AI 解説（安全に：和音名は確定済み） ========= */
async function buildAiAnalysis(args: {
  selectedNotes: string[];
  engineChord: string;
  topCandidates: CandidateObj[];
  debugReason?: string;
}) {
  const { selectedNotes, engineChord, topCandidates, debugReason } = args;

  const SYSTEM = `
You are a classical harmony tutor. Output MUST be Japanese.
Never rename chords. Never invent a new chord label.
Treat enharmonic equivalents as DIFFERENT spellings (A# ≠ Bb). Do not unify.
Explain using: 調性/機能/転回/導音/非和声音/変位/経過音/掛留/倚音 など、古典和声寄りの語彙を優先。
Keep it friendly, short, and concrete.
Structure:
- まず結論（1行）
- 根音仮定と骨格（3度/5度/7度）
- もし9/11/13等があれば「上声部の付加（非和声音の可能性も含む）」として触れる
- 「別解釈」1つだけ紹介（候補から）
`;

  const USER = `
選択音（表記そのまま）:
${selectedNotes.join(", ")}

確定したコード表示（エンジン確定）:
${engineChord}

候補（上位）:
${topCandidates.map((c) => `- ${c.chord}${c.root ? ` (root=${c.root})` : ""}${typeof c.score === "number" ? ` score=${c.score}` : ""}`).join("\n")}

デバッグ理由（あれば）:
${debugReason ?? ""}
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.3,
    messages: [
      { role: "system", content: SYSTEM.trim() },
      { role: "user", content: USER.trim() },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReqBody;
    const selectedRaw = (body.selectedNotes ?? []).map((s) => (s ?? "").trim()).filter(Boolean);

    const uniq = Array.from(new Set(selectedRaw));
    const parsed = uniq.map(parseNote).filter(Boolean) as ParsedNote[];

    if (parsed.length < 3) {
      const res: ResBody = {
        engineChord: "---",
        candidates: [],
        reason: "3音以上選んでください",
        analysis: "",
      };
      return Response.json(res, { status: 200 });
    }

    // ロジック判定（AIは関与しない）
    const all: Match[] = [];
    for (const root of parsed) all.push(...matchTemplates(root, parsed));
    all.sort((a, b) => b.score - a.score);

    if (all.length === 0) {
      const res: ResBody = {
        engineChord: "（該当なし）",
        candidates: [],
        reason: "異名同音を同一視しない条件で、三和音/7th骨格に一致する候補がありません。",
        analysis: "一致する骨格が見つかりませんでした。転回/省略/非和声音を疑うとヒントが増えます。",
      };
      return Response.json(res, { status: 200 });
    }

    const top5 = all.slice(0, 5);

    const candidatesObj: CandidateObj[] = top5.map((m) => ({
      chord: m.chord,
      base: m.base,
      score: m.score,
      root: m.root,
      has7: m.has7,
      tensions: m.tensions,
      chordTones: m.chordTones,
      extraTones: m.extraTones,
      reason: m.reason,
    }));

    const engineChord = top5[0].chord;
    const reason = top5[0].reason.join(" | ");

    // ✅ 解説だけAI生成
    const analysis = await buildAiAnalysis({
      selectedNotes: uniq,
      engineChord,
      topCandidates: candidatesObj,
      debugReason: reason,
    });

    const res: ResBody = {
      engineChord,
      candidates: candidatesObj,
      reason,   // デバッグ用
      analysis, // UIの「判定メモ」に出る
    };

    return Response.json(res, { status: 200 });
  } catch (e: any) {
    return Response.json(
      {
        engineChord: "判定失敗",
        candidates: [],
        reason: e?.message ?? String(e),
        analysis: "",
      },
      { status: 500 }
    );
  }
}