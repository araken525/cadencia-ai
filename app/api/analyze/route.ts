export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeAccidentals,
  parseNote,
  intervalBetween,
  transpose,
  uniqBy,
  type ParsedNote,
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
  name: string;
  intervals: IntervalSpec[]; // root 以外
  tags?: string[];
};

const TEMPLATES: Template[] = [
  // triads
  { name: "",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }], tags: ["triad", "major"] },
  { name: "m",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }], tags: ["triad", "minor"] },
  { name: "dim", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }], tags: ["triad", "diminished"] },
  { name: "aug", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }], tags: ["triad", "augmented"] },

  // sus
  { name: "sus2", intervals: [{ number: 2, quality: "M" }, { number: 5, quality: "P" }], tags: ["triad", "sus2"] },
  { name: "sus4", intervals: [{ number: 4, quality: "P" }, { number: 5, quality: "P" }], tags: ["triad", "sus4"] },

  // sevenths
  { name: "7",     intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "maj7",  intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh"] },
  { name: "m7",    intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "mMaj7", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh"] },
  { name: "m7b5",  intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }], tags: ["seventh"] },
  { name: "dim7",  intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }], tags: ["seventh"] },

  // sixths (optional)
  { name: "6",  intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
  { name: "m6", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
];

function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ---- 表記ソート（押した順を完全排除）----
type Acc = "" | "#" | "##" | "b" | "bb";
const LETTER_INDEX: Record<string, number> = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
const ACC_INDEX: Record<Acc, number> = { "bb":0, "b":1, "":2, "#":3, "##":4 };

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

// engineChord の「根音表記」を抜く（例: "Cb7/Fb" -> "Cb"）
function extractRootFromChordName(chord: string): string | null {
  const s = (chord ?? "").trim();
  const m = s.match(/^([A-G])((?:bb|b|##|#)?)/);
  if (!m) return null;
  return `${m[1]}${m[2] ?? ""}`.trim();
}

function chordTonesFrom(rootRaw: string, tpl: Template): string[] {
  const tones: string[] = [rootRaw];
  for (const spec of tpl.intervals) {
    const t = transpose(rootRaw, spec);
    if (t) tones.push(t);
  }
  return tones;
}

function scoreBySpelling(inputSet: Set<string>, chordTones: string[], tpl: Template) {
  let common = 0;
  for (const t of chordTones) if (inputSet.has(t)) common += 1;

  const missing = chordTones.filter(t => !inputSet.has(t)).length;
  const extra = [...inputSet].filter(n => !chordTones.includes(n)).length;

  // 表記一致を最優先
  let score = common * 40 - missing * 80 - extra * 12;

  // sus を取りやすくする：3度が無いことを弱くボーナス
  if (tpl.name === "sus4" || tpl.name === "sus2") {
    // 3度（M3 or m3）が入力に含まれないなら少し加点
    const maj3 = transpose(chordTones[0], { number: 3, quality: "M" });
    const min3 = transpose(chordTones[0], { number: 3, quality: "m" });
    const has3 = (maj3 && inputSet.has(maj3)) || (min3 && inputSet.has(min3));
    if (!has3) score += 15;
  }

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

// AI考察（再判定しない／表記優先）
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
      "",
      "OPENAI_API_KEY を設定すると、ここに考察が出ます。",
    ].join("\n");
  }

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
【入力（表記そのまま／押下順ではなく正規順）】
選択音: ${params.selectedRaw.join(", ")}
ベース（正規順の先頭）: ${params.bassRaw}

【engineChord（この表記を絶対に変えない）】
${params.engineChord}

【参考：根音（engineChordから抽出）→各音の音程ラベル（文字間隔）】
${intervalMap.join("\n")}

【候補上位（参考。あなたは再判定しない）】
${safeJson(top)}

【出力フォーマット（この順）】
1) ひとことで（1行）
2) 入力表記のまま構成音を確認
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

    const parsed = normalizedRaw
      .map(parseNote)
      .filter((n): n is ParsedNote => n !== null);

    if (parsed.length < 3) {
      return NextResponse.json(
        {
          engineChord: "判定不能",
          candidates: [],
          analysis: "音が3つ以上必要です（情報不足）",
          status: "insufficient",
        },
        { status: 200 }
      );
    }

    // 表記単位でユニーク化 → さらに表記で正規ソート（押下順を排除）
    const uniqParsed = uniqBy(parsed, (n) => n.raw);
    const selectedRaw = uniqParsed.map(n => n.raw).sort(sortSpelling);

    // bass も押下順を使わない（正規順の先頭に固定）
    const bassRaw = selectedRaw[0];

    const inputSet = new Set<string>(selectedRaw);

    // root候補も押下順ではなく正規順
    const rootCandidates = [...selectedRaw];

    const candidates: CandidateObj[] = [];
    for (const rootRaw of rootCandidates) {
      for (const tpl of TEMPLATES) {
        candidates.push(buildCandidate({ rootRaw, tpl, inputSet, bassRaw }));
      }
    }

    // 同点タイブレークを固定（押下順が混ざらないように）
    candidates.sort((a, b) => {
      const ds = (b.score ?? 0) - (a.score ?? 0);
      if (ds !== 0) return ds;
      return (a.chord ?? "").localeCompare(b.chord ?? "");
    });

    const outCandidates = candidates.slice(0, 10);
    const top = outCandidates[0];

    // ここが「居場所がない時」= 判定が成立しない時の表示
    if (!top || (top.score ?? -999999) < 0) {
      return NextResponse.json(
        {
          engineChord: "判定不能",
          candidates: outCandidates,
          analysis: "この入力だと、テンプレに十分一致する候補がありません（情報不足）",
          status: "no_match",
        },
        { status: 200 }
      );
    }

    const engineChord = top.chord;

    let analysisText = "";
    try {
      analysisText = await buildAiAnalysis({
        selectedRaw,
        engineChord,
        candidates: outCandidates,
        bassRaw,
      });
    } catch {
      analysisText = [
        "（AI考察の生成に失敗。簡易ログ）",
        `入力: ${selectedRaw.join(", ")}`,
        `判定: ${engineChord}`,
        ...(top.reason ? (Array.isArray(top.reason) ? top.reason : [top.reason]) : []),
      ].join("\n");
    }

    return NextResponse.json({
      engineChord,
      candidates: outCandidates,
      analysis: analysisText,
      status: "ok",
      // デバッグ用：押下順を使ってないことを明示
      orderPolicy: "spelling-sorted",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}