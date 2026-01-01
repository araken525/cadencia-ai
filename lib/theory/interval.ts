// lib/theory/interval.ts
// ✅ 音名の「文字間隔（度数）」を主軸に音程を扱うユーティリティ
// ✅ 同音異名を潰さない（Cb は Cb）
// ✅ ただし「音程の質（長/短/完全/増/減）」確定のために、内部計算として半音差を使う
//    ※説明文章で「実音高」「ピッチクラス」を持ち出さないための前段ロジック

export type Letter = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Acc = "" | "#" | "##" | "b" | "bb";
export type Quality = "P" | "M" | "m" | "A" | "AA" | "d" | "dd"; // 必要分だけ

export type ParsedNote = {
  raw: string;   // 例: "Fb"
  letter: Letter;
  acc: Acc;
  accDelta: number; // bb=-2, b=-1, nat=0, #=+1, ##=+2
};

export type Interval = {
  number: number;     // 1..7（必要なら8以上も拡張可）
  quality: Quality;   // P/M/m/A/d etc
  semitones: number;  // 計算用
  label: string;      // 例: "P5", "d4", "A4", "m7"
};

const LETTERS: Letter[] = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_INDEX: Record<Letter, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// 自然音（ナチュラル）の半音位置（C基準）
const NAT_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// --- normalize ---
export function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

export function accToDelta(acc: string): number {
  if (acc === "") return 0;
  if (acc === "#") return 1;
  if (acc === "##") return 2;
  if (acc === "b") return -1;
  if (acc === "bb") return -2;
  return 0;
}

export function deltaToAcc(delta: number): Acc {
  if (delta === 0) return "";
  if (delta === 1) return "#";
  if (delta === 2) return "##";
  if (delta === -1) return "b";
  if (delta === -2) return "bb";
  // ここは必要なら拡張（### や bbb）
  // いったん近い範囲に丸める（極端な表記は扱わない）
  if (delta > 2) return "##";
  if (delta < -2) return "bb";
  return "";
}

export function parseNote(input: string): ParsedNote | null {
  const raw = normalizeAccidentals(input);
  // 許可: C, C#, Cb, C##, Cbb
  const m = raw.match(/^([A-Ga-g])((?:bb|b|##|#)?)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase() as Letter;
  const acc = (m[2] ?? "") as Acc;
  if (!NAT_PC[letter] && letter !== "C") {
    // 念のため
  }
  return {
    raw: `${letter}${acc}`,
    letter,
    acc,
    accDelta: accToDelta(acc),
  };
}

// --- helpers ---
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function isPerfectClass(n: number) {
  // 1,4,5 は「完全系」、2,3,6,7 は「長短系」
  const x = mod(n - 1, 7) + 1;
  return x === 1 || x === 4 || x === 5;
}

function baseDiatonicSemitones(rootLetter: Letter, targetLetter: Letter): number {
  // ルートとターゲットを「自然音だけ」で見たときの半音差（0..11）
  // 例: C→F は 5、D→A は 7 など
  return mod(NAT_PC[targetLetter] - NAT_PC[rootLetter], 12);
}

function diatonicNumber(rootLetter: Letter, targetLetter: Letter): number {
  // 文字間隔で度数を決める（C→F は4度）
  const r = LETTER_INDEX[rootLetter];
  const t = LETTER_INDEX[targetLetter];
  return mod(t - r, 7) + 1; // 1..7
}

// quality を diff から決める（diff = actual - expected）
function qualityFromDiff(num: number, diff: number): Quality {
  const perfect = isPerfectClass(num);

  if (perfect) {
    // P系: expected(=P) を 0 とする
    if (diff === 0) return "P";
    if (diff === 1) return "A";
    if (diff === 2) return "AA";
    if (diff === -1) return "d";
    if (diff === -2) return "dd";
    // それ以上は丸め
    return diff > 0 ? "AA" : "dd";
  } else {
    // M/m 系: expected(=M) を 0 とする
    if (diff === 0) return "M";
    if (diff === -1) return "m";
    if (diff === 1) return "A";
    if (diff === 2) return "AA";
    if (diff === -2) return "d";
    if (diff === -3) return "dd";
    return diff > 0 ? "AA" : "dd";
  }
}

// quality から「期待半音数」を作る（M/P を基準に差分を足す）
function desiredDiff(num: number, quality: Quality): number {
  const perfect = isPerfectClass(num);

  if (perfect) {
    // 基準: P = 0
    if (quality === "P") return 0;
    if (quality === "A") return 1;
    if (quality === "AA") return 2;
    if (quality === "d") return -1;
    if (quality === "dd") return -2;
    // M/m は来ない想定
    return 0;
  } else {
    // 基準: M = 0
    if (quality === "M") return 0;
    if (quality === "m") return -1;
    if (quality === "A") return 1;
    if (quality === "AA") return 2;
    if (quality === "d") return -2;
    if (quality === "dd") return -3;
    // P は来ない想定
    return 0;
  }
}

export function intervalBetween(rootRaw: string, targetRaw: string): Interval | null {
  const r = parseNote(rootRaw);
  const t = parseNote(targetRaw);
  if (!r || !t) return null;

  const num = diatonicNumber(r.letter, t.letter); // 文字間隔で度数を確定
  const expected = baseDiatonicSemitones(r.letter, t.letter); // 自然音だけの差
  const actual = mod(expected + (t.accDelta - r.accDelta), 12); // 表記に基づく差

  // diff は「M/P からどれだけズレたか」
  // ただし actual は mod なので、diff を -6..+6 に寄せる
  let diff = actual - expected;
  if (diff > 6) diff -= 12;
  if (diff < -6) diff += 12;

  const q = qualityFromDiff(num, diff);
  return {
    number: num,
    quality: q,
    semitones: mod(expected + diff, 12),
    label: `${q}${num}`,
  };
}

export type IntervalSpec = { number: number; quality: Quality };

// root + IntervalSpec から「狙った表記の音」を作る（例: C + d4 = Fb）
export function transpose(rootRaw: string, spec: IntervalSpec): string | null {
  const r = parseNote(rootRaw);
  if (!r) return null;

  const steps = mod(spec.number - 1, 7);
  const targetLetter = LETTERS[mod(LETTER_INDEX[r.letter] + steps, 7)];

  const expected = baseDiatonicSemitones(r.letter, targetLetter);
  const diff = desiredDiff(spec.number, spec.quality);
  const desired = mod(expected + diff, 12);

  // desired = expected + (targetAccDelta - rootAccDelta) (mod 12)
  // → targetAccDelta = desired - expected + rootAccDelta
  let targetAccDelta = desired - expected + r.accDelta;

  // -6..+6 に寄せてから、範囲に収める
  if (targetAccDelta > 6) targetAccDelta -= 12;
  if (targetAccDelta < -6) targetAccDelta += 12;

  // いったん -2..+2 へ（必要なら拡張）
  if (targetAccDelta > 2) targetAccDelta = 2;
  if (targetAccDelta < -2) targetAccDelta = -2;

  const acc = deltaToAcc(targetAccDelta);
  return `${targetLetter}${acc}`;
}

export function uniqBy<T>(arr: T[], keyFn: (x: T) => string): T[] {
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