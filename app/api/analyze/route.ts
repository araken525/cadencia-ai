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
  const t = (s ?? "").trim()
    .replaceAll("♭", "b").replaceAll("♯", "#")
    .replaceAll("𝄫", "bb").replaceAll("𝄪", "##");
  // 先頭の音名だけ大文字化（accidentalはそのまま）
  return t.replace(/^([a-g])/, (m) => m.toUpperCase());
}

type Acc = "" | "#" | "##" | "b" | "bb";
// ... (以下変更なし)
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
// 1. 特殊和音判定ロジック (Flash最適化・原文維持版)
// ============================================================
const SPECIAL_CHORD_RULES = `
【判定の絶対原則 (最優先)】
思考時間を短縮するため、以下の優先順位で**即決**せよ。
1. **スペル優先**: 異名同音（例: F#とG♭）の解釈で迷った場合は、入力された文字(Accidentals)を正として扱う。
   - "#"が含まれていれば、安易に"♭"に読み替えて属七にするな。「増六」の可能性を疑え。
2. **Key文脈**: Keyが指定されている場合、そのKeyにおける役割を最優先する。

---

【特殊和音・機能和声判定 (優先度:最高)】
以下の条件に合致する場合は、必ず定義に従って判定せよ。

1. [準固有和音 (同主短調からの借用)]
   - 条件: 長調において、同主短調の固有音を含む和音。
   
   // ▼ ここを修正: 「○は不要」を削除し、「°を付ける」に変更
   - 判定: 借用元の度数を明記し、**和音記号の前に「°」を付記せよ** (例: °VI, °IV, °ii)。
     (※準固有和音を示す「白丸」の代用として、必ず記述すること)
   
   - 解説: 「準固有和音(モル・ドゥア)。切ない響き」と言及。

2. [ドッペル・ドミナント (V/V)]
   - 条件: 調(Key)に対して「VのV」にあたる和音。
   - 【除外】: Key指定がない(Key=none)場合は判定を保留し、単なる「属七」として扱え。
   - 判定: II または II₇ (あるいは V/V)
   - 解説: 「ドッペル・ドミナント(VのV)。属和音へ向かう強い推進力」と言及。

3. [副属七・副導七の和音]
- 条件:解決先を明示した上で、V/IV, V/ii, vii°7/V (#IVdim7) 等の機能を持つ場合。
- 原則禁止:短調において「V₇/VII」と解釈できる形（IV₇）は、転調や主音転換の文脈が明示されない限り、副属七としては判定せず、原則として「ルール7（ドリアのIV）」を適用する。
- 判定:V₇/IV, vii°7/V 等、必ず「〇〇へ解決する副属七（副導七）」と記述すること。
- 解説:解決先（〇〇）への推進力を持つことを明示し、「属和音へ向かう」という曖昧な表現は用いない。変化音は、解決先の調・和音に対する機能として説明する。

4. [減七・導七・根音省略V9の識別]
   - 条件: 減三短七(viiø7) または 減七(dim7) の形を持つ和音。
   
   // ▼ 分岐A: 長調のVII上 (ø7)
   - 分岐A (導七): 
     条件: 減5短7(ø7)の形 (例: B, D, F, A)
     判定: **「導七の和音(VII₇)」** と判定せよ。
     解説: 「主音へ解決する導七の和音(またはII₇)」と言及。

   // ▼ 分岐B: 短調のVII上 (dim7) ※ここを修正
   - 分岐B (根省V9): 
     条件: 減七(dim7)の形 (例: G#, B, D, F)
     判定: **「根音省略の属九(V₉根省)」** と判定せよ。
     注意: **「減減七」という用語は存在しないため使用禁止。** また、機能的に「導七」と呼ぶのも誤りである。
     解説: 「構造上は『減七の和音』だが、機能和声的には根音(V)を省略した属九の和音(V₉)として扱う」と明記せよ。

5. [増六の和音 (Italian / German / French)]
   - 識別(スペル厳守): 
     属七(V7)と同じ響きであっても、**必ず入力された文字(Accidentals)で区別**し、深読みによるタイムアウトを防げ。
     A) スペルに「増6度 (#4と♭6)」がある (例: F# と A♭)
        → 思考停止して**「増六の和音」**と即断せよ。
     B) スペルが「短7度」の場合 (例: G♭ と A♭)
        → **ただの「属七の和音 (V7)」** として判定せよ。絶対に「ドイツの六」として扱ってはならない。

   - 【イタリア判定の特例 (重要)】:
     構成音が「3音だけ」で、増6度が含まれる場合、それは他の和音の省略形ではない。
     100%「イタリアの六」である。属七(omit5)と判定してはならない。

   - 分岐(Key=Cの例):
     A) 伊(It): 3音構成 (例: A♭, C, F#) → 「イタリアの六」 (※3音ならこれ一択)
     B) 独(Ger): 4音構成 (例: A♭, C, E♭, F#) → 「ドイツの六」
     C) 仏(Fr): 4音構成 (例: A♭, C, D, F#) → 「フランスの六」

   - 解説: 「増六の和音(〇〇の六)。増六の和音は、V/Vと同様に属和音へ強く向かうが、構造・機能上は独立した前属和音である。」

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

13. [第5音省略（Omit 5）の許容]
- 前提: 先にルール5（増六の和音）を適用し、構成音に増6度（♭6–♯4）が含まれないことを確認せよ。（※増6度が含まれる場合は本ルールを適用しない）
- 条件: 構成音が3音のみで、3度を含み、短7度（またはそれに相当する長2度）が7度として機能的に解釈可能な場合。
- 判定: 情報不足とはせず、正当な7の和音（V7、m7等）の第5音省略形（Omit 5）として判定せよ。
- 解説: 「第5音は省略されているが、3度と7度が保持されているため、機能・響きの両面で完全な〇〇の和音である」と言及せよ。
`;

