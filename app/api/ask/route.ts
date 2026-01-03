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

function asNoteOrNull(x: any): string | null {
  if (typeof x !== "string") return null;
  const n = normalizeAccidentals(x);
  if (!/^[A-G]((?:bb|b|##|#)?)$/.test(n)) return null;
  return n;
}

// ============================================================
// 共通の特殊和音ロジック（Analyzeと完全に一致させる）
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
7. **準固有和音 (Moll-Dur):** 長調設定(keyHint=Major)で、同主短調の和音（IVm, bVIなど）が使われた場合。解説では「準固有和音（モル・ドゥア）」と言及し、記号は左上に○を付した形（本システムでは **°VI** 等）で扱う。
8. **ドッペル・ドミナント:** 属和音(V)の完全5度上に位置するII（長三和音またはII7）。「VのV」としての推進力に言及する。
9. **根音省略の属九:** 減七の和音は、機能的には「根音省略の属九（V₉）」としてD機能を持つとみなす。
10. **Iの付加6:** ポピュラーではI6だが、芸大和声ではVIの七の第1転回形（VI₇¹）として扱うことが多い。
11. **導七の和音:** 短調のVIIまたは長調の減5短7を持つ和音。減七と区別し、穏やかなD機能を持つとする。
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

${SPECIAL_CHORD_RULES}

【回答モード】
- 一般論は定義を簡潔に。
- 入力音については、属和音（D）や第7音の**「解決（進行方向）」**を必ず指摘すること。
`.trim();
}

// ============================================================
// Prompt: Beginner (親切・中高生/初心者向け)
// ============================================================
function buildBeginnerSystemPrompt() {
  return `
あなたは吹奏楽部や合唱部の中高生にも分かりやすく和声（ハーモニー）を教える、親切な音楽の先生です。
専門的な判定は「芸大和声」に基づいて正確に保ちつつ、言葉選びは優しく、噛み砕いて説明してください。

【回答のスタイル：最重要】
- **Markdown記法は禁止です。プレーンテキストのみで出力してください。**
- 口調は**「〜ですね」「〜ですよ」**といった丁寧語（です・ます調）を使ってください。
- 難しい専門用語が出たときは、簡単な補足を付け加えてください。

【用語・言語の指定】
- 調の名前は「ハ長調（C-dur）」「イ短調（a-moll）」のように、日本語をメインにしつつドイツ語も添えて慣れさせてあげてください。
- 「Key」ではなく「調」と言ってください。

${SPECIAL_CHORD_RULES}

【わかりやすい解説のコツ】
- **判定ロジックの適用:** 上記の「特殊和音判定辞書」に該当する場合は、ロジック自体はそれに従ってください（例: IV6ならII7の1転回形とみなす）。
- **説明の変換:** ただし、説明する際は難しくなりすぎないようにしてください。
  - **準固有和音:** 「切ない響きがする『準固有和音（モル・ドゥア）』ですね。専門的には左上に丸（°）をつけて表します」と伝える。
  - **IVの付加6:** 「ポピュラーではIV6ですが、クラシックの理論では『IIの七』の仲間として扱うことが多いですよ」と教える。
  - **解決:** 「この音は不安定なので、隣の〇〇の音に進みたがっています（解決）」のように表現する。
  - **属七（V7）:** 「ドキドキする響き」「トニック（I）に戻りたくなる響き」と伝える。
`.trim();
}

function buildUserPrompt(params: {
  notes: string[];
  question: string;
  bassHint: string | null;
  rootHint: string | null;
  keyHint: string | null;
  engineChord: string | null;
  candidates: string[] | null;
}) {
  const keyLine = params.keyHint ? params.keyHint : "（指定なし）";
  const bassLine = params.bassHint ? params.bassHint : "（指定なし）";
  const rootLine = params.rootHint ? params.rootHint : "（指定なし）";
  
  const engineLine = params.engineChord ? params.engineChord : "（未提供）";
  const candLine = params.candidates && params.candidates.length > 0 
    ? params.candidates.join(", ") 
    : "（なし）";

  return `
【生徒の状況】
- 音: ${params.notes.join(", ")}
- 指定: Bass=${bassLine}, Root=${rootLine}, 調=${keyLine}
- AI判定: ${engineLine} (他: ${candLine})

【生徒の質問】
${params.question}

【回答への指示】
- プレーンテキストで答えてください。
- 和音名は「C」や「Cm」のように記述してください。
`.trim();
}

// -------------------- Route --------------------
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // ★ モード判定
    const mode = (body?.mode === "beginner") ? "beginner" : "expert";

    const selectedNotesRaw: any[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const question = typeof body?.question === "string" ? body.question.trim() : "";

    const keyHint = typeof body?.keyHint === "string" && body.keyHint.trim() ? body.keyHint.trim() : null;
    const engineChord = typeof body?.engineChord === "string" && body.engineChord.trim() ? body.engineChord.trim() : null;
    const candidatesIn = Array.isArray(body?.candidates) ? body.candidates : null;
    const candidates = candidatesIn?.map((x: any) => (typeof x === "string" ? x : x?.chord))
        .filter((x: any) => typeof x === "string" && x.trim())
        .slice(0, 10) ?? null;

    const normalized = selectedNotesRaw
      .map((x) => (typeof x === "string" ? normalizeAccidentals(x) : ""))
      .filter(Boolean)
      .filter((n) => /^[A-G]((?:bb|b|##|#)?)$/.test(n));

    const notesSorted = uniq(normalized).sort(sortSpelling);
    const bassHintRaw = asNoteOrNull(body?.bassHint);
    const bassHint = bassHintRaw && notesSorted.includes(bassHintRaw) ? bassHintRaw : null;
    const rootHintRaw = asNoteOrNull(body?.rootHint);
    const rootHint = rootHintRaw && notesSorted.includes(rootHintRaw) ? rootHintRaw : null;

    if (!question) {
      return new NextResponse("質問が空です。", { status: 400 });
    }
    if (!model) {
      return new NextResponse("（AI未接続）GEMINI_API_KEY が未設定です。", { status: 500 });
    }

    // ★ モードに応じてプロンプトを切り替え
    const system = mode === "beginner" ? buildBeginnerSystemPrompt() : buildExpertSystemPrompt();
    
    const user = buildUserPrompt({
      notes: notesSorted,
      question,
      bassHint,
      rootHint,
      keyHint,
      engineChord,
      candidates,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: user }] }],
      systemInstruction: system,
      generationConfig: { temperature: 0.3 },
    });

    const text = result.response.text()?.trim() || "（回答を生成できませんでした）";

    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: any) {
    return new NextResponse(`エラー: ${e?.message ?? "Unknown error"}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}