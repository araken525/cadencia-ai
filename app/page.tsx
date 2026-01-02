"use client";

import { useMemo, useRef, useState } from "react";

// --- Types ---
type CandidateObj = {
  chord: string;
  base?: string;
  score?: number;
  root?: string;
  has7?: boolean;
  tensions?: string[];
  chordTones?: string[];
  extraTones?: string[];
  reason?: string | string[];
  chordType?: string; // ←追加（AIが返す想定）
  confidence?: number; // ←追加（AIが返す想定）
};

type AnalyzeRes = {
  status?: "ok" | "ambiguous" | "insufficient";
  engineChord?: string;
  confidence?: number;
  provisional?: boolean;
  keyHint?: string;
  candidates?: Array<CandidateObj>;
  analysis?: string;
  error?: string;
  notes?: string[];
};

type CandidateUI = {
  id: string;
  chord: string;
  chordType?: string;
  score?: number;
  confidenceLevel: number; // UI表示用 %
  reasonLines: string[];
  chordTones: string[];
  extraTones: string[];
};

// --- Helper ---
function normalizeCandidates(input: AnalyzeRes["candidates"]): CandidateUI[] {
  const arr = (input ?? []).filter(Boolean);

  return arr.map((c, idx) => {
    const chord = c.chord ?? "—";
    const chordType = c.chordType ?? "";

    // confidence: APIが0..1なら%へ。無ければ順位で仮
    let pct =
      typeof c.confidence === "number"
        ? Math.round(Math.max(0, Math.min(1, c.confidence)) * 100)
        : idx === 0
          ? 95
          : idx === 1
            ? 70
            : idx === 2
              ? 45
              : 20;

    // ちょい順位ペナルティ（見た目）
    pct = Math.max(0, pct - idx * 5);

    const reasonLines =
      Array.isArray(c.reason) ? c.reason :
      typeof c.reason === "string" ? [c.reason] :
      [];

    return {
      id: `c:${chord}:${idx}`,
      chord,
      chordType,
      score: c.score,
      confidenceLevel: pct,
      reasonLines,
      chordTones: (c.chordTones ?? []).filter(Boolean),
      extraTones: (c.extraTones ?? []).filter(Boolean),
    };
  });
}

// --- Helper: Visualizer Mapping ---
const getKeyIndex = (note: string): number => {
  const baseMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = note.charAt(0);
  const acc = note.slice(1);
  let idx = baseMap[base] ?? 0;
  if (acc === "#") idx += 1;
  if (acc === "b") idx -= 1;
  if (note === "E#") idx = 5;
  if (note === "B#") idx = 0;
  if (note === "Fb") idx = 4;
  if (note === "Cb") idx = 11;
  return (idx + 12) % 12;
};

