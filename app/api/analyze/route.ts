export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的:
 * - 入力音を尊重し、芸大和声（総合和声・機能和声）の基準で判定・解説する
 * - 辞書機能により特殊和音（ナポリ、ドリア、増六、準固有等）を網羅する
 * - Expert/Beginnerモード切替対応
 * - JSONフォーマットを厳格に指定し、パースエラーを防ぐ
 * - スコアの1%問題を自動補正する
 * - 初心者/専門家ともに、和音記号の表記（I¹など）を統一する
 * - 【修正】調名は「ファ長調」ではなく「ヘ長調」等の日本音名（いろは）を強制する
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
// 1. 特殊和音判定ロジック（辞書）
// ============================================================
const SPECIAL_CHORD_RULES = `
【特殊和音の判定辞書（優先度：高）】
以下の構成音や条件に一致する場合、必ずこの定義に従って解説（analysis）を行ってください。

1. **IVの付加6 (Added 6th):** - 構成音: ファ・ラ・ド・レ (IV + 6th)
   - 機能和声判定: **II₇¹** (IIの七の和音・第1転回形) または **IV6**
   - 解説指示: 「構成音としてはIVの付加6（IV6）ですが、機能和声的にはVへ進むIIの七の第1転回形（II₇¹）とみなされます。終止形などでIへ進む場合はIVの装飾音とも解釈されます」と言及。

2. **ドリアのIV (Dorian IV):** - 条件: 短調設定(keyHint=minor)で、旋律的短音階の上行形（#6）を含むIVの和音（長三和音 または 属七の和音）。
   - 判定: **IV** または **IV₇**
   - 解説指示: 「短調ですが、旋律的短音階に由来するドリアのIV（長三和音/IV7）です。独特の明るさを持ち、文脈によっては準属的な響きとなります」と言及。

3. **増六の和音 (Augmented 6th):** - 条件: 増6度（例: AbとF#）を含む和音。※異名同音（AbとGb）と区別すること。
   - 判定: **増六の和音**
   - 解説指示: 「属機能（D）を持ち、主にVへ解決します。構成音により国名(イタリア・フランス・ドイツ)を区別します」と言及。

4. **ナポリの六 (Neapolitan 6th):** - 条件: 短調設定で、IIの根音を半音下げた長三和音の第1転回形。
   - 判定: **ナポリのII** または **II¹**（根音変位）
   - 解説指示: 「芸大和声ではナポリのIIとして扱います。通称ナポリの六（N⁶）とも呼ばれ、S機能として劇的な効果を持ちます」と言及。

5. **ピカルディのI (Picardy Third):** - 条件: 短調設定で、主和音がMajorの場合。
   - 判定: **I** (長三和音)
   - 解説指示: 「短調の楽曲を長主和音で終えるピカルディ終止と考えられます」と言及。

6. **Iの第2転回形 (I² / Cadential 6/4):** - 条件: 主和音の第2転回形（Bassが属音）。
   - 判定: **I²** (機能: **D**)
   - 解説指示: 「終止四六（D機能）が代表的ですが、文脈により『経過四六』や『補助四六』の可能性もあります」と言及。

7. **準固有和音 (Moll-Dur):** - 条件: 長調設定(keyHint=Major)で、同主短調の和音（例: IVm, bVI）が使われた場合。
   - 判定: **IVm** や **°VI** (左上に○の代用)
   - 解説指示: 「同主短調から借用された準固有和音（モル・ドゥア）です。芸大和声では左上に○を付して区別します（本システムでは°VIと表記）。長調の中に切ない響きをもたらします」と言及。

8. **ドッペル・ドミナント (Secondary Dominant):** - 条件: 属和音(V)の完全5度上に位置する和音（IIの長三和音 または II7）。
   - 判定: **II** または **II₇** (※臨時記号含む)
   - 解説指示: 「属和音(V)を修飾するドッペル・ドミナント（VのV）の役割を持ち、強い推進力を生みます（直後にVへ進まないケースもあります）」と言及。

9. **根音省略の属九 (Rootless Dominant 9th):** - 条件: 減七の和音 (Diminished 7th)。
   - 判定: **VII₇** (減七)
   - 解説指示: 「形態上は減七の和音ですが、機能和声的には根音を省略した属九の和音（V₉）とみなされ、ドミナント機能を持ちます（経過的・転調用の減七を除く）」と言及。

10. **Iの付加6の和音 (Added 6th on I):** - 構成音: ド・ミ・ソ・ラ (I + 6th)
    - 判定: **VI₇¹** (VIの七の和音・第1転回形)
    - 解説指示: 「ポピュラー音楽では『Iの付加6（C6など）』ですが、芸大和声ではVIの七の第1転回形（VI₇¹）として扱うことが多いです」と言及。

11. **導七の和音 (Leading Tone 7th):** - 条件: 短調のVIIの和音、または長調で減5短7の構成音を持つもの（減七ではない）。
    - 判定: **VII₇** (減5短7)
    - 解説指示: 「導七の和音（VII₇）です。減七の和音とは区別され、より穏やかなD機能を持ちます」と言及。
`;