// 【難解な和音のためのカンニングペーパー】 (※これも忘れずに含めてください)
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
// 共通の表記ルール (修正版: 役割分離を明文化)
// ============================================================
const NOTATION_RULES = `
【用語・音名表記（絶対厳守）】
調名の表記は以下の3パターンのいずれかのみを使用せよ。英語と日本語の混用（混ぜ書き）は厳禁とする。

1. 独: C-dur, a-moll (ドイツ音名) ※推奨
2. 英: C Major, A Minor (英語音名)
3. 日: ハ長調, イ短調 (日本音名)

★【禁止例】: 「F長調」「C短調」「Aマイナー」のような混ぜ書きは絶対禁止。「ヘ長調」または「F-dur」と記述せよ。

【和音種別名(厳守)】
和音の種類を表す際は以下のみを使用せよ。カタカナ語(メジャーコード等)は禁止。
- 長三和音, 短三和音, 減三和音, 増三和音
- 属七の和音, 減七の和音, 長七の和音, 短七の和音
- 減五短七の和音(導七の和音), 増七の和音
- 属九の和音, 属短九の和音, 増六の和音

【記号の使い分け（最重要）】
1. **コード名 (chord / engineChord)**:
   - 基本的には「ポピュラー和音記号」で記述せよ（例: C, Am, G7）。
   - 長三和音に "Major" は付けない。
   - **例外(増六の和音):**
     - 無理に属七(V7)に置換せず、**根音(Bass音) + "+6"** の形式で記述してもよい。
     - 例: イタリアの六(Ab, C, F#) → **Ab+6**
     - 例: ドイツの六(Ab, C, Eb, F#) → **Ab+6**
   - **bassHintが "none" の場合は、機能的に転回形であっても、スラッシュを含まない形を出力せよ。**
   - 転回指数（¹や²）はここには記述しない。
   
2. **和声記号 (romanNumeral)**:
   - **ここには「芸大和声の機能表記」を記述せよ。**
   - 増六やナポリはここで表現せよ（例: Ger⁶, It⁶, Fr⁶, N⁶）。
   - **【絶対ルール】ローマ数字は全て「大文字」で記述せよ。**
   - 短三和音や減三和音であっても、小文字(i, ii, iii, iv, v...)は**絶対禁止**である。
     - [正解]: I, II, III, IV, V, VI, VII
     - [不正解]: i, ii, iii, iv...
   - 準固有和音の場合も同様である (例: iv は不可。IV または IVm とせよ)。
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
3. 形式: Markdown禁止。出力は純粋なJSON文字列のみ。
4. **口調**: 断定的・簡潔に(「〜である」)。挨拶不要。

【解説の指針】
- 調名は必ず「日本音名(ハ長調)」または「ドイツ音名(C-dur)」を使用せよ。「ファ長調」等は禁止。
- 解決は「不安定なので、次に〇〇へ行きたがっている」等と表現せよ。

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
1. **入力尊重**: スペルを厳守せよ。異名同音(F#/Gb)は明確に区別して判定せよ。
2. **順序**: BassHintが "none" の場合、入力順序にかかわらず**原則として『基本形 (root)』**として判定せよ。勝手に転回形と決めつけることは禁止する。
3. 形式: Markdown禁止。出力は純粋なJSON文字列のみ。
4. **口調**: 断定的・簡潔に(「〜である」)。挨拶不要。

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

      // 2. 重複を削除 (和音名が同じなら、スコアが高い方を残す)
      const uniqueMap = new Map<string, CandidateObj>();
      candidates.forEach((c) => {
        if (!uniqueMap.has(c.chord)) {
          uniqueMap.set(c.chord, c);
        } else {
          const prev = uniqueMap.get(c.chord)!;
          // 既存よりスコアが高ければ上書き保存
          if (c.score > prev.score) {
            uniqueMap.set(c.chord, c);
          }
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