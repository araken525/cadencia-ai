export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeAccidentals,
  parseNote,
  intervalBetween,
  uniqBy,
  type IntervalSpec,
} from "@/lib/theory/interval";

// -------------------- OpenAI (optional) --------------------
const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
  name: string;                 // "", "m", "7", ...
  intervals: IntervalSpec[];    // 文字間隔ベース
  tags?: string[];
};

const TEMPLATES: Template[] = [
  // triads
  { name: "",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }], tags: ["triad", "major"] },
  { name: "m",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }], tags: ["triad", "minor"] },
  { name: "dim", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }], tags: ["triad", "diminished"] },
  { name: "aug", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }], tags: ["triad", "augmented"] },

  // sevenths
  { name: "7",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "maj7", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh"] },
  { name: "m7",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "mMaj7",intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh"] },
  { name: "m7b5", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "dim7", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }], tags: ["seventh"] },

  // sixths (optional)
  { name: "6",   intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
  { name: "m6",  intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
];

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// engineChord の「根音表記」を抜く（例: "Cb7/Fb" -> "Cb"）
function extractRootFromChordName(chord: string): string | null {
  const s = (chord ?? "").trim();
  const m = s.match(/^([A-G])((?:bb|b|##|#)?)/);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ""}`.trim();
}

// root + template intervals から chord tones（表記）を生成（文字間隔主軸）
function chordTonesFrom(rootRaw: string, tpl: Template): string[] {
  const tones: string[] = [rootRaw];
  for (const spec of tpl.intervals) {
    // interval.ts の transpose を使いたいが、export してない場合もあるので
    // ここでは intervalBetween を逆算するより、transpose を export 推奨。
    // もし transpose が export 済みなら差し替えてください。
    // ↓暫定: interval.ts に transpose がある前提で dynamic import
  }
  return tones;
}

// transpose が export されている前提で、ここで読む
async function chordTonesFromWithTranspose(rootRaw: string, tpl: Template): Promise<string[]> {
  const mod = await import("@/lib/theory/interval");
  const transpose: (rootRaw: string, spec: IntervalSpec) => string | null = mod.transpose;

  const tones: string[] = [rootRaw];
  for (const spec of tpl.intervals) {
    const t = transpose(rootRaw, spec);
    if (t) tones.push(t);
  }
  return tones;
}

function scoreBySpelling(inputSet: Set<string>, chordTones: string[]) {
  let common = 0;
  for (const t of chordTones) if (inputSet.has(t)) common += 1;

  const missing = chordTones.filter(t => !inputSet.has(t)).length;
  const extra = [...inputSet].filter(n => !chordTones.includes(n)).length;

  // 厳密表記一致を強く優遇（ここが “文字の感覚” を守る中核）
  return common * 35 - missing * 60 - extra * 12;
}

async function buildCandidate(params: {
  rootRaw: string;
  tpl: Template;
  inputSet: Set<string>;
  bassRaw: string;
}): Promise<CandidateObj> {
  const chordTones = await chordTonesFromWithTranspose(params.rootRaw, params.tpl);

  const extraTones = [...params.inputSet].filter(n => !chordTones.includes(n));
  const tensions = extraTones.map(t => `add(${t})`);

  const score = scoreBySpelling(params.inputSet, chordTones);
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

// AIの「考察文章」生成（判定はしない／表記優先）
async function buildAiAnalysis(params: {
  selectedRaw: string[];
  engineChord: string;
  candidates: CandidateObj[];
  bassRaw: string;
}) {
  // OpenAIなしでも動作
  if (!openai) {
    return [
      "（AI未接続）",
      `入力: ${params.selectedRaw.join(", ")}`,
      `判定: ${params.engineChord}`,
      "",
      "OPENAI_API_KEY を設定すると、ここに考察が出ます。",
    ].join("\n");
  }

  // engineChord の根音を“表記”で抜いて、各音との音程ラベルを作る（文字間隔主軸）
  const root = extractRootFromChordName(params.engineChord);
  const intervalMap =
    root
      ? params.selectedRaw.map(n => {
          const itv = intervalBetween(root, n);
          return `${root}→${n}: ${itv ? itv.label : "（算出不可）"}`;
        })
      : ["（engineChordから根音表記を取得できませんでした）"];

  const top = params.candidates.slice(0, 5).map(c => ({
    chord: c.chord,
    score: c.score,
    chordTones: c.chordTones,
    extraTones: c.extraTones,
    base: c.base,
    root: c.root,
  }));

  const SYSTEM = `
あなたは古典和声（機能和声）を専門とする音楽理論家です。
音程・度数は必ず「音名の文字間隔（C–D–E–F–G–A–B）」で扱い、
半音数・実音高・ピッチクラスを基準に説明してはいけません。
あなたの役割は【説明だけ】です。コード名の判定は行いません。

【最重要ルール（嘘防止）】
- engineChord の表記を変更しない（言い換え・再判定しない）。
- 入力された音名表記を最優先する（CbはCb、FbはFb）。
- 「一般論」や「別の可能性」を勝手に新規追加しない（必要なら“情報不足”と言う）。
- 調性（キー）は断定しない。可能性を2〜3個まで。
- 異名同音は同一視しない（ただし誤解ポイントとして触れるのは可）。
- 前後が無い前提なので断言を避け、仮説として述べる。
- 出力はユーザー向けの自然な文章のみ（JSONは出さない）。
`.trim();

  const USER = `
【入力（表記そのまま）】
選択音: ${params.selectedRaw.join(", ")}
ベース（選択順の先頭）: ${params.bassRaw}

【engineChord（この表記を絶対に変えない）】
${params.engineChord}

【参考：根音（engineChordから抽出）→各音の音程ラベル（文字間隔）】
${intervalMap.join("\n")}

【候補上位（参考。あなたは再判定しない）】
${safeJson(top)}

【出力フォーマット（この順）】
1) ひとことで（1行）
2) 入力表記のまま構成音を確認（足りない度数/重複もそのまま）
3) 機能の仮説（断言しない）
4) 調性仮説（2〜3個まで）
5) 誤解ポイント（表記が意味を持つ点に限定）
6) 次に分かると強い情報（前後/旋律）
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.15,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "（AIの応答が空でした）";
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalizedRaw = selectedNotes.map(normalizeAccidentals).filter(Boolean);

    const parsed = normalizedRaw.map(parseNote).filter(Boolean);
    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    // spelling（表記）でユニーク化（CbはCbのまま）
    const uniqParsed = uniqBy(parsed, (n) => n.raw);
    const selectedRaw = uniqParsed.map(n => n.raw);

    // ベース：UIの「選択順先頭」をできるだけ尊重（uniq前の先頭）
    const bassRaw = parseNote(normalizedRaw[0])?.raw ?? selectedRaw[0];

    const inputSet = new Set<string>(selectedRaw);

    // root候補：入力された表記をそのまま root 候補にする（pc起点にしない）
    const rootCandidates = selectedRaw;

    const candidates: CandidateObj[] = [];
    for (const rootRaw of rootCandidates) {
      for (const tpl of TEMPLATES) {
        candidates.push(await buildCandidate({ rootRaw, tpl, inputSet, bassRaw }));
      }
    }

    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const outCandidates = candidates.slice(0, 10);

    const top = outCandidates[0];
    const engineChord = top?.chord ?? "判定不能";

    // AI考察（失敗してもfallback）
    let analysisText = "";
    try {
      analysisText = await buildAiAnalysis({
        selectedRaw,
        engineChord,
        candidates: outCandidates,
        bassRaw,
      });
    } catch (e: any) {
      analysisText = [
        "（AI考察の生成に失敗。簡易ログ）",
        `入力: ${selectedRaw.join(", ")}`,
        `判定: ${engineChord}`,
        ...(top?.reason ? (Array.isArray(top.reason) ? top.reason : [top.reason]) : []),
      ].join("\n");
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