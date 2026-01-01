// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeAccidentals,
  parseNote,
  uniqBy,
  intervalBetween,
  transpose,
  type IntervalSpec,
} from "@/lib/theory/interval";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

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

// -------------------- Templates (文字間隔ベース) --------------------
// 例: メジャートライアド = M3 + P5
//     ドミナント7 = M3 + P5 + m7
type Template = {
  name: string;         // 付加するサフィックス（"", "m", "7" ...）
  tones: IntervalSpec[]; // root から見た構成音（root 自身は含めない）
  tags?: string[];
};

const TEMPLATES: Template[] = [
  { name: "",      tones: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }], tags: ["triad","major"] },
  { name: "m",     tones: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }], tags: ["triad","minor"] },
  { name: "dim",   tones: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }], tags: ["triad","diminished"] },
  { name: "aug",   tones: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }], tags: ["triad","augmented"] },

  { name: "7",     tones: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh","dominant7"] },
  { name: "maj7",  tones: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh","major7"] },
  { name: "m7",    tones: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], tags: ["seventh","minor7"] },
  { name: "mMaj7", tones: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], tags: ["seventh","minorMajor7"] },
  { name: "dim7",  tones: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "d" }], tags: ["seventh","diminished7"] },
  { name: "m7b5",  tones: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }, { number: 7, quality: "m" }], tags: ["seventh","halfDiminished"] },

  { name: "6",     tones: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
  { name: "m6",    tones: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 6, quality: "M" }], tags: ["sixth"] },
];

function token(spec: IntervalSpec) {
  return `${spec.quality}${spec.number}`;
}

function scoreByTokens(inputTokens: Set<string>, tplTokens: Set<string>) {
  // 「一致」を強く評価、欠損も強く減点、余剰は軽く減点
  let common = 0;
  for (const t of tplTokens) if (inputTokens.has(t)) common += 1;

  let missing = 0;
  for (const t of tplTokens) if (!inputTokens.has(t)) missing += 1;

  let extra = 0;
  for (const t of inputTokens) if (!tplTokens.has(t)) extra += 1;

  return common * 50 - missing * 60 - extra * 15;
}

function buildCandidate(params: {
  rootRaw: string;
  bassRaw: string;
  inputRaw: string[];
  tpl: Template;
}): CandidateObj {
  const { rootRaw, bassRaw, inputRaw, tpl } = params;

  // 入力音を「root からの音程トークン」に変換（root自身は 1P として扱ってもよいが、テンプレは root を含めない）
  const tokens: string[] = [];
  const tokenToNote: Record<string, string[]> = {};

  for (const n of inputRaw) {
    if (n === rootRaw) continue;
    const iv = intervalBetween(rootRaw, n);
    if (!iv) continue;
    const tk = iv.label; // 例: "m7"
    tokens.push(tk);
    tokenToNote[tk] = tokenToNote[tk] ? [...tokenToNote[tk], n] : [n];
  }

  const inputTokens = new Set(tokens);
  const tplTokens = new Set(tpl.tones.map(token));
  const score = scoreByTokens(inputTokens, tplTokens);

  // chord tones（テンプレ通りの“表記”で生成）
  const chordTones = [rootRaw, ...tpl.tones.map((s) => transpose(rootRaw, s)).filter(Boolean) as string[]];

  // extra tones（テンプレ外の入力音）
  const expectedNotes = new Set(chordTones);
  const extraTones = inputRaw.filter(n => !expectedNotes.has(n));

  const base = bassRaw;
  const chord = `${rootRaw}${tpl.name}${bassRaw !== rootRaw ? `/${bassRaw}` : ""}`;

  const reasonLines: string[] = [];
  reasonLines.push(`Root(表記): ${rootRaw}`);
  reasonLines.push(`テンプレ: ${tpl.name || "(maj)"}`);
  reasonLines.push(`一致トークン: ${[...tplTokens].filter(t => inputTokens.has(t)).join(", ") || "なし"}`);
  if (extraTones.length) reasonLines.push(`余剰音: ${extraTones.join(", ")}`);

  return {
    chord,
    base,
    root: rootRaw,
    score,
    has7: tpl.tones.some(t => t.number === 7),
    tensions: extraTones.map(t => `add(${t})`),
    chordTones,
    extraTones,
    reason: reasonLines,
  };
}

