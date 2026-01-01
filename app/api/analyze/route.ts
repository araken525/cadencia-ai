export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  normalizeAccidentals,
  parseNote,
  uniqBy,
  transpose,
  intervalBetween,
  type IntervalSpec,
} from "@/lib/theory/interval";

// ==================== OpenAI（任意） ====================
const openai =
  process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

// ==================== Types ====================
type CandidateObj = {
  chord: string;
  score: number;
  chordTones: string[];
  extraTones: string[];
  reason: string[];
};

type Template = {
  name: string;
  intervals: IntervalSpec[];
  requiresThird: boolean; // ← 重要：3度必須か
};

// ==================== Templates ====================
const TEMPLATES: Template[] = [
  { name: "",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }], requiresThird: true },
  { name: "m",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }], requiresThird: true },
  { name: "dim", intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "d" }], requiresThird: true },
  { name: "aug", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "A" }], requiresThird: true },

  { name: "7",    intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], requiresThird: true },
  { name: "maj7", intervals: [{ number: 3, quality: "M" }, { number: 5, quality: "P" }, { number: 7, quality: "M" }], requiresThird: true },
  { name: "m7",   intervals: [{ number: 3, quality: "m" }, { number: 5, quality: "P" }, { number: 7, quality: "m" }], requiresThird: true },
];

// ==================== Utils ====================
function scoreBySpelling(input: Set<string>, tones: string[]) {
  let common = 0;
  for (const t of tones) if (input.has(t)) common++;

  const missing = tones.filter(t => !input.has(t)).length;
  const extra = [...input].filter(n => !tones.includes(n)).length;

  return common * 40 - missing * 80 - extra * 15;
}

// ==================== Candidate Builder ====================
async function buildCandidate(
  root: string,
  tpl: Template,
  inputSet: Set<string>
): Promise<CandidateObj | null> {

  const chordTones = [root, ...tpl.intervals.map(i => transpose(root, i)!).filter(Boolean)];

  // 3度が必須なのに存在しない → 不成立
  if (tpl.requiresThird) {
    const hasThird = chordTones.some(t => {
      const itv = intervalBetween(root, t);
      return itv?.number === 3;
    });
    if (!hasThird) return null;
  }

  const extraTones = [...inputSet].filter(n => !chordTones.includes(n));
  const score = scoreBySpelling(inputSet, chordTones);

  return {
    chord: `${root}${tpl.name}`,
    score,
    chordTones,
    extraTones,
    reason: [
      `Root表記: ${root}`,
      `構成音(表記): ${chordTones.join(", ")}`,
      extraTones.length ? `余剰音: ${extraTones.join(", ")}` : "余剰音なし",
    ],
  };
}

// ==================== AI考察 ====================
async function buildAiAnalysis(
  selectedRaw: string[],
  engineChord: string,
  candidates: CandidateObj[]
) {
  if (!openai) {
    return [
      "（AI未接続）",
      `入力音: ${selectedRaw.join(", ")}`,
      `判定: ${engineChord}`,
    ].join("\n");
  }

  const root = engineChord !== "特定不可"
    ? engineChord.match(/^([A-G](?:bb|b|##|#)?)/)?.[1] ?? null
    : null;

  const intervalMap = root
    ? selectedRaw.map(n => `${root}→${n}: ${intervalBetween(root, n)?.label ?? "不明"}`).join("\n")
    : "根音を特定できないため算出不可";

  const SYSTEM = `
あなたは古典和声（機能和声）の専門家です。
音程は必ず「音名の文字間隔」で説明してください。
半音数・実音高・ピッチクラスは禁止です。
コードの再判定は禁止。説明のみ行ってください。
`.trim();

  const USER = `
【入力音（表記そのまま）】
${selectedRaw.join(", ")}

【判定結果】
${engineChord}

【音程関係】
${intervalMap}

【注意】
3度が存在しない場合は「居場所が定まらない」と明確に述べてください。
`.trim();

  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: USER },
    ],
  });

  return res.choices[0]?.message?.content ?? "";
}

// ==================== Route ====================
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawNotes = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    const normalized = rawNotes.map(normalizeAccidentals);
    const parsed = normalized.map(parseNote).filter((n): n is NonNullable<typeof n> => n !== null);

    if (parsed.length < 3) {
      return NextResponse.json({
        engineChord: "特定不可",
        candidates: [],
        analysis: "音が3つ以上必要です。",
      });
    }

    const uniq = uniqBy(parsed, n => n.raw);
    const selectedRaw = uniq.map(n => n.raw);
    const inputSet = new Set(selectedRaw);

    const candidates: CandidateObj[] = [];
    for (const root of selectedRaw) {
      for (const tpl of TEMPLATES) {
        const c = await buildCandidate(root, tpl, inputSet);
        if (c) candidates.push(c);
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const top = candidates[0];
    const engineChord = top && top.score > 0 ? top.chord : "特定不可";

    const analysis = await buildAiAnalysis(
      selectedRaw,
      engineChord,
      candidates.slice(0, 5)
    );

    return NextResponse.json({
      engineChord,
      candidates: candidates.slice(0, 10),
      analysis,
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}