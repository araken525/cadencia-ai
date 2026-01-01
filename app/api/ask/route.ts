import { NextResponse } from "next/server";

// --- same normalize for consistency ---
function normalizeAccidentals(s: string) {
  return (s ?? "")
    .trim()
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "##");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const selectedNotes: string[] = Array.isArray(body?.selectedNotes) ? body.selectedNotes : [];
    const engineChord: string = typeof body?.engineChord === "string" ? body.engineChord : "---";
    const question: string = typeof body?.question === "string" ? body.question.trim() : "";

    if (!question) {
      return new NextResponse("質問が空です", { status: 400 });
    }

    const normalizedNotes = selectedNotes.map(normalizeAccidentals);

    // -----------------------------
    // ✅ ここから下：あなたのLLM実装に置き換える想定
    // -----------------------------
    // 例：プロンプトだけ用意して、既存のOpenAI呼び出しに渡す
    const prompt = `
あなたは音楽理論の先生です。以下の情報を踏まえて、質問に日本語でわかりやすく答えてください。
- 入力音: ${normalizedNotes.join(", ")}
- 判定されたコード: ${engineChord}

質問:
${question}

回答の方針:
- まず結論を1行
- 次に理由を短く（和音構成音・機能・よくある誤解）
- 最後に「この入力ならこう考える」具体例を1つ
`.trim();

    // ✅ とりあえず動く返答（LLM未接続でもUI確認できる）
    // 本番は prompt を LLM に投げて、その出力を返す
    const dummy = [
      "（デモ応答）",
      `入力音: ${normalizedNotes.join(", ")}`,
      `判定コード: ${engineChord}`,
      "",
      "質問に答えるには、/api/ask を LLM 接続してください。",
      "",
      "プロンプト例:",
      prompt.slice(0, 600) + (prompt.length > 600 ? "..." : ""),
    ].join("\n");

    return new NextResponse(dummy, { status: 200 });

  } catch (e: any) {
    return new NextResponse(`エラー: ${e?.message ?? "Unknown error"}`, { status: 500 });
  }
}