// ============================================================
// 2. 表記ルール（ここを分離して両モードに適用！）
// ============================================================
const NOTATION_RULES = `
【和音記号表記】
- 転回形は右上（I¹）、種類は右下（V₇）に記述。
- TDS機能は大文字（T, D, S）。
- ポピュラー表記（C, Am等）は一般的表記に従う。
- 長三和音は "Major" を付けない。
`;

// ============================================================
// 3. 出力フォーマット
// ============================================================
const OUTPUT_FORMAT_JSON = `
【出力はJSONのみ】
以下のJSONフォーマットを厳守してください。Markdownや他のテキストは含めないでください。

{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string, // 代表的なコード名（C, Cm/Ebなど）
  "chordType": string, // 和音の種類（長三和音、属七の和音など許可された名称）
  "confidence": number, // 0.0-1.0
  "analysis": string, // 解説文
  "candidates": [
    {
      "chord": string,
      "chordType": string,
      "inversion": "root" | "1st" | "2nd" | "3rd" | "unknown",
      "tds": "T" | "D" | "S" | "?",
      "romanNumeral": string, // 記号は指定の表記法に従うこと
      "score": number, // 0-100
      "confidence": number, // 0.0-1.0
      "chordTones": string[],
      "extraTones": string[],
      "reason": string,
      "provisional": boolean
    }
  ]
}

【candidatesの条件】
- 最大10件、上から有力順
- candidates[0] は現時点で最有力なものにする
`;

// ============================================================
// Prompt: Expert (厳格・大学レベル)
// ============================================================
function buildExpertSystemPrompt() {
  return `
あなたは日本の音楽大学で標準的に教えられている和声理論（いわゆる芸大和声・総合和声）に精通した専門家です。

【絶対ルール（最優先）】
- **入力された音名表記（スペル）を絶対的に尊重してください。**
- 異名同音（例: F# と Gb）は明確に区別して判定してください。
- bassHintがない場合は原則として「基本形」を最優先する。
- **Markdown形式は使用禁止です。プレーンテキストのみで出力してください。**

【用語・言語の指定（厳守）】
- 解説文（analysis）では **"Key" は使用禁止。「調」または「調性」とする。**
- 調の名前は**「ドイツ語音名（C-dur, a-moll等）」**または**「日本語（ハ長調等）」**を使用する。
- 属和音（D）や第7音を含む和音は、必ず「解決（進行方向）」に言及する。
- 口調は断定的で簡潔に（「〜である。」）。

【和音の種類（chordType）の制限】
許可リスト: 長三和音, 短三和音, 減三和音, 増三和音, 属七の和音, 減七の和音, 長七の和音, 短七の和音, 減５短７の和音, 増七の和音, 属九の和音, 属短九の和音, 増六の和音

${SPECIAL_CHORD_RULES}
${NOTATION_RULES}
${OUTPUT_FORMAT_JSON}
`.trim();
}