const MiniPiano = ({ selected }: { selected: string[] }) => {
  const keys = [
    { idx: 0, type: "white", x: 0 },
    { idx: 1, type: "black", x: 10 },
    { idx: 2, type: "white", x: 14.28 },
    { idx: 3, type: "black", x: 24.28 },
    { idx: 4, type: "white", x: 28.56 },
    { idx: 5, type: "white", x: 42.84 },
    { idx: 6, type: "black", x: 52.84 },
    { idx: 7, type: "white", x: 57.12 },
    { idx: 8, type: "black", x: 67.12 },
    { idx: 9, type: "white", x: 71.4 },
    { idx: 10, type: "black", x: 81.4 },
    { idx: 11, type: "white", x: 85.68 },
  ];
  const activeIndices = selected.map(getKeyIndex);
  const isActive = (keyIdx: number) => activeIndices.includes(keyIdx);

  return (
    <div className="h-16 w-full max-w-[240px] mx-auto relative mt-2 mb-4 select-none pointer-events-none">
      <svg viewBox="0 0 100 60" className="w-full h-full drop-shadow-md">
        {keys.filter(k => k.type === "white").map((k) => (
          <rect
            key={k.idx}
            x={k.x}
            y="0"
            width="14.28"
            height="60"
            rx="2"
            ry="2"
            className={`transition-all duration-300 ${isActive(k.idx) ? "fill-[url(#activeKeyGradient)] stroke-indigo-300 stroke-[0.5]" : "fill-white stroke-slate-200 stroke-[0.5]"}`}
          />
        ))}
        {keys.filter(k => k.type === "black").map((k) => (
          <rect
            key={k.idx}
            x={k.x}
            y="0"
            width="8"
            height="38"
            rx="1"
            ry="1"
            className={`transition-all duration-300 ${isActive(k.idx) ? "fill-[url(#activeKeyGradient)] stroke-indigo-300 stroke-[0.5]" : "fill-slate-800 stroke-slate-900 stroke-[0.5]"}`}
          />
        ))}
        <defs>
          <linearGradient id="activeKeyGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

const FeedbackLink = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <a
    href="https://x.com/araken525_toho?s=21"
    target="_blank"
    rel="noopener noreferrer"
    className={className}
  >
    {children}
  </a>
);

// --- Flick Key Component ---
const FlickKey = ({
  noteBase,
  currentSelection,
  onInput,
}: {
  noteBase: string;
  currentSelection: string | undefined;
  onInput: (note: string) => void;
}) => {
  const [startY, setStartY] = useState<number | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const THRESHOLD = 15;

  const isActive = !!currentSelection;
  const displayLabel = currentSelection || noteBase;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    setStartY(e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startY === null) return;
    const delta = e.clientY - startY;
    setOffsetY(Math.max(-30, Math.min(30, delta)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startY === null) return;
    const delta = e.clientY - startY;

    if (delta < -THRESHOLD) onInput(`${noteBase}#`);
    else if (delta > THRESHOLD) onInput(`${noteBase}b`);
    else onInput(noteBase);

    setStartY(null);
    setOffsetY(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const isUp = offsetY < -10;
  const isDown = offsetY > 10;

  return (
    <div
      className={`
        relative h-14 rounded-2xl touch-none select-none overscroll-none
        transition-all duration-200 flex flex-col items-center justify-center overflow-hidden
        border border-white/40 shadow-sm backdrop-blur-md
        ${isActive
          ? "bg-gradient-to-br from-indigo-500/90 to-purple-500/90 text-white shadow-indigo-200 scale-[1.02]"
          : "bg-white/60 text-slate-700 active:bg-white/80 active:scale-95"}
      `}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className={`absolute top-1.5 text-[8px] font-bold transition-all ${isUp ? "opacity-100 text-white scale-110 -translate-y-0.5" : "opacity-30"}`}>#</div>
      <span className="text-xl font-bold transition-transform duration-100" style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
      <div className={`absolute bottom-1.5 text-[8px] font-bold transition-all ${isDown ? "opacity-100 text-white scale-110 translate-y-0.5" : "opacity-30"}`}>b</div>
    </div>
  );
};

export default function CadenciaPage() {
  const resultRef = useRef<HTMLDivElement>(null);

  const NOTE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];

  const [selected, setSelected] = useState<string[]>([]);
  const [engineChord, setEngineChord] = useState<string>("---");
  const [candidates, setCandidates] = useState<CandidateUI[]>([]);
  const [infoText, setInfoText] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  // ★追加：調性選択
  const KEY_OPTIONS = useMemo(() => ([
    { value: "none", label: "指定なし" },
    { value: "C major", label: "C major（ハ長調）" },
    { value: "G major", label: "G major（ト長調）" },
    { value: "D major", label: "D major（ニ長調）" },
    { value: "A major", label: "A major（イ長調）" },
    { value: "E major", label: "E major（ホ長調）" },
    { value: "B major", label: "B major（ロ長調）" },
    { value: "F# major", label: "F# major（嬰ヘ長調）" },
    { value: "C# major", label: "C# major（嬰ハ長調）" },
    { value: "F major", label: "F major（ヘ長調）" },
    { value: "Bb major", label: "Bb major（変ロ長調）" },
    { value: "Eb major", label: "Eb major（変ホ長調）" },
    { value: "Ab major", label: "Ab major（変イ長調）" },
    { value: "Db major", label: "Db major（変ニ長調）" },
    { value: "Gb major", label: "Gb major（変ト長調）" },
    { value: "Cb major", label: "Cb major（変ハ長調）" },

    { value: "A minor", label: "A minor（イ短調）" },
    { value: "E minor", label: "E minor（ホ短調）" },
    { value: "B minor", label: "B minor（ロ短調）" },
    { value: "F# minor", label: "F# minor（嬰ヘ短調）" },
    { value: "C# minor", label: "C# minor（嬰ハ短調）" },
    { value: "G# minor", label: "G# minor（嬰ト短調）" },
    { value: "D# minor", label: "D# minor（嬰ニ短調）" },
    { value: "A# minor", label: "A# minor（嬰イ短調）" },
    { value: "D minor", label: "D minor（ニ短調）" },
    { value: "G minor", label: "G minor（ト短調）" },
    { value: "C minor", label: "C minor（ハ短調）" },
    { value: "F minor", label: "F minor（ヘ短調）" },
    { value: "Bb minor", label: "Bb minor（変ロ短調）" },
    { value: "Eb minor", label: "Eb minor（変ホ短調）" },
    { value: "Ab minor", label: "Ab minor（変イ短調）" },
  ]), []);
  const [keyHint, setKeyHint] = useState<string>("none");

  const canAnalyze = selected.length >= 3;

  const handleNoteInput = (inputNote: string) => {
    const base = inputNote.charAt(0);
    const existingIndex = selected.findIndex(s => s.startsWith(base));
    const existingNote = selected[existingIndex];
    const nextSelected = [...selected];

    if (existingIndex !== -1) {
      if (existingNote === inputNote) nextSelected.splice(existingIndex, 1);
      else nextSelected[existingIndex] = inputNote;
    } else {
      nextSelected.push(inputNote);
    }
    setSelected(nextSelected);
  };

  const reset = () => {
    setSelected([]);
    setEngineChord("---");
    setCandidates([]);
    setInfoText("");
    setQuestion("");
    setAnswer("");
    setLoading(false);
    setIsThinking(false);
    setKeyHint("none");
  };

  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true);
    setAnswer("");
    setInfoText("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedNotes: selected, keyHint }),
      });

      const data: AnalyzeRes =
        res.headers.get("content-type")?.includes("json")
          ? await res.json()
          : { error: await res.text() };

      if (!res.ok) {
        setEngineChord("判定不能");
        setCandidates([]);
        setInfoText(`システムエラー: ${data?.error ?? "unknown"}`);
        return;
      }

      // engineChordはAPI側で補正済み（常に最有力が入る）
      setEngineChord((data.engineChord ?? "---").trim());

      setCandidates(normalizeCandidates(data.candidates));
      setInfoText((data.analysis ?? "").trim());

      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (e: any) {
      setEngineChord("Error");
      setInfoText(`通信エラー: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || loading || isThinking) return;

    // ★変更：判定不能でも質問できる（selectedが3音以上ならOK）
    if (selected.length < 3) {
      setAnswer("（音が3つ以上あると、質問に答えやすいです）");
      return;
    }

    setIsThinking(true);
    setAnswer("");

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ★変更：candidates/infoText/keyHintも渡す（回答の安定）
        body: JSON.stringify({
          selectedNotes: selected,
          engineChord,
          candidates: candidates.map(c => ({
            chord: c.chord,
            chordType: c.chordType,
            score: c.score,
            confidence: c.confidenceLevel / 100,
            chordTones: c.chordTones,
            extraTones: c.extraTones,
            reason: c.reasonLines.filter(Boolean).join(" / "),
          })),
          analysis: infoText,
          question: q,
          keyHint,
        }),
      });

      setAnswer(res.ok ? await res.text() : `エラー: ${await res.text()}`);
    } catch (e: any) {
      setAnswer(`通信エラー: ${e?.message}`);
    } finally {
      setIsThinking(false);
      setQuestion("");
    }
  }

  // --- Icons ---
  const IconSparkles = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
  const IconSend = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
  const IconRefresh = () => (
    <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
  const IconTrash = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );

  const G = {
    main: "bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500",
    textMain: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600",
    glass: "bg-white/70 backdrop-blur-xl border border-white/50 shadow-lg shadow-indigo-100/50",
  };

  const sortOrder = ["C","C#","Db","D","D#","Eb","E","F","F#","Gb","G","G#","Ab","A","A#","Bb","B"];
  const sortedSelected = [...selected].sort((a, b) => sortOrder.indexOf(a) - sortOrder.indexOf(b));

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[400px] selection:bg-purple-200">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-200/30 blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-fuchsia-200/20 blur-[120px]"></div>
      </div>

      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.glass} flex items-center justify-between px-5`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${G.main} flex items-center justify-center text-white shadow-md`}>
            <IconSparkles />
          </div>
          <div className="flex flex-col justify-center leading-none">
            <span className="text-[9px] font-bold text-indigo-400 tracking-widest mb-0.5">カデンツィア</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-black tracking-tight ${G.textMain}`}>Cadencia AI</span>
              <FeedbackLink className="bg-indigo-50 border border-indigo-100 text-[9px] font-bold text-indigo-500 px-1.5 py-0.5 rounded-md hover:bg-indigo-100 transition-colors">
                BETA
              </FeedbackLink>
            </div>
          </div>
        </div>

        {/* ★追加：調性セレクタ（コンパクト） */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400">調性</span>
          <select
            value={keyHint}
            onChange={(e) => setKeyHint(e.target.value)}
            className="text-[11px] bg-white/70 border border-slate-200 rounded-lg px-2 py-1 outline-none"
          >
            {KEY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-8 relative z-10">
        <section ref={resultRef} className={`${G.glass} rounded-3xl p-8 text-center`}>
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-lg">🎹</span>
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">判定結果</p>
          </div>

          {/* ★追加：暫定/調性バッジ（UI側はengineChordに影響しない） */}
          <div className="flex justify-center gap-2 mb-3 flex-wrap">
            {keyHint !== "none" && (
              <span className="px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-bold text-slate-600">
                Key: {keyHint}
              </span>
            )}
          </div>

          <div className={`text-5xl font-black tracking-tighter mb-4 ${engineChord === "---" ? "text-slate-300" : G.textMain}`}>
            {engineChord}
          </div>

          <MiniPiano selected={selected} />

          <div className="flex justify-center gap-2 flex-wrap min-h-[2rem] mt-4">
            {selected.length === 0 ? (
              <span className="text-xs text-slate-400 bg-slate-100/50 px-3 py-1 rounded-full animate-pulse">
                👇 下のボタンで音を選択
              </span>
            ) : (
              sortedSelected.map((note) => (
                <span
                  key={note}
                  className="px-3 py-1.5 bg-white border border-indigo-100 shadow-sm rounded-lg text-xs font-bold text-indigo-600"
                >
                  {note}
                </span>
              ))
            )}
          </div>
        </section>

        {/* analysis */}
        {infoText && (
          <section className={`${G.glass} rounded-3xl p-6`}>
            <h3 className={`text-xs font-bold mb-2 ${G.textMain}`}>Cadencia AI の考察</h3>
            <p className="text-sm leading-snug text-slate-700 whitespace-pre-wrap">{infoText}</p>
          </section>
        )}

        {/* candidates */}
        {candidates.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <span className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-indigo-200"></span>
              <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">その他の候補</span>
              <span className="h-[1px] flex-1 bg-gradient-to-r from-indigo-200 to-transparent"></span>
            </div>

            <div className="grid gap-3">
              {candidates.map((c, idx) => (
                <div key={c.id} className="bg-white/60 border border-white/60 shadow-sm rounded-2xl p-5">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="text-xl font-bold text-slate-700">{c.chord}</div>
                      {c.chordType && (
                        <div className="text-[10px] font-bold text-slate-400 mt-1">{c.chordType}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] text-slate-400 block">信頼度</span>
                      <span className="text-xs font-bold text-indigo-400">{c.confidenceLevel}%</span>
                    </div>
                  </div>
                  <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mt-3">
                    <div className={`h-full ${G.main}`} style={{ width: `${c.confidenceLevel}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ask */}
        <section className={`${G.glass} rounded-3xl p-1 overflow-hidden`}>
          <div className="bg-white/40 rounded-[20px] p-5">
            <h3 className={`text-sm font-bold ${G.textMain}`}>Cadencia AI に質問する</h3>

            {answer && (
              <div className="mt-3 bg-white/80 border border-indigo-100 rounded-2xl p-4 text-sm text-slate-700 whitespace-pre-wrap">
                {answer}
              </div>
            )}

            {isThinking && (
              <div className="mt-3 text-xs text-indigo-300 font-bold">AIが考え中...</div>
            )}

            <div className="relative mt-4">
              <input
                className="w-full bg-white border border-indigo-100 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/50 transition-all shadow-sm placeholder:text-slate-300"
                placeholder="例：この和音は何の機能になりやすい？"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                disabled={isThinking}
              />
              <button
                onClick={ask}
                disabled={loading || isThinking || !question.trim()}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white transition-all active:scale-90 ${!question.trim() ? "bg-slate-200 text-slate-400" : `${G.main} shadow-md`}`}
              >
                <IconSend />
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Bottom controls */}
      <div className={`fixed bottom-0 inset-x-0 z-50 ${G.glass} rounded-t-[30px] pt-4 pb-8`}>
        <div className="max-w-md mx-auto px-4 flex">
          <div className="grid grid-cols-3 gap-2 flex-1 mr-2">
            {NOTE_KEYS.map((noteBase) => {
              const currentSelection = selected.find(s => s.startsWith(noteBase));
              return (
                <FlickKey
                  key={noteBase}
                  noteBase={noteBase}
                  currentSelection={currentSelection}
                  onInput={handleNoteInput}
                />
              );
            })}
            <div className="col-span-2 relative h-14 rounded-2xl border border-white/40 bg-white/40 backdrop-blur-md flex items-center justify-center gap-3 text-[9px] text-slate-400 font-medium select-none shadow-sm">
              <div className="flex flex-col items-center"><span className="text-[8px] font-bold text-indigo-400">#</span><span>↑</span></div>
              <div className="w-[1px] h-6 bg-slate-300/50"></div>
              <div className="flex flex-col items-center"><span className="text-[8px] font-bold text-slate-500">Nat</span><span>●</span></div>
              <div className="w-[1px] h-6 bg-slate-300/50"></div>
              <div className="flex flex-col items-center"><span className="text-[8px] font-bold text-purple-400">b</span><span>↓</span></div>
            </div>
          </div>

          <div className="flex flex-col w-[25%] gap-2">
            <button
              onClick={reset}
              className="h-14 rounded-2xl bg-white/60 border border-white/60 text-slate-400 active:text-red-500 active:border-red-200 active:bg-red-50 transition-all flex items-center justify-center shadow-sm active:scale-95"
            >
              <IconTrash />
            </button>

            <div className="flex-1" />

            <button
              onClick={analyze}
              disabled={!canAnalyze || loading}
              className={`
                h-28 rounded-2xl flex flex-col items-center justify-center shadow-lg transition-all active:scale-95 border border-white/20
                ${canAnalyze && !loading ? `${G.main} text-white shadow-indigo-300/50` : "bg-slate-100 text-slate-300 cursor-not-allowed"}
              `}
            >
              {loading ? <IconRefresh /> : <span className="text-2xl">→</span>}
              <span className="text-[10px] font-bold mt-1">判定</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}