// -------------------- AI analysis (文章だけ) --------------------
function safeJson(v: any) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

async function buildAiAnalysis(args: {
  selectedRaw: string[];
  engineChord: string;
  candidates: CandidateObj[];
}) {
  if (!process.env.OPENAI_API_KEY) {
    return [
      "（AI未接続）",
      `入力: ${args.selectedRaw.join(", ")}`,
      `判定: ${args.engineChord}`,
      "",
      "OPENAI_API_KEY を設定すると、ここにAIの考察が表示されます。",
    ].join("\n");
  }

  const SYSTEM = `
あなたは古典和声（機能和声）を専門とする音楽理論家です。
音程・度数は必ず「音名の文字間隔（C–D–E–F–G–A–B）」で扱い、
半音数・実音高・ピッチクラスを基準に説明してはいけません。
あなたの役割は【説明だけ】です。コード名の判定は行いません。
入力された音名表記を最優先し、存在しない前提や一般論を勝手に作らない。

【最重要ルール（嘘防止）】
- engineChord の表記を変更しない（言い換え・再判定しない）。
- 異名同音は同一視しない（Cb を B と断言しない）。
- 調性は断定しない（可能性は2〜3個まで）。
- 不明は「情報不足」と言い切る（推測で埋めない）。
`.trim();

  const top = args.candidates.slice(0, 5).map(c => ({
    chord: c.chord,
    chordTones: c.chordTones,
    extraTones: c.extraTones,
    reason: c.reason,
    score: c.score,
  }));

  const USER = `
【入力（表記そのまま）】
${args.selectedRaw.join(", ")}

【engineChord（変更禁止）】
${args.engineChord}

【候補上位（参考。説明にだけ使う）】
${safeJson(top)}

【出力フォーマット（この順）】
A. ひとことで（1〜2行）
B. 主解釈（engineChord / 機能 / 調性仮説つきローマ数字）
C. 準解釈（同上）
D. 別解釈（同上、無ければ省略）
E. 非和声音の見立て（どの音がどの種類っぽいか）
F. 次に分かること（前後が分かると何が確定するか）
`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || "（AIの応答が空でした）";
}

// -------------------- Main --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalized = selectedNotes.map(normalizeAccidentals).filter(Boolean);
    const parsed = normalized.map(parseNote).filter(Boolean);

    if (parsed.length < 3) {
      return NextResponse.json(
        { engineChord: "判定不能", candidates: [], analysis: "音が3つ以上必要です" },
        { status: 200 }
      );
    }

    // ✅ 表記単位で重複排除（Cb は Cb のまま）
    const uniq = uniqBy(parsed, (n) => n!.raw).map(n => n!.raw);

    // UI仕様: 最初に選ばれた音をベース扱い（あなたの選択順を守る）
    const bassRaw = uniq[0];

    // Root候補: 入力の「表記」すべて（Cb も root候補になり得る）
    const roots = [...uniq];

    const candidates: CandidateObj[] = [];
    for (const rootRaw of roots) {
      for (const tpl of TEMPLATES) {
        candidates.push(buildCandidate({ rootRaw, bassRaw, inputRaw: uniq, tpl }));
      }
    }

    candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const outCandidates = candidates.slice(0, 10);
    const engineChord = outCandidates[0]?.chord ?? "判定不能";

    // ✅ AIは「考察文」だけ生成（判定には関与しない）
    let analysis = "";
    try {
      analysis = await buildAiAnalysis({ selectedRaw: uniq, engineChord, candidates: outCandidates });
    } catch {
      analysis = [
        "（AI考察の生成に失敗）",
        `入力: ${uniq.join(", ")}`,
        `最有力: ${engineChord}`,
      ].join("\n");
    }

    return NextResponse.json({
      engineChord,
      candidates: outCandidates,
      analysis,
    });

  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}