// ============================================================
// Prompt: Beginner (親切・中高生向け)
// ============================================================
function buildBeginnerSystemPrompt() {
  return `
あなたは吹奏楽部や合唱部の中高生にも分かりやすく和声（ハーモニー）を教える、親切な音楽の先生です。
判定ロジックは「芸大和声」に従い正確に行いますが、解説（analysis）は優しく、噛み砕いて記述してください。

【絶対ルール】
- 判定や記号（romanNumeral）は正確に芸大和声のルール（Expertと同じ）に従ってください。嘘は教えないこと。
- **解説文（analysis）のみ、ターゲットを「中高生の初心者」に合わせる。**
- Markdownは使用禁止。

【解説文（analysis）の書き方】
- 口調は**「〜ですね」「〜ですよ」**といった丁寧語（です・ます調）。
- **調の名前（重要）:** 「ヘ長調（F-dur）」「ハ長調（C-dur）」のように、必ず**日本音名（ハニホヘトイロ）**を使ってください。「ファ長調」「ド長調」は誤りなので禁止です。
- **専門用語:** 「準固有和音」や「ナポリの六」などの用語は使ってOKですが、必ず簡単な説明を添えてください。
  - 例: 「これは『ナポリの六』と呼ばれる、とても劇的な変化をもたらす和音ですね。」
  - 例: 「『準固有和音』です。ちょっと切ない響きがしますね。」
- **解決:** 「この音は不安定なので、次に〇〇に行きたがっています」と感覚的に伝える。

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
- candidates[0] は現時点で最有力なものにしてください。
- analysis は「1行結論 → 構成音の確認 → 響きの特徴や役割」の順で、指定された人格（先生）になりきって書いてください。
- **Markdownは使用禁止です。**
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // ★ モード判定
    const mode = (body?.mode === "beginner") ? "beginner" : "expert";

    const selectedNotesRaw: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const keyHintRaw = typeof body?.keyHint === "string" ? body.keyHint : "none";
    const rootHintRaw = typeof body?.rootHint === "string" ? body.rootHint : null;
    const bassHintRaw = typeof body?.bassHint === "string" ? body.bassHint : null;

    const normalized = selectedNotesRaw.map(normalizeAccidentals).filter(Boolean);
    const onlyNotes = normalized.filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));
    const notesSorted = uniq(onlyNotes).sort(sortSpelling);

    const keyHint = (keyHintRaw || "none").trim();
    const rootHint = rootHintRaw && notesSorted.includes(normalizeAccidentals(rootHintRaw)) ? normalizeAccidentals(rootHintRaw) : null;
    const bassHint = bassHintRaw && notesSorted.includes(normalizeAccidentals(bassHintRaw)) ? normalizeAccidentals(bassHintRaw) : null;

    if (!model) return NextResponse.json({ error: "AI未接続" }, { status: 500 });
    if (notesSorted.length < 3) {
      return NextResponse.json({ status: "insufficient", engineChord: "判定不能", analysis: "音が不足しています。", candidates: [], notes: notesSorted });
    }

    // ★ モードに応じてプロンプトを切り替え
    const systemInstruction = mode === "beginner" ? buildBeginnerSystemPrompt() : buildExpertSystemPrompt();

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildUserPrompt({ notesSorted, keyHint, rootHint, bassHint }) }] }],
      systemInstruction: systemInstruction,
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });

    const json = parseJsonSafely(result.response.text());
    
    // ★ 1%問題を解決する自動補正ロジック
    let candidates: CandidateObj[] = (json.candidates || []).map((c: any) => {
      let rawScore = typeof c.score === "number" ? c.score : 0;
      let rawConf = typeof c.confidence === "number" ? c.confidence : 0;

      // 自動補正
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

    // 順位の保険
    if (candidates.length > 0) {
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