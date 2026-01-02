// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

// -------------------- Gemini --------------------
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

// -------------------- Utils --------------------
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

type Acc = "" | "#" | "##" | "b" | "bb";
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const ACC_INDEX: Record<Acc, number> = { bb: 0, b: 1, "": 2, "#": 3, "##": 4 };

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
function uniq<T>(arr: T[]) {
  return [...new Set(arr)];
}

// Geminiが余計な文字を返しても拾う
function parseJsonSafely(text: string) {
  const t = (text ?? "").trim();
  try {
    return JSON.parse(t);
  } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  throw new Error("AIのJSONパースに失敗しました");
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;
  score?: number;        // 0..100
  confidence?: number;   // 0..1
  chordTones?: string[];
  extraTones?: string[];
  reason?: string;
  // 追加：和音の種類（例：長三和音 / 属七 / 減七 / 懸垂4 など）
  chordType?: string;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  confidence: number; // 0..1
  analysis: string;
  candidates: CandidateObj[];
  notes: string[];
  // 追加：ユーザーが指定した調性（指定なしなら "none"）
  keyHint?: string;
  // 追加：UI用の暫定バッジ
  provisional?: boolean;
};

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール（嘘防止）】
- 入力された音名表記をそのまま使う（異名同音の統合禁止：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（こちらで既に表記順に整列済み）
- 文脈が無い限り、sus4 / add9 / 9th / 分数コード を断定しない（「可能性」か「情報不足」と言う）
- 無理にコード名を決めない。曖昧なら status="ambiguous"。3音未満なら status="insufficient"
- 「半音」「ピッチクラス」「実音高」などの語を出さない（説明は音名と機能和声の言葉で）
- 機能和声の語彙を優先（主/属/下属、導音、倚音/経過音/掛留など）
- 不明点は推測で埋めず「情報不足」と言い切ってよい

【調性指定について】
- keyHint が "none" 以外なら、その調性を前提に“機能”の説明をしやすくしてよい
- ただし、指定調性でも断定が危険なら「曖昧」と言う

【出力は必ずJSONのみ（application/json）】
{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "confidence": number,   // 0..1
  "analysis": string,     // 人間向け。やさしめ。機能和声。
  "candidates": [
    {
      "chord": string,
      "chordType": string,    // 例: "長三和音", "短三和音", "属七", "減七", "sus4(懸垂4)", "判定保留" など
      "score": number,        // 0..100
      "confidence": number,   // 0..1
      "chordTones": string[],
      "extraTones": string[],
      "reason": string
    }
  ]
}

【candidatesについて】
- 最大10件。上から有力順。
- “断定できない候補”は chordType="判定保留" でもOK。reasonに「文脈不足」などを書く。
- chordTones/extraTones は入力表記をそのまま使う。
`.trim();
}

function buildUserPrompt(notesSorted: string[], keyHint: string) {
  return `
入力音（表記順・重複なし）:
${notesSorted.join(", ")}

keyHint（調性指定）:
${keyHint || "none"}

依頼:
- candidates を必ず返して（最大10）
- analysis は「1行結論 → 根拠 → 機能の見立て（keyHintがあれば） → 次に分かると強い情報」の順
- 曖昧なら status を ambiguous にして、engineChord は "判定不能" でもOK
`.trim();
}

// engineChord補正（常に最有力候補を出す）
function fillEngineChord(res: AnalyzeResponse): AnalyzeResponse {
  const bad = !res.engineChord || res.engineChord.trim() === "" || res.engineChord.trim() === "判定不能";
  if (!bad) return res;

  const first = res.candidates?.[0]?.chord?.trim();
  if (first) {
    return { ...res, engineChord: first, provisional: true };
  }

  // 最後の手段：notesから暫定ラベル
  if (res.notes.length >= 3) {
    return { ...res, engineChord: `${res.notes[0]}(?)`, provisional: true };
  }
  if (res.notes.length >= 1) {
    return { ...res, engineChord: `${res.notes[0]}(?)`, provisional: true };
  }
  return { ...res, engineChord: "—", provisional: true };
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const keyHintRaw: string = typeof body?.keyHint === "string" ? body.keyHint : "none";

    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    // AI未接続でも落とさない
    if (!model) {
      const res: AnalyzeResponse = fillEngineChord({
        status: notesSorted.length < 3 ? "insufficient" : "ambiguous",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "（AI未接続）GEMINI_API_KEY が未設定です。",
        candidates: [],
        notes: notesSorted,
        keyHint: keyHintRaw || "none",
      });
      return NextResponse.json(res);
    }

    // 3音未満：AIに投げずに“情報不足”で返す（ただしUI都合で候補も欲しいなら投げてもOK）
    if (notesSorted.length < 3) {
      const res: AnalyzeResponse = fillEngineChord({
        status: "insufficient",
        engineChord: "判定不能",
        confidence: 0,
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: [],
        notes: notesSorted,
        keyHint: keyHintRaw || "none",
      });
      return NextResponse.json(res);
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt(notesSorted, keyHintRaw || "none");

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const json = parseJsonSafely(result.response.text()) as Partial<AnalyzeResponse>;

    const res0: AnalyzeResponse = {
      status: (json.status as any) || "ambiguous",
      engineChord: typeof json.engineChord === "string" ? json.engineChord : "判定不能",
      confidence: typeof json.confidence === "number" ? json.confidence : 0.3,
      analysis: typeof json.analysis === "string" ? json.analysis : "（出力が不完全でした）",
      candidates: Array.isArray((json as any).candidates) ? (json as any).candidates.slice(0, 10) : [],
      notes: notesSorted,
      keyHint: keyHintRaw || "none",
      provisional: false,
    };

    const res = fillEngineChord(res0);
    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}