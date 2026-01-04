export const runtime = "edge";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Waon AI Analyze API (Final Fixed Version 2.0)
 * - Model: gemini-2.5-flash
 * - Logic: 芸大和声準拠
 * - Update: 重複候補の除外処理＆最大5件制限を追加
 */

// -------------------- Gemini --------------------
const apiKey = process.env.GEMINI_API_KEY || "";
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const model = genAI ? genAI.getGenerativeModel({ model: modelName }) : null;

// -------------------- Utils --------------------
function normalizeAccidentals(s: string) {
  return (s ?? "").trim().replaceAll("♭", "b").replaceAll("♯", "#").replaceAll("𝄫", "bb").replaceAll("𝄪", "##");
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

function parseJsonSafely(text: string) {
  const t = (text ?? "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error("AIのJSONパースに失敗しました");
}

function clamp01(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : fallback;
}

function clampScore(n: any, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(100, Math.round(x))) : fallback;
}

function safeStr(s: any, fallback = "") { return typeof s === "string" ? s : fallback; }
function safeArrStr(a: any) { return Array.isArray(a) ? a.filter((x) => typeof x === "string") : []; }

function getChordRoot(chordName: string): string {
  const core = chordName.split("/")[0];
  const m = core.match(/^([A-G](?:bb|b|##|#)?)/);
  return m ? normalizeAccidentals(m[1]) : "";
}

function getChordBass(chordName: string): string {
  if (chordName.includes("/")) {
    return normalizeAccidentals(chordName.split("/")[1]);
  }
  return getChordRoot(chordName);
}

// -------------------- Types --------------------
type CandidateObj = {
  chord: string;
  chordType?: string;
  inversion?: string;
  romanNumeral?: string;
  tds?: "T" | "D" | "S" | "SD" | "?";
  score: number;
  confidence: number;
  chordTones: string[];
  extraTones: string[];
  reason: string;
  provisional?: boolean;
};

type AnalyzeResponse = {
  status: "ok" | "ambiguous" | "insufficient";
  engineChord: string;
  chordType?: string;
  confidence?: number;
  candidates: CandidateObj[];
  analysis: string;
  notes: string[];
  keyHint: string;
  rootHint: string | null;
  bassHint: string | null;
};

// ============================================================
// 1. 特殊和音判定ロジック
// ============================================================
const SPECIAL_CHORD_RULES = `
【特殊和音・機能和声判定 (優先度:最高)】
以下の条件に合致する場合は、必ず定義に従って判定せよ。

1. [準固有和音 (同主短調からの借用)]
   - 条件: 長調において、同主短調の固有音を含む和音。
   - 判定: 借用元の度数を明記 (例: ♭VI, iv, iiø)。左上に○は不要。
   - 解説: 「準固有和音(モル・ドゥア)。切ない響き」と言及。

2. [ドッペル・ドミナント (V/V)]
   - 条件: 調(Key)に対して「VのV」にあたる和音。
   - 【除外】: Key指定がない(Key=none)場合は判定を保留し、単なる「属七」として扱え。
   - 判定: II または II₇ (あるいは V/V)
   - 解説: 「ドッペル・ドミナント(VのV)。属和音へ向かう強い推進力」と言及。

3. [副属七・副導七の和音]
   - 条件: V/IV, V/ii, vii°7/V (#IVdim7) 等の機能を持つ場合。
   - 【絶対禁止】: 短調において「V₇/VII」となる形（つまりIV₇）は、副属七として判定してはならない。必ず「ルール7 (ドリアのIV)」を適用せよ。
   - 判定: V₇/IV, vii°7/V 等、解決先を明示して記述。
   - 解説: 「〇〇への副属七(または副導七)」と言及。

4. [減七・導七・根音省略V9の識別]
   - 条件: 減三短七(viiø7) または 減減七(dim7) の形を持つ和音。
   - 分岐A (導七): 調の第7音(導音)上にあり、減5短7(ø7)の形 → 「導七の和音(VII₇)」
   - 分岐B (根省V9): 調の第7音(導音)上にあり、減減七(dim7)の形 → 「根音省略の属九(V₉根省) または 減七の和音」
   - 解説: 分岐Bの場合は「機能的には根音を省略した属九(V₉)としてD機能を持つ」と補足せよ。

5. [増六の和音 (Italian / German / French)]
   - 識別: 響きは属七(V7)と同じだが、スペルに「増6度 (例: ♭6と#4)」がある場合は増六と断定せよ。
   - 分岐(Key=Cの例で判断せよ):
     A) 伊(It): 3音構成 (例: A♭, C, F#) → 「イタリアの六」
     B) 独(Ger): 4音構成 (例: A♭, C, E♭, F#) → 「ドイツの六」
     C) 仏(Fr): 4音構成 (例: A♭, C, D, F#) → 「フランスの六」
   - 判定: 増六の和音 (種類を特定)
   - 解説: 「増六の和音(〇〇の六)。#4と♭6が外へ開いてVへ解決する」と言及。

6. [ナポリの和音 (ナポリのII)]
   - 条件: IIの根音を半音下げた長三和音 (♭II)。転回形は問わない。
   - 分岐:
     A) 第1転回形の場合 → 「ナポリの六(N⁶)」と判定。
     B) それ以外 → 「ナポリのII(根音変位)」と判定し、解説で「通常は第1転回形(N⁶)で用いられる」と補足せよ。
   - 解説: 「ナポリの和音。S機能として劇的な効果」と言及。

7. [ドリアのIV] (短調で#6を含むIV)
   - 条件: 短調において、音階の第6音を半音上げた音(旋律的短音階)を含むIVの和音(IV または IV₇)。
   - 判定: IV (または IV₇)
   - 解説: 「ドリアのIV(またはIV₇)。旋律的短音階の上行形(#6)に由来する明るい響き」と言及。

8. [IVの付加6] (IV + 6th)
   - 条件: IVの和音に第6音が付加された形 (例: C調で F, A, C, D)。
   - 判定: 基本的に「II₇」として扱う。
   - 転回形分岐 (BassHintがある場合):
     A) Bassが第3音(IVの根音) → 「II₇¹ (IIの七の1転)」 ※これが「IVの付加6」の正体。
     B) Bassが根音(IIの根音) → 「II₇ (基本形)」
     C) Bassが第7音(IVの第5音) → 「II₇³ (IIの七の3転)」
   - 解説: 「機能的にはVへ進むII₇。BassがIVの根音なら『IVの付加6』の響きを持つ」と言及。

9. [Iの付加6] (I + 6th)
    - 条件: Iの和音に第6音が付加された形 (例: C調で C, E, G, A)。
    - 判定: 基本的に「VI₇」として扱う。
    - 転回形分岐:
     A) Bassが第3音(Iの根音) → 「VI₇¹ (VIの七の1転)」 ※これが「Iの付加6」の正体。
     B) Bassが根音(VIの根音) → 「VI₇ (基本形)」
   - 解説: 「芸大和声ではVIの七として扱う。BassがIの根音なら『Iの付加6』の響きを持つ」と言及。

10. [Iの第2転回形] (Bassが属音)
    - 判定: I² (機能:D)
    - 解説: 「終止四六・経過四六・補助四六」のいずれか文脈に合わせて言及。

11. [ピカルディのI] (短調終止が長主和音)
    - 判定: I (長三和音)
    - 解説: 「ピカルディ終止」と言及。

    12. [解決の原則 (最重要)]
    - 属七(V7, 副属七)の「第3音」は上行して解決、「第7音」は下行して解決(原則として解決先の第3音へ)させよ。
    - 「第7音が根音へ跳躍する」などの不自然な解決記述は厳禁。
`;

// 【難解な和音のためのカンニングペーパー】
const COMPLEX_CHORD_EXAMPLES = `
【判定サンプル（BassHintを最優先せよ）】
// 増六の和音
入力: [Ab, C, F#] → 正解: "It⁶" (イタリアの六)
入力: [Ab, C, Eb, F#] → 正解: "Ger⁶" (ドイツの六)

// IVの付加6 (構成音: F, A, C, D)
入力: [F, A, C, D] (Bass: F)
→ 正解: "II₇¹"
→ 解説: "BassがF(IVの根音)なので、II₇の第1転回形。通称『IVの付加6』。"

入力: [D, F, A, C] (Bass: D)
→ 正解: "II₇"
→ 解説: "BassがD(根音)なので、II₇の基本形。"

// Iの付加6 (構成音: C, E, G, A)
入力: [C, E, G, A] (Bass: C)
→ 正解: "VI₇¹"
→ 解説: "BassがC(Iの根音)なので、VI₇の第1転回形。通称『Iの付加6』。"
`;

// ============================================================
// 2. 表記・用語ルール
// ============================================================
const NOTATION_RULES = `
【用語・音名表記（絶対厳守）】
以下の3パターン以外の組み合わせ（「F長調」「ド長調」等）は禁止。
1. 独: C-dur, a-moll (ドイツ音名)
2. 英: C Major, A Minor (英語音名)
3. 日: ハ長調, イ短調 (日本音名)

【和音種別名(厳守)】
和音の種類を表す際は以下のみを使用せよ。カタカナ語(メジャーコード等)は禁止。
- 長三和音, 短三和音, 減三和音, 増三和音
- 属七の和音, 減七の和音, 長七の和音, 短七の和音
- 減五短七の和音(導七の和音), 増七の和音
- 属九の和音, 属短九の和音, 増六の和音

【記号の使い分け（最重要）】
1. **コード名 (chord / engineChord)**:
   - 一般的なポピュラー表記を使用せよ（例: C, Am, G7）。
   - 長三和音に "Major" は付けない（例: "C Major"ではなく"C"とする）。
   - 転回形は必ず**スラッシュコード**で表記せよ（例: C/E, Am/G）。
   - **ここには転回指数（¹や²）を絶対に付けてはならない。**

2. **和声記号 (romanNumeral)**:
   - 芸大和声式を使用せよ（例: I, V）。
   - 転回形は**右上の転回指数**で表記せよ（例: I¹, I²）。
   - 種類（7など）は**右下の数字**で表記せよ（例: V₇, II₇）。
   - 機能は T, D, S (大文字) を使用せよ。
`;

// ============================================================
// 3. 出力フォーマット
// ============================================================
const OUTPUT_FORMAT_JSON = `
【出力形式 (JSONのみ)】
Markdownや挨拶は禁止。以下のJSONのみ出力せよ。
{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "chordType": string,
  "confidence": number,
  "analysis": string,
  "candidates": [
    {
      "chord": string,
      "chordType": string,
      "inversion": "root" | "1st" | "2nd" | "3rd" | "unknown",
      "tds": "T" | "D" | "S" | "?",
      "romanNumeral": string,
      "score": number,
      "confidence": number,
      "chordTones": string[],
      "extraTones": string[],
      "reason": string,
      "provisional": boolean
    }
  ]
}
candidatesは最大5件。
`;

// ============================================================
// Prompt: Expert
// ============================================================
function buildExpertSystemPrompt() {
  return `
あなたは日本の音楽大学(芸大和声)に精通した専門家である。

【重要ルール】
1. **入力尊重**: スペルを厳守せよ。異名同音(F#/Gb)は明確に区別して判定せよ。
2. **順序**: BassHintが "none" の場合、入力順序にかかわらず**原則として『基本形 (root)』**として判定せよ。勝手に転回形と決めつけることは禁止する。
3. **形式**: Markdown禁止。プレーンテキストのみ。
4. **口調**: 断定的・簡潔に(「〜である」)。挨拶不要。

【解説の指針】
- 解説文では "Key" を使わず「調」とせよ。
- 属和音(D)や第7音を含む和音は、必ず「解決(進行方向)」に言及せよ。

${SPECIAL_CHORD_RULES}
${NOTATION_RULES}
${OUTPUT_FORMAT_JSON}
`.trim();
}

// ============================================================
// Prompt: Beginner
// ============================================================
function buildBeginnerSystemPrompt() {
  return `
あなたは中高生に教える親切な音楽の先生である。
判定は「芸大和声」に基づき正確に行い、解説は優しく噛み砕くこと。

【重要ルール】
1. **入力尊重**: スペルを厳守せよ。異名同音(F#/Gb)は区別して解説せよ。
2. **順序**: 入力リスト順≠バス音である。
3. **形式**: Markdown禁止。
4. **口調**: 丁寧語(「〜ですね」「〜ですよ」)。挨拶不要。

【解説の指針】
- 調名は必ず「日本音名(ハ長調)」または「ドイツ音名(C-dur)」を使用せよ。「ファ長調」等は禁止。
- 専門用語は使用しつつ、感覚的な補足を添えること。
- 解決は「不安定なので、次に〇〇へ行きたがっている」等と表現せよ。

${SPECIAL_CHORD_RULES}
${NOTATION_RULES}
${OUTPUT_FORMAT_JSON}
`.trim();
}

function buildUserPrompt(params: { notesSorted: string[]; keyHint: string; rootHint: string | null; bassHint: string | null; }) {
  return `
入力音: ${params.notesSorted.join(", ")}
keyHint: ${params.keyHint}
rootHint: ${params.rootHint || "none"}
bassHint: ${params.bassHint || "none"}

依頼:
- candidates[0] は現時点で最有力なものにせよ。
- analysis は「結論 → 構成音の確認 → 響きの特徴や役割」の順で記述せよ。
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const mode = (body?.mode === "beginner") ? "beginner" : "expert";
    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const keyHintRaw = typeof body?.keyHint === "string" ? body.keyHint : "none";
    const rootHintRaw = typeof body?.rootHint === "string" ? body.rootHint : null;
    const bassHintRaw = typeof body?.bassHint === "string" ? body.bassHint : null;

    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    // ★ アルファベット順にソートして順序バイアスを排除
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    const keyHint = (keyHintRaw || "none").trim();
    const rootHint = rootHintRaw && notesSorted.includes(normalizeAccidentals(rootHintRaw)) ? normalizeAccidentals(rootHintRaw) : null;
    const bassHint = bassHintRaw && notesSorted.includes(normalizeAccidentals(bassHintRaw)) ? normalizeAccidentals(bassHintRaw) : null;

    if (!model) return NextResponse.json({ error: "AI未接続" }, { status: 500 });
    if (notesSorted.length < 3) {
      return NextResponse.json({ status: "insufficient", engineChord: "判定不能", analysis: "音が不足しています。", candidates: [], notes: notesSorted });
    }

    const systemInstruction = mode === "beginner" ? buildBeginnerSystemPrompt() : buildExpertSystemPrompt();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildUserPrompt({ notesSorted, keyHint, rootHint, bassHint }) }] }],
      systemInstruction: systemInstruction,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });

    const json = parseJsonSafely(result.response.text());
    
    let candidates: CandidateObj[] = (json.candidates || []).map((c: any) => {
      let rawScore = typeof c.score === "number" ? c.score : 0;
      let rawConf = typeof c.confidence === "number" ? c.confidence : 0;

      if (rawScore <= 1 && rawScore > 0) rawScore = rawScore * 100;
      if (rawConf > 1) rawConf = rawConf / 100;
      if (rawScore === 0 && rawConf > 0) rawScore = rawConf * 100;

      return {
        chord: safeStr(c.chord, "判定不能"),
        chordType: safeStr(c.chordType, ""),
        inversion: safeStr(c.inversion, "unknown"),
        romanNumeral: safeStr(c.romanNumeral, ""),
        tds: (["T", "D", "S"].includes(c.tds) ? c.tds : "?") as any,
        score: clampScore(rawScore, 0),
        confidence: clamp01(rawConf, 0),
        chordTones: safeArrStr(c.chordTones),
        extraTones: safeArrStr(c.extraTones),
        reason: safeStr(c.reason, ""),
        provisional: !!c.provisional,
      };
    }).filter((c: CandidateObj) => !!c.chord);

    // ★ 重複排除処理 & ヒント優先ソート
    if (candidates.length > 0) {
      // 1. まずヒントに基づいてソート（ユーザー指定を最優先）
      if (bassHint) {
        candidates.sort((a, b) => {
          const aMatch = getChordBass(a.chord) === bassHint;
          const bMatch = getChordBass(b.chord) === bassHint;
          if (aMatch && !bMatch) return -1; 
          if (!aMatch && bMatch) return 1;  
          return 0; 
        });
      } else if (rootHint) {
        candidates.sort((a, b) => {
          const aMatch = getChordRoot(a.chord) === rootHint;
          const bMatch = getChordRoot(b.chord) === rootHint;
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return 0;
        });
      } else {
        candidates.sort((a, b) => {
          const aHasSlash = a.chord.includes("/");
          const bHasSlash = b.chord.includes("/");
          if (!aHasSlash && bHasSlash) return -1;
          if (aHasSlash && !bHasSlash) return 1;
          return 0;
        });
      }

      // 2. 重複を削除 (和音名が同じなら、リストの上位=スコアが高い方を残す)
      const uniqueMap = new Map<string, CandidateObj>();
      candidates.forEach((c) => {
        if (!uniqueMap.has(c.chord)) {
          uniqueMap.set(c.chord, c);
        }
      });
      // 3. 最大5件に絞る
      candidates = Array.from(uniqueMap.values()).slice(0, 5);
    }

    const top = candidates[0];
    let engineChord = safeStr((json as any).engineChord, "").trim();

    if (!engineChord || engineChord === "判定不能") {
      engineChord = top?.chord || `${notesSorted.join("-")}(暫定)`;
    }
    if (top?.chord) engineChord = top.chord;

    const chordType = (safeStr((json as any).chordType, "").trim() || top?.chordType || "情報不足").trim();

    const statusRaw = safeStr((json as any).status, "ambiguous") as any;
    const status: AnalyzeResponse["status"] =
      statusRaw === "ok" || statusRaw === "ambiguous" || statusRaw === "insufficient"
        ? statusRaw
        : "ambiguous";

    let confidence = clamp01((json as any).confidence, 0);
    if ((!confidence || confidence === 0) && top) confidence = clamp01(top.confidence, 0.3);

    if (top) {
      const prov = status !== "ok" || confidence < 0.5;
      top.provisional = top.provisional || prov;
    }

    const analysis = safeStr((json as any).analysis, "（出力が不完全でした）");

    const res: AnalyzeResponse = {
      status,
      engineChord,
      chordType,
      confidence,
      analysis,
      candidates,
      notes: notesSorted,
      keyHint,
      rootHint,
      bassHint,
    };

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}