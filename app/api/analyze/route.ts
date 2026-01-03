export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
// 1. 特殊和音ロジック（共通辞書）
// ============================================================
const SPECIAL_CHORD_RULES = `
【特殊和音の判定辞書（優先度：高）】
以下の構成音や条件に一致する場合、必ずこの定義に従って解説してください。

1. **IVの付加6 (Added 6th):** 構成音としてはIV6だが、機能和声ではVへ進む**「IIの七の第1転回形（II₇¹）」**と解釈することが一般的。文脈によりIVの装飾とも捉えられる。
2. **ドリアのIV:** 短調で旋律的短音階の上行形(#6)を含むIV（長三和音/IV7）は、**「ドリアのIV」**として扱う。
3. **増六の和音:** 増6度を含む和音。構成音によりイタリア・フランス・ドイツを区別する。
4. **ナポリの六:** 短調でIIの根音を半音下げた長三和音の第1転回形。正式には「ナポリのII」または「II¹（根音変位）」だが、通称「ナポリの六（N⁶）」にも言及する。
5. **ピカルディのI:** 短調の曲が長主和音で終わる場合。「ピカルディ終止」とする。
6. **Iの第2転回形 (I²):** バスが属音の場合。「終止四六（D機能）」を基本とし、文脈により経過・補助四六とする。
7. **準固有和音 (Moll-Dur):** 長調設定(keyHint=Major)で、同主短調の和音（IVm, bVIなど）が使われた場合。解説では「準固有和音（モル・ドゥア）」と言及し、記号は左上に○を付した形（本システムでは **°VI** 等）で扱う。長調の中に切ない響きをもたらす。
8. **ドッペル・ドミナント:** 属和音(V)の完全5度上に位置するII（長三和音またはII7）。「VのV」としての推進力に言及する。
9. **根音省略の属九:** 減七の和音は、機能的には「根音省略の属九（V₉）」としてD機能を持つとみなす。
10. **Iの付加6:** ポピュラーではI6だが、芸大和声ではVIの七の第1転回形（VI₇¹）として扱うことが多い。
11. **導七の和音:** 短調のVIIまたは長調の減5短7を持つ和音。減七と区別し、穏やかなD機能を持つとする。
`;

// ============================================================
// 2. 出力フォーマット（ここが抜けていたので共通化！）
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
      "romanNumeral": string,
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

【回答のスタイル：最重要】
- **Markdown記法は禁止です。プレーンテキストのみで出力してください。**
- 挨拶や前置きは省略し、結論から**短く簡潔に**述べてください。
- 口調は断定的で、アカデミックなトーンを維持してください。

【先生としてのスタンス】
当アプリは、**「芸大和声（『和声 理論と実習』および『総合和声』）」**の理論体系を採用しています。
- ポピュラー理論よりも、クラシックの「機能和声記号（I, Vなど）」の解釈を重視します。

【用語・言語の指定（厳守）】
- **「Key」という単語は使用禁止です。必ず「調」または「調性」と記述してください。**
- **調の名前は、英語（Major/Minor）を使わず、必ず「ドイツ語音名（C-dur, a-moll等）」または「日本語（ハ長調, イ短調等）」を使用してください。**
- コードネーム自体はポピュラー表記（C, Am）で構いませんが、文中で呼ぶ際は「C-durの主和音」のようなアカデミックな表現を優先してください。

【和音の種類（名称）の厳格な制限】
以下のリストにある名称のみを使用してください。
- 長三和音, 短三和音, 減三和音, 増三和音
- 属七の和音, 減七の和音, 長七の和音, 短七の和音
- 減５短７の和音（導七の和音）, 増七の和音
- 属九の和音, 属短九の和音, 増六の和音

【和音記号表記】
- 転回形は右上（I¹）、種類は右下（V₇）に記述。
- TDS機能は大文字（T, D, S）。

${SPECIAL_CHORD_RULES}
${OUTPUT_FORMAT_JSON}
`.trim();
}

// ============================================================
// Prompt: Beginner (親切・中高生/初心者向け)
// ============================================================
function buildBeginnerSystemPrompt() {
  return `
あなたは吹奏楽部や合唱部の中高生にも分かりやすく和声（ハーモニー）を教える、親切な音楽の先生です。
判定ロジックは「芸大和声」に基づいて正確に保ちつつ、解説（analysis）は優しく、噛み砕いて記述してください。

【絶対ルール】
- 判定や記号（romanNumeral）は正確に芸大和声のルール（Expertと同じ）に従ってください。嘘は教えないこと。
- **解説文（analysis）のみ、ターゲットを「中高生の初心者」に合わせる。**
- Markdownは使用禁止。

【解説文（analysis）の書き方】
- 口調は**「〜ですね」「〜ですよ」**といった丁寧語（です・ます調）。
- **調の名前:** 「ハ長調（C-dur）」のように日本語とドイツ語を併記してあげるのが親切です。
- **専門用語:** 「準固有和音」や「ナポリの六」などの用語は使ってOKですが、必ず簡単な説明を添えてください。
  - 例: 「これは『ナポリの六』と呼ばれる、とても劇的な変化をもたらす和音ですね。」
  - 例: 「『準固有和音』です。ちょっと切ない響きがしますね。」
- **解決:** 「この音は不安定なので、次に〇〇に行きたがっています」と感覚的に伝える。

${SPECIAL_CHORD_RULES}
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

      // 自動補正: スコアが0.95などの小数で来たら、95点(整数)に直す
      if (rawScore <= 1 && rawScore > 0) {
         rawScore = rawScore * 100;
      }
      
      // 自動補正: 自信度が95などの整数で来たら、0.95(小数)に直す
      if (rawConf > 1) {
         rawConf = rawConf / 100;
      }

      // フォールバック: スコアが0だったら、自信度から作る
      if (rawScore === 0 && rawConf > 0) {
         rawScore = rawConf * 100;
      }

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

    // --------------------
    // 順位の保険
    // --------------------
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
    // 補正: トップ候補の自信度があればそれを採用
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
    console.error(e); // サーバーログにエラーを出力
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}