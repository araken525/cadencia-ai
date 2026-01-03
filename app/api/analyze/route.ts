// app/api/analyze/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * 目的:
 * - 入力音を尊重し、島岡和声（赤本）の基準で判定・解説する
 * - 辞書機能により特殊和音（ナポリ、ドリア、増六、準固有等）を網羅する
 * - 和音名称は許可されたリストのみを使用する
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

// -------------------- Prompt --------------------
function buildSystemPrompt() {
  return `
あなたは音楽理論（島岡和声・芸大和声・古典機能和声）の専門家です。

【絶対ルール（最優先）】
- **入力された音名表記（スペル）を絶対的に尊重してください。**
- **異名同音（例: F# と Gb）は明確に区別して判定してください。勝手に読み替えないこと。**
- rootHint がある場合は「根音候補として強く尊重」する（和音名・転回形・候補順位に反映）。
- bassHint がある場合は「最低音（バス）候補として強く尊重」する（転回形や分数コード表記に必ず反映）。
- **bassHint の指定がない場合は、原則として「基本形」（分数コードでない形）を candidates の最上位（candidates[0]）に置く。**
- keyHint がある場合は、必ず「機能（tds）」と「和音記号（romanNumeral）」を算出する（不明なら "?" を許容）。
- 3音未満なら status="insufficient"
- **Markdown形式（太字など）は使用禁止です。プレーンテキストのみで出力してください。**

【用語と言語の指定（analysis 文の書き方）】
- 解説文（analysis）では "rootHint" という語を使わず「根音の指定」と言い換える。
- 解説文（analysis）では "bassHint" という語を使わず「最低音の指定」または「バスの指定」と言い換える。
- 解説文（analysis）では "keyHint" という語を使わず「調性の指定」と言い換える。
- analysis は和声学の専門用語（根音、第3音、第7音、導音、転回、機能、解決、終止、倚音 等）を使い、自然な日本語の文章で書く。
- **重要:** 属和音（D機能）や第7音を含む和音の場合、必ず「解決（Resolution）」に言及する（例: 「第7音のFはEへ下行して解決する性質がある」など）。

【和音の種類（chordType）の厳格な制限】
**以下のリストにある名称のみを使用してください。**
これらに当てはまらない場合は、構成音の関係性（例：「短三和音 ＋ 長３度」）で記述してください。

[許可される名称リスト]
- 長三和音
- 短三和音
- 減三和音
- 増三和音
- 属七の和音
- 減七の和音
- 長七の和音
- 短七の和音
- 減５短７の和音（導七の和音）
- 増七の和音
- 属九の和音（長九度を持つ場合）
- 属短九の和音（短九度を持つ場合）
- 増六の和音

【特殊和音の判定辞書（優先度：高）】
以下の構成音や条件に一致する場合、必ずこの定義に従って解説（analysis）を行ってください。

1. **IVの付加6の和音 (Added 6th)**
   - 構成音: ファ・ラ・ド・レ (IV + 6th)
   - 島岡式判定: **II₇¹** (IIの七の和音・第1転回形)
   - 解説指示: 「近代和声では『IVの付加6』ですが、島岡和声ではIIの七の第1転回形（II₇¹）として扱い、S機能となります」と言及。

2. **ドリアのIV (Dorian IV)**
   - 条件: 短調設定(keyHint=minor)で、旋律的短音階の上行形（#6）を含む長三和音のIV。
   - 島岡式判定: **IV** (長三和音)
   - 解説指示: 「短調ですが、旋律的短音階に由来するドリアのIV（長三和音）です。独特の明るさを持ちます」と言及。

3. **増六の和音 (Augmented 6th)**
   - 条件: 増6度（例: AbとF#）を含む和音。※異名同音（AbとGb）と区別すること。
   - 島岡式判定: **増六の和音**
   - 解説指示: 構成音により国名(イタリア・フランス・ドイツ)を明記する。

4. **ナポリの六 (Neapolitan 6th)**
   - 条件: 短調設定で、IIの根音を半音下げた長三和音の第1転回形。
   - 島岡式判定: **ナポリのII** または **II¹**（根音変位）
   - 解説指示: 「島岡和声ではナポリのIIとして扱います。通称ナポリの六（N⁶）とも呼ばれ、S機能として劇的な効果を持ちます」と言及。

5. **ピカルディのI (Picardy Third)**
   - 条件: 短調設定で、主和音がMajorの場合。
   - 島岡式判定: **I** (長三和音)
   - 解説指示: 「短調の楽曲を長主和音で終えるピカルディ終止と考えられます」と言及。

6. **Iの第2転回形 (I² / Cadential 6/4)**
   - 条件: 主和音の第2転回形（Bassが属音）。
   - 島岡式判定: **I²** (機能: **D**)
   - 解説指示: 「終止四六（D機能）が代表的ですが、文脈により『経過四六』や『補助四六』の可能性もあります」と言及。

7. **準固有和音 (Borrowed Chord / Moll-Dur)**
   - 条件: 長調設定(keyHint=Major)で、同主短調の和音（例: IVm, bVI）が使われた場合。
   - 島岡式判定: **IVm** や **♭VI** など
   - 解説指示: 「同主短調から借用された準固有和音（モル・ドゥア）です。長調の中に切ない響きをもたらします」と言及。

8. **ドッペル・ドミナント (Secondary Dominant)**
   - 条件: Vへ進むためのIIの変形（II Major または II7）。
   - 島岡式判定: **II** または **II₇** (※臨時記号含む)
   - 解説指示: 「属和音(V)を修飾するドッペル・ドミナント（VのV）の役割を持ち、強い推進力を生みます」と言及。

9. **根音省略の属九 (Rootless Dominant 9th)**
   - 条件: 減七の和音 (Diminished 7th)。
   - 島岡式判定: **VII₇** (減七)
   - 解説指示: 「形態上は減七の和音ですが、機能和声的には根音を省略した属九の和音（V₉）とみなされ、ドミナント機能を持ちます」と言及。

10. **IVの付加46**
    - 条件: IVのバス上で4度と6度が鳴っている。
    - 解説指示: 「和音外音（倚音など）を含んでいます。文脈によっては二重倚音や解決を待つ状態と解釈されます」と言及。

【和音記号（romanNumeral）の表記ルール：島岡式準拠】
**【重要】以下の表記ルールを厳守してください**
- **転回形（Inversion）** は和音記号の**右上（上付き文字）** に数字を書く。
- **七の和音（7th）などの種類** は和音記号の**右下（下付き文字）** に数字を書く。

【表記パターン】
1. **三和音**
   - 基本形: I, V
   - 第1転回形: I¹ （数字は右上）
   - 第2転回形: I² （数字は右上）

2. **七の和音**
   - 基本形: V₇ （7は右下）
   - 第1転回形: V₇¹ （7は右下、1は右上）
   - 第2転回形: V₇² （7は右下、2は右上）
   - 第3転回形: V₇³ （7は右下、3は右上）

※Unicodeの上付き文字（¹ ² ³）と下付き文字（₇ ₉）を正確に使用してください。

【その他のパラメータ】
- **tds（機能）は必ず大文字一文字 "T", "D", "S" のいずれか（不明なら "?"）で答えてください。**
- **inversion（転回形）は "root", "1st", "2nd", "3rd", "unknown" のいずれかで返してください。**

【出力はJSONのみ】
{
  "status": "ok" | "ambiguous" | "insufficient",
  "engineChord": string,
  "chordType": string,
  "confidence": number, // 0-1
  "analysis": string,
  "candidates": [
    {
      "chord": string,
      "chordType": string,
      "inversion": "root" | "1st" | "2nd" | "3rd" | "unknown",
      "tds": "T" | "D" | "S" | "?",
      "romanNumeral": string,
      "score": number, (0-100)
      "confidence": number, (0-1)
      "chordTones": string[],
      "extraTones": string[],
      "reason": string,
      "provisional": boolean
    }
  ]
}

【candidatesの条件】
- 最大10件、上から有力順
- chordTones/extraTones は入力表記をそのまま使う
- candidates[0] は現時点で最有力なものにする（上の優先ルールに従う）
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
- analysis は「1行結論 → 構成音に基づく根拠 → その和音の持つ響きの特徴や、機能的な役割」の順で構成し、自然な文章でまとめてください。
- 解説文では必ず和声学の知識や言葉（根音、第3音、第7音、転回、解決など）を使ってください。
- **Markdown（**太字**など）は使用禁止です。プレーンテキストで出力してください。**
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
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

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: buildUserPrompt({ notesSorted, keyHint, rootHint, bassHint }) }] }],
      systemInstruction: buildSystemPrompt(),
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    });

    const json = parseJsonSafely(result.response.text());
    
    let candidates: CandidateObj[] = (json.candidates || []).map((c: any) => ({
      chord: safeStr(c.chord, "判定不能"),
      chordType: safeStr(c.chordType, ""),
      inversion: safeStr(c.inversion, "unknown"),
      romanNumeral: safeStr(c.romanNumeral, ""),
      tds: (["T", "D", "S"].includes(c.tds) ? c.tds : "?") as any,
      score: clampScore(c.score, 0),
      confidence: clamp01(c.confidence, 0),
      chordTones: safeArrStr(c.chordTones),
      extraTones: safeArrStr(c.extraTones),
      reason: safeStr(c.reason, ""),
      provisional: !!c.provisional,
    })).filter((c: CandidateObj) => !!c.chord);

    // --------------------
    // 順位の保険
    // --------------------
    if (candidates.length > 0) {
      if (bassHint) {
        // bassHintがある場合: ベース音が一致するものを最優先
        candidates.sort((a, b) => {
          const aMatch = getChordBass(a.chord) === bassHint;
          const bMatch = getChordBass(b.chord) === bassHint;
          if (aMatch && !bMatch) return -1; 
          if (!aMatch && bMatch) return 1;  
          return 0; 
        });
      } else if (rootHint) {
        // rootHintがある場合: ルート音が一致するものを最優先
        candidates.sort((a, b) => {
          const aMatch = getChordRoot(a.chord) === rootHint;
          const bMatch = getChordRoot(b.chord) === rootHint;
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
          return 0;
        });
      } else {
        // どちらのヒントも無い場合: 「/」を含まないもの（基本形）を強制的に最優先
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