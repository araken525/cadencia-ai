// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的: 「判定(engineChord)」「候補(candidates)」「考察(analysis)」をAIで生成する
 * 追加: 常に最有力候補を表示 / 暫定バッジ / 和音の種類(chordType)
 */

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
    .replaceAll("𝄪", "##")
    .replaceAll("−", "-");
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

// notesSorted から暫定ラベル（最後の砦）
function makeFallbackLabel(notesSorted: string[]) {
  if (notesSorted.length === 0) return "（未選択）";
  // UI用に短く：C+E+G みたいに
  return notesSorted.join("+");
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;
  score?: number;       // 0..100（AI基準）
  confidence?: number;  // 0..1（AI基準）
  chordType?: string;   // 例: "長三和音" / "属七の和音" / "不明（文脈不足）"
  chordTones?: string[];
  extraTones?: string[];
  reason?: string;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  confidence: number;     // 0..1（AI全体）
  chordType: string;      // ★追加：トップの“和音種類”
  analysis: string;
  candidates: CandidateObj[];
  notes: string[];

  // ★追加：UI用
  provisional: boolean;   // engineChord が補正/暫定なら true
  badge: "確度高" | "暫定" | "情報不足";
};

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（古典和声・機能和声）の専門家です。

【絶対ルール（嘘防止）】
- 入力された音名表記をそのまま使う（異名同音を統合しない：A#とBb、CbとBを同一視しない）
- 押された順番は意味を持たない（こちらで既に表記順に整列済み）
- 文脈が無い限り、sus4 / add9 / 9th / 分数コード を断定しない（「可能性」か「情報不足」と言う）
- 無理にコード名を決めない。曖昧なら status="ambiguous"、3音未満なら status="insufficient"
- 「半音」「ピッチクラス」「実音高」などの語を出さない（説明は音名と機能和声の言葉で）
- 機能和声の語彙を優先（主和音/属和音/下属和音、導音、倚音/経過音/掛留など）
- 不明点は推測で埋めず「情報不足」と言い切ってよい

【出力は必ず application/json の“JSONのみ”】【説明文やコードブロック禁止】
必ず次の形で返す：

{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "confidence": number,    // 0..1
  "chordType": string,     // 例: "長三和音" / "属七の和音" / "不明（文脈不足）"
  "analysis": string,      // やさしめ。機能和声。
  "candidates": [
    {
      "chord": string,
      "score": number,          // 0..100
      "confidence": number,     // 0..1
      "chordType": string,      // 候補ごとの“和音種類”
      "chordTones": string[],
      "extraTones": string[],
      "reason": string
    }
  ]
}

【candidatesについて】
- 最大10件。上から有力順。
- “断定できない候補”は、reasonに「文脈不足」などを明記してOK。
- chordTones/extraTones は入力表記をそのまま使う。
`.trim();
}

function buildUserPrompt(notesSorted: string[]) {
  return `
入力音（表記順・重複なし）:
${notesSorted.join(", ")}

依頼:
- candidates を必ず返す（最大10）
- analysis は「1行結論 → 根拠 → 次に分かると強い情報」の順
- 曖昧なら status="ambiguous"、engineChord は "判定不能" でもOK
- chordType は“和音の種類”だけを短く（例: 長三和音 / 短三和音 / 属七の和音 / 不明（文脈不足））
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];

    // 正規化 → 無効を落とす → 重複排除 → 表記ソート（押下順排除）
    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter(n => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    // AI未接続でも落とさない
    if (!model) {
      const res: AnalyzeResponse = {
        status: notesSorted.length < 3 ? "insufficient" : "ambiguous",
        engineChord: notesSorted.length >= 1 ? makeFallbackLabel(notesSorted) : "判定不能",
        confidence: 0,
        chordType: "不明（AI未接続）",
        analysis: "（AI未接続）GEMINI_API_KEY が未設定です。",
        candidates: [],
        notes: notesSorted,
        provisional: true,
        badge: notesSorted.length < 3 ? "情報不足" : "暫定",
      };
      return NextResponse.json(res);
    }

    // 3音未満は “AIに聞く” こともできるけど、UIを安定させるならここで明示
    if (notesSorted.length < 3) {
      const res: AnalyzeResponse = {
        status: "insufficient",
        engineChord: makeFallbackLabel(notesSorted),
        confidence: 0,
        chordType: "不明（情報不足）",
        analysis: "音が3つ未満のため、和音として判断できません（情報不足）。",
        candidates: [],
        notes: notesSorted,
        provisional: true,
        badge: "情報不足",
      };
      return NextResponse.json(res);
    }

    const system = buildSystemPrompt();
    const user = buildUserPrompt(notesSorted);

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    });

    const json = parseJsonSafely(result.response.text()) as Partial<AnalyzeResponse> & { candidates?: any[] };

    // まずAI結果を受け取る
    let res: AnalyzeResponse = {
      status: (json.status as any) || "ambiguous",
      engineChord: typeof json.engineChord === "string" ? json.engineChord : "判定不能",
      confidence: typeof json.confidence === "number" ? json.confidence : 0.3,
      chordType: typeof (json as any).chordType === "string" ? (json as any).chordType : "不明（文脈不足）",
      analysis: typeof json.analysis === "string" ? json.analysis : "（出力が不完全でした）",
      candidates: Array.isArray(json.candidates) ? (json.candidates as any).slice(0, 10) : [],
      notes: notesSorted,
      provisional: false,
      badge: "確度高",
    };

    // --------------------
    // ★ここが “最小改修の肝”：返却直前に engineChord を補正
    // --------------------
    const topCandidateChord = res.candidates?.[0]?.chord;

    const needsFix =
      !res.engineChord ||
      res.engineChord.trim() === "" ||
      res.engineChord.trim() === "判定不能";

    if (needsFix) {
      if (typeof topCandidateChord === "string" && topCandidateChord.trim() !== "") {
        res.engineChord = topCandidateChord;
        res.provisional = true;
        res.badge = res.status === "ok" ? "暫定" : (res.status === "insufficient" ? "情報不足" : "暫定");
      } else {
        res.engineChord = makeFallbackLabel(notesSorted);
        res.provisional = true;
        res.badge = res.status === "insufficient" ? "情報不足" : "暫定";
      }
    } else {
      // engineChord はあるが status が曖昧なら「暫定」に落としてもよい（お好み）
      if (res.status !== "ok") {
        res.provisional = true;
        res.badge = res.status === "insufficient" ? "情報不足" : "暫定";
      }
    }

    // chordType が空ならトップ候補から拾う（任意）
    if ((!res.chordType || res.chordType.trim() === "") && res.candidates?.[0]?.chordType) {
      res.chordType = String(res.candidates[0].chordType);
      res.provisional = true;
      if (res.badge === "確度高") res.badge = "暫定";
    }

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}