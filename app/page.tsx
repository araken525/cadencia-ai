"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants ---
const G = {
  // Apple Intelligence風 究極のオーロラグラデーション
  aurora: "bg-gradient-to-r from-blue-500 via-purple-500 via-pink-500 to-amber-400 bg-[length:300%_300%] animate-aurora-shift",
  auroraText: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 animate-aurora-text",
  // 透明感のある極薄ガラス
  glassBase: "bg-white/40 backdrop-blur-2xl border border-white/40 shadow-xl shadow-indigo-500/5",
  glassHigh: "bg-white/60 backdrop-blur-3xl border border-white/50 shadow-2xl shadow-purple-500/10",
  // キーボード用（さらに透明度を高く）
  glassKey: "bg-white/30 backdrop-blur-xl border border-white/20 shadow-sm active:bg-white/50 transition-all",
};

const NOTE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];
const KEYS_ROOT = ["none", "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
const KEYS_TYPE = ["Major", "Minor"];
const SORT_ORDER = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

// --- Types ---
type CandidateObj = {
  chord: string;
  chordType?: string;
  inversion?: "root" | "1st" | "2nd" | "3rd" | "unknown";
  bass?: string;
  romanNumeral?: string;
  tds?: "T" | "D" | "S" | "SD" | "?";
  score: number;
  confidence: number;
  chordTones: string[];
  extraTones: string[];
  reason: string;
  provisional?: boolean;
};

type AnalyzeRes = {
  engineChord?: string;
  candidates?: CandidateObj[];
  analysis?: string;
  reason?: string;
  error?: string;
};

// --- Helper Functions ---
function normalizeCandidates(input: AnalyzeRes["candidates"]): CandidateObj[] {
  const arr = (input ?? []).filter(Boolean);
  return arr.map((c, idx) => {
    let rawScore = c.score ?? (c.confidence ? c.confidence * 100 : 0);
    if (!rawScore && idx === 0) rawScore = 95;
    return {
      ...c,
      score: Math.min(100, Math.max(0, Math.round(rawScore))),
      confidence: c.confidence ?? (rawScore / 100),
    };
  });
}

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

// --- Components ---

const FeedbackLink = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <a href="https://x.com/araken525_toho?s=21" target="_blank" rel="noopener noreferrer" className={className}>
    {children}
  </a>
);

// 1. Mini Piano (Integrated Design)
const MiniPiano = ({ selected, bassHint, rootHint }: { selected: string[], bassHint: string | null, rootHint: string | null }) => {
  const keys = [
    { idx: 0, type: "white", x: 0 }, { idx: 1, type: "black", x: 10 },
    { idx: 2, type: "white", x: 14.28 }, { idx: 3, type: "black", x: 24.28 },
    { idx: 4, type: "white", x: 28.56 }, { idx: 5, type: "white", x: 42.84 },
    { idx: 6, type: "black", x: 52.84 }, { idx: 7, type: "white", x: 57.12 },
    { idx: 8, type: "black", x: 67.12 }, { idx: 9, type: "white", x: 71.4 },
    { idx: 10, type: "black", x: 81.4 }, { idx: 11, type: "white", x: 85.68 },
  ];
  const activeIndices = selected.map(getKeyIndex);
  const isActive = (keyIdx: number) => activeIndices.includes(keyIdx);
  const isBass = (keyIdx: number) => bassHint ? getKeyIndex(bassHint) === keyIdx : false;
  const isRoot = (keyIdx: number) => rootHint ? getKeyIndex(rootHint) === keyIdx : false;

  return (
    <div className="h-16 w-full relative select-none pointer-events-none">
       <svg viewBox="0 0 100 50" className="w-full h-full drop-shadow-md">
         {/* Keys are drawn directly without borders to blend into the card */}
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v46 a4,4 0 0 1 -4,4 h-6.28 a4,4 0 0 1 -4,-4 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-400" : isBass(k.idx) ? "fill-amber-400" : "fill-indigo-400") 
                 : "fill-white/40"
             } stroke-white/50 stroke-[0.5]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 a2,2 0 0 1 -2,2 h-4 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-600" : isBass(k.idx) ? "fill-amber-600" : "fill-indigo-600") 
                 : "fill-slate-800/80"
             }`} />
         ))}
       </svg>
    </div>
  );
};

// 2. Flick Key (Translucent Design)
const FlickKey = ({ 
  noteBase, currentSelection, isBass, isRoot, onInput, className
}: { 
  noteBase: string, currentSelection: string | undefined, isBass: boolean, isRoot: boolean,
  onInput: (n: string, type: "flick" | "tap") => void, className?: string
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
    if (startY !== null) {
      const delta = e.clientY - startY;
      if (delta < -THRESHOLD) onInput(`${noteBase}#`, "flick");
      else if (delta > THRESHOLD) onInput(`${noteBase}b`, "flick");
      else onInput(noteBase, "tap");
    }
    setStartY(null); setOffsetY(0);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const isUp = offsetY < -10;
  const isDown = offsetY > 10;

  return (
    <div className={`
      relative rounded-2xl touch-none select-none overflow-visible flex flex-col items-center justify-center transition-all duration-300 z-0
      ${isRoot ? "ring-1 ring-rose-400/50 bg-rose-50/40 backdrop-blur-md shadow-[0_0_15px_rgba(244,63,94,0.3)]" 
        : isBass ? "ring-1 ring-amber-400/50 bg-amber-50/40 backdrop-blur-md shadow-[0_0_15px_rgba(251,191,36,0.3)]" 
        : G.glassKey}
      ${!isBass && !isRoot && isActive ? "bg-white/60 shadow-[0_0_15px_rgba(129,140,248,0.4)]" : ""}
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* Guide Indicators */}
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all duration-300 ${isUp ? "opacity-100 -translate-y-1 text-indigo-500 scale-125" : "opacity-20 text-slate-500"}`}>
        <span className="text-[8px] font-bold leading-none">♯</span>
      </div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all duration-300 ${isDown ? "opacity-100 translate-y-1 text-indigo-500 scale-125" : "opacity-20 text-slate-500"}`}>
        <span className="text-[8px] font-bold leading-none">♭</span>
      </div>

      {/* Status Indicators */}
      {isRoot && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.8)] animate-pulse" />}
      {isBass && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_5px_rgba(251,191,36,0.8)] animate-pulse" />}
      
      {/* Label */}
      <span className={`text-2xl font-medium tracking-tight transition-all duration-200 ${isRoot ? "text-rose-600 drop-shadow-sm" : isBass ? "text-amber-600 drop-shadow-sm" : "text-slate-700/90"}`} 
        style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
    </div>
  );
};

// 3. Result Card (Updated)
const ResultCard = ({ candidate, isTop, isKeySet }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;
  const invMap: Record<string, string> = { "root": "基本形", "1st": "第1転回", "2nd": "第2転回", "3rd": "第3転回", "unknown": "不明" };
  const invJp = invMap[candidate.inversion || "unknown"] || "―";

  return (
    <div className={`relative overflow-hidden transition-all duration-700 group animate-in slide-in-from-bottom-4 fade-in
      ${isTop 
        ? "bg-white/80 backdrop-blur-3xl border border-white/60 shadow-[0_10px_40px_-10px_rgba(100,100,255,0.2)] rounded-[32px] p-6" 
        : "bg-white/40 backdrop-blur-md border border-white/40 shadow-sm rounded-2xl p-4 active:bg-white/60"}
    `}>
      {/* Dynamic Background for Top Rank */}
      {isTop && <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 via-purple-50/30 to-pink-50/50 pointer-events-none" />}
      
      <div className={`absolute -right-4 -bottom-8 font-black text-indigo-900/5 select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-9xl" : "text-7xl"}`}>
        {String(isTop ? 1 : 2).padStart(2, '0')}
      </div>

      <div className="relative z-10 flex flex-col gap-4">
        {/* Header Section */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {isTop && (
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide border shadow-sm ${isProvisional ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-indigo-600 text-white border-indigo-500 shadow-indigo-200"}`}>
                  {isProvisional ? "⚠️ 暫定判定" : "🏆 判定結果"}
                </span>
              )}
              {candidate.chordType && (
                <span className={`px-3 py-0.5 rounded-full text-[10px] font-bold border border-white/50 shadow-sm ${isTop ? "bg-gradient-to-r from-indigo-100/80 to-purple-100/80 text-indigo-700" : "bg-slate-100/80 text-slate-500"}`}>
                  {candidate.chordType}
                </span>
              )}
            </div>
            <h2 className={`font-black text-slate-800 tracking-tighter leading-none ${isTop ? "text-5xl drop-shadow-sm" : "text-2xl"}`}>
              {candidate.chord}
            </h2>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Confidence</span>
            <span className={`font-black ${isTop ? "text-3xl text-transparent bg-clip-text bg-gradient-to-br from-indigo-500 to-purple-600" : "text-sm text-indigo-400"}`}>{percent}<span className="text-xs opacity-50">%</span></span>
          </div>
        </div>

        {/* Function Analysis Grid */}
        {isKeySet ? (
          <div className="bg-white/50 rounded-2xl p-1.5 border border-white/50 shadow-inner grid grid-cols-12 gap-1.5">
            {/* Function (TDS) */}
            <div className="col-span-4 bg-white/80 rounded-xl border border-white flex flex-col items-center justify-center py-2 shadow-sm">
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">和音の機能</span>
              <span className={`text-3xl font-black leading-none ${
                candidate.tds === "T" ? "text-cyan-500 drop-shadow-sm" : 
                candidate.tds === "D" ? "text-rose-500 drop-shadow-sm" : 
                candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-500 drop-shadow-sm" : "text-slate-300"
              }`}>
                {candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds}
              </span>
            </div>
            {/* Details */}
            <div className="col-span-8 flex flex-col gap-1.5">
               <div className="flex-1 bg-white/80 rounded-xl border border-white flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[9px] font-bold text-slate-400">和音記号</span>
                  <span className="text-lg font-serif font-black text-slate-700">{candidate.romanNumeral || "―"}</span>
               </div>
               <div className="flex-1 bg-white/80 rounded-xl border border-white flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[9px] font-bold text-slate-400">転回形</span>
                  <span className="text-xs font-bold text-slate-600">{invJp}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
            <span className="text-[10px] font-bold text-slate-400 flex items-center justify-center gap-1">
              <span>🔑 Keyを指定すると機能分析(TDS)が表示されます</span>
            </span>
          </div>
        )}

        {/* Confidence Bar */}
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-1000 ease-out ${isTop ? G.aurora : "bg-slate-300"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
};

// 4. Insight Card (AI Thinking)
const InsightCard = ({ text }: { text: string }) => (
  <div className="relative rounded-[32px] p-[2px] overflow-hidden group">
    <div className={`absolute inset-0 ${G.aurora} opacity-30 group-hover:opacity-50 transition-opacity`}></div>
    <div className="bg-white/90 backdrop-blur-3xl rounded-[30px] p-6 relative z-10 border border-white/60 shadow-xl">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow-md relative overflow-hidden`}>
           <div className={`absolute inset-0 ${G.aurora}`}></div>
           <IconSparkles className="relative z-10 w-4 h-4" />
        </div>
        <h3 className={`text-sm font-bold ${G.auroraText}`}>Cadencia AI の考察</h3>
      </div>
      <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">{text}</p>
    </div>
  </div>
);

// 5. Ask Card
const AskCard = ({ question, setQuestion, ask, isThinking, loading }: any) => (
  <div className={`relative rounded-[32px] overflow-hidden ${G.glassBase} p-1 transition-all`}>
    <div className="bg-white/60 backdrop-blur-xl rounded-[30px] p-6">
      <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
        <span className="text-xl">💬</span> Cadencia AIにこの和音について質問する
      </h3>
      <div className="relative group">
        <input 
          className="w-full bg-white/80 border border-indigo-100/50 rounded-2xl py-4 pl-5 pr-14 text-base focus:outline-none focus:ring-2 focus:ring-purple-400/30 transition-all shadow-inner placeholder:text-slate-400 text-slate-700" 
          placeholder="例：なぜこの機能になるの？" 
          value={question} 
          onChange={(e) => setQuestion(e.target.value)} 
          onKeyDown={(e) => e.key === 'Enter' && ask()} 
          disabled={isThinking} 
        />
        <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-xl text-white transition-all active:scale-90 shadow-md ${!question.trim() ? "bg-slate-200 text-slate-400" : `${G.aurora}`}`}>
          <IconSend className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);

// 6. Loading Overlay
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white/30 backdrop-blur-md animate-in fade-in duration-300">
    <div className="relative w-32 h-32">
      {/* Orb */}
      <div className={`absolute inset-0 rounded-full ${G.aurora} blur-2xl animate-pulse`}></div>
      <div className="absolute inset-2 bg-white/80 rounded-full backdrop-blur-xl flex items-center justify-center shadow-inner">
         <IconSparkles className="w-10 h-10 text-indigo-500 animate-spin-slow" />
      </div>
    </div>
    <div className="mt-8 text-center space-y-2">
      <h2 className={`text-xl font-black ${G.auroraText}`}>Analyzing Harmony...</h2>
      <p className="text-xs font-bold text-slate-400 tracking-widest animate-pulse">音楽理論AIが解析中</p>
    </div>
  </div>
);

// --- Main Page ---
export default function CadenciaPage() {
  const resultRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // State
  const [selected, setSelected] = useState<string[]>([]);
  const [keyRoot, setKeyRoot] = useState<string>("none"); 
  const [keyType, setKeyType] = useState<string>("Major"); 
  const [bassHint, setBassHint] = useState<string | null>(null); 
  const [rootHint, setRootHint] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"normal" | "root" | "bass">("normal");

  const [candidates, setCandidates] = useState<CandidateObj[]>([]);
  const [infoText, setInfoText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);

  const canAnalyze = selected.length >= 3;
  const isKeySet = keyRoot !== "none";

  const sortedSelected = useMemo(() => {
    return [...selected].sort((a, b) => SORT_ORDER.indexOf(a) - SORT_ORDER.indexOf(b));
  }, [selected]);

  const handleKeyInput = (inputNote: string, type: "flick" | "tap") => {
    const base = inputNote.charAt(0);
    const existingIndex = selected.findIndex(s => s.startsWith(base));
    let nextSelected = [...selected];

    const updateSelection = () => {
      if (existingIndex !== -1) {
        if (selected[existingIndex] === inputNote && type === "tap") {
          nextSelected.splice(existingIndex, 1);
          if (bassHint?.startsWith(base)) setBassHint(null);
          if (rootHint?.startsWith(base)) setRootHint(null);
        } else {
          nextSelected[existingIndex] = inputNote;
          if (bassHint?.startsWith(base)) setBassHint(inputNote);
          if (rootHint?.startsWith(base)) setRootHint(inputNote);
        }
      } else {
        nextSelected.push(inputNote);
      }
      setSelected(nextSelected);
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 300);
    };

    if (inputMode === "root") {
      if (existingIndex === -1) {
        nextSelected.push(inputNote);
        setSelected(nextSelected);
      } else {
        nextSelected[existingIndex] = inputNote;
        setSelected(nextSelected);
      }
      if (rootHint === inputNote) {
        setRootHint(null);
      } else {
        setRootHint(inputNote);
        if (bassHint === inputNote) setBassHint(null);
      }
      setInputMode("normal");

    } else if (inputMode === "bass") {
      if (existingIndex === -1) {
        nextSelected.push(inputNote);
        setSelected(nextSelected);
      } else {
        nextSelected[existingIndex] = inputNote;
        setSelected(nextSelected);
      }
      if (bassHint === inputNote) {
        setBassHint(null);
      } else {
        setBassHint(inputNote);
        if (rootHint === inputNote) setRootHint(null);
      }
      setInputMode("normal");

    } else {
      updateSelection();
    }
  };

  const reset = () => {
    setSelected([]); setCandidates([]); setBassHint(null); setRootHint(null);
    setInfoText(""); setQuestion(""); setAnswer(""); setLoading(false); setInputMode("normal");
  };

  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true); setAnswer(""); setInfoText("");
    const keyHint = keyRoot === "none" ? "none" : `${keyRoot} ${keyType}`;
    try {
      // 演出のためのウェイト（AI感）
      await new Promise(r => setTimeout(r, 1200));
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedNotes: selected, keyHint, bassHint, rootHint }),
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : { error: await res.text() };
      if (!res.ok) { setCandidates([]); setInfoText(`システムエラー: ${data?.error}`); return; }
      setCandidates(normalizeCandidates(data.candidates));
      setInfoText((data.analysis ?? data.reason ?? "").trim());
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: any) { setInfoText(`通信エラー: ${e?.message}`); } finally { setLoading(false); }
  }

  async function ask() {
    const q = question.trim();
    if (!q || loading || isThinking) return;
    if (!canAnalyze || candidates.length === 0) { setAnswer("（コードを確定させてから質問してね）"); return; }
    setIsThinking(true); setAnswer("");
    const topChord = candidates[0].chord;
    const keyHint = keyRoot === "none" ? "none" : `${keyRoot} ${keyType}`;
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          selectedNotes: selected, engineChord: topChord, question: q, 
          bassHint, rootHint, keyHint, candidates: candidates.slice(0,5) 
        }),
      });
      setAnswer(res.ok ? await res.text() : `エラー: ${await res.text()}`);
    } catch (e: any) { setAnswer(`通信エラー: ${e?.message}`); } finally { setIsThinking(false); setQuestion(""); }
  }

  // --- Render ---
  const hasResult = candidates.length > 0;
  const topCandidate = hasResult ? candidates[0] : null;
  const otherCandidates = hasResult ? candidates.slice(1) : [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[420px] selection:bg-purple-200 overflow-x-hidden">
      
      <style jsx global>{`
        @keyframes aurora-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes aurora-text {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-aurora-shift { animation: aurora-shift 6s ease infinite; }
        .animate-aurora-text { animation: aurora-text 3s ease infinite; background-size: 200% 200%; }
        .animate-spin-slow { animation: spin 3s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Dynamic Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-indigo-200/40 blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] rounded-full bg-fuchsia-200/30 blur-[120px]"></div>
      </div>

      {/* Loading Overlay */}
      {loading && <LoadingOverlay />}

      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.glassBase} flex items-center justify-between px-5 transition-all`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg ring-1 ring-white/50 relative group">
             <div className={`absolute inset-0 ${G.aurora} opacity-80 group-hover:opacity-100 transition-opacity`}></div>
             <div className="absolute inset-0 flex items-center justify-center text-white"><IconSparkles className="w-5 h-5" /></div>
          </div>
          <div className="flex flex-col justify-center leading-none">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-lg font-black tracking-tight ${G.auroraText} drop-shadow-sm`}>Cadencia AI</span>
              <FeedbackLink className="bg-indigo-50 border border-indigo-100 text-[8px] font-bold text-indigo-500 px-1.5 py-0.5 rounded-md hover:bg-indigo-100 transition-colors flex items-center gap-1">
                <span>BETA</span><IconTwitter />
              </FeedbackLink>
            </div>
            <span className="text-[10px] font-bold text-slate-400/80 tracking-wide">ポケットに、専属音楽理論家を。</span>
          </div>
        </div>
      </header>

      <main className="pt-28 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* Hero */}
        {!hasResult && (
          <section className="text-center space-y-4 animate-in fade-in zoom-in duration-700 py-4">
            <div className="inline-block relative">
               <span className="block text-[11px] font-bold text-indigo-400 tracking-[0.2em] mb-2 uppercase">音楽理論AIアシスタント</span>
               <h1 className={`text-6xl font-black tracking-tighter ${G.auroraText} pb-2`}>Cadencia</h1>
            </div>
            <p className="text-sm font-medium text-slate-500 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gradient-to-r from-fuchsia-400 to-indigo-400 animate-pulse"></span>
              ポケットに、専属音楽理論家を。
            </p>
          </section>
        )}

        {/* Input Monitor Card */}
        <section className={`${G.glassHigh} rounded-[32px] p-1 overflow-hidden transition-all duration-300 ${justUpdated ? "ring-2 ring-indigo-300 ring-offset-2 ring-offset-transparent" : ""}`}>
           <div className="bg-white/40 backdrop-blur-xl rounded-[30px] p-5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <IconKeyboard className="w-4 h-4" /> Cadencia AIに分析させる和音を入力
              </h3>
              
              {/* Selected Notes Chips */}
              <div className="flex flex-wrap gap-2 mb-4 min-h-[2rem]">
                {selected.length === 0 ? (
                  <span className="text-xs text-slate-400 italic pl-1">鍵盤を弾いて音を追加...</span>
                ) : (
                  sortedSelected.map((note) => (
                    <span key={note} className={`px-3 py-1.5 border shadow-sm rounded-xl text-xs font-bold animate-in zoom-in duration-200 backdrop-blur-md ${
                      rootHint === note 
                        ? "bg-rose-50/80 border-rose-200 text-rose-600 shadow-rose-100" 
                        : bassHint === note 
                          ? "bg-amber-50/80 border-amber-200 text-amber-600 shadow-amber-100" 
                          : "bg-white/60 border-white/50 text-indigo-600"
                    }`}>
                      {note}
                      {rootHint === note && <span className="ml-1.5 text-[9px] bg-rose-200/50 px-1 rounded-md text-rose-700">根音</span>}
                      {bassHint === note && <span className="ml-1.5 text-[9px] bg-amber-200/50 px-1 rounded-md text-amber-700">最低音</span>}
                    </span>
                  ))
                )}
              </div>

              {/* Integrated Piano */}
              <div className="pt-2 border-t border-white/30">
                 <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
              </div>
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
             
             {/* Title */}
             <div className="flex items-center gap-2 px-2">
               <div className={`w-1.5 h-6 rounded-full ${G.aurora}`}></div>
               <h2 className="text-lg font-bold text-slate-800">Cadencia AIの分析結果</h2>
             </div>

             {/* Top Result */}
             {topCandidate && <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />}

             {/* Insight */}
             {infoText && <InsightCard text={infoText} />}

             {/* Other Candidates */}
             {otherCandidates.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center gap-3 px-2 py-2">
                   <div className="h-[1px] flex-1 bg-slate-300/50"></div>
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">その他の候補</span>
                   <div className="h-[1px] flex-1 bg-slate-300/50"></div>
                 </div>
                 {otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}
               </div>
             )}

             {/* Ask AI */}
             <div className="pt-4 pb-8">
               {answer && (
                 <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                   <div className="bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-100 rounded-[24px] rounded-tl-none p-5 text-sm text-slate-700 leading-relaxed shadow-inner relative">
                     <span className="absolute -top-3 -left-2 text-2xl filter drop-shadow-sm">🤖</span>
                     <div className="pl-2">{answer}</div>
                   </div>
                 </div>
               )}
               <AskCard question={question} setQuestion={setQuestion} ask={ask} isThinking={isThinking} loading={loading} />
             </div>
          </div>
        )}

      </main>

      {/* --- Floating Glass Keyboard --- */}
      <div className={`fixed bottom-0 inset-x-0 z-50 ${G.glassKey} rounded-t-[36px] pt-5 pb-8 shadow-[0_-10px_50px_rgba(0,0,0,0.05)] transition-transform duration-300 backdrop-blur-2xl`}>
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-4 grid-rows-4 gap-2.5 h-full">
            
            {/* Row 1 */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-2xl bg-white/40 border border-white/30 text-slate-400 active:text-red-500 active:bg-red-50/50 transition-all flex items-center justify-center shadow-sm active:scale-95 hover:bg-white/60" onClick={reset}><IconTrash /></button>

            {/* Row 2 */}
            <FlickKey className="col-start-1 row-start-2" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} onInput={handleKeyInput} />

            {/* Row 3: Mode & Key */}
            <div className="col-start-1 row-start-3 h-14 flex flex-col gap-1.5">
               <button onClick={() => setInputMode(m => m === "root" ? "normal" : "root")} className={`flex-1 rounded-xl text-[10px] font-bold transition-all border ${inputMode === "root" ? "bg-rose-500 text-white border-rose-600 shadow-inner" : "bg-white/40 text-slate-500 border-white/40 shadow-sm"}`}>根音</button>
               <button onClick={() => setInputMode(m => m === "bass" ? "normal" : "bass")} className={`flex-1 rounded-xl text-[10px] font-bold transition-all border ${inputMode === "bass" ? "bg-amber-500 text-white border-amber-600 shadow-inner" : "bg-white/40 text-slate-500 border-white/40 shadow-sm"}`}>最低音</button>
            </div>

            <div className="col-start-2 col-span-2 row-start-3 h-14 bg-white/40 backdrop-blur-md rounded-2xl border border-white/40 shadow-sm flex items-center overflow-hidden">
                <div className="flex-[0.8] flex items-center justify-center border-r-2 border-dotted border-slate-400/30 h-full px-1">
                   <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap leading-tight text-center">調性は</span>
                </div>
                <div className="flex-1 relative h-full border-r-2 border-dotted border-slate-400/30 group active:bg-black/5 transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>{KEYS_ROOT.map(k => <option key={k} value={k}>{k === "none" ? "なし" : k}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-400" : "text-indigo-600"}`}>{keyRoot === "none" ? "なし" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-black/5 transition-colors ${keyRoot === "none" ? "opacity-50" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k}>{k === "Major" ? "メジャー" : "マイナー"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-300" : "text-fuchsia-600"}`}>{keyType === "Major" ? "メジャー" : "マイナー"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-2xl flex flex-col items-center justify-center shadow-lg transition-all active:scale-95 border border-white/20 relative overflow-hidden group ${canAnalyze && !loading ? "text-white" : "bg-slate-100 text-slate-300 cursor-not-allowed"}`} onClick={analyze} disabled={!canAnalyze || loading}>
               {canAnalyze && !loading && <div className={`absolute inset-0 ${G.aurora} opacity-90 group-hover:opacity-100 transition-opacity`}></div>}
               <div className="relative z-10 flex flex-col items-center">
                 {loading ? <IconRefresh className="animate-spin" /> : <IconArrowRight />}
                 <span className="text-[10px] font-bold mt-1 text-center leading-tight">判定</span>
               </div>
            </button>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className={`col-start-1 col-span-3 row-start-4 h-14 rounded-2xl border border-white/40 font-bold shadow-lg shadow-purple-500/10 active:scale-95 flex items-center justify-center gap-2 relative overflow-hidden group bg-white/60`}>
               <div className={`absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity ${G.aurora}`}></div>
               <div className={`w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-white text-[10px] shadow-sm relative z-10`}>
                  <div className={`absolute inset-0 ${G.aurora}`}></div>
                  <div className="relative z-10"><IconSparkles /></div>
               </div>
               <span className={`text-xs font-bold ${G.auroraText} relative z-10`}>Cadencia AI にきく</span>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
const IconSparkles = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>;
const IconSend = ({className}: {className?: string}) => <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IconRefresh = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
const IconTrash = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
const IconX = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const IconRobot = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
const IconTwitter = ({className}: {className?: string}) => <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
const IconArrowRight = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;
const IconKeyboard = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M6 12h.001"/><path d="M10 12h.001"/><path d="M14 12h.001"/><path d="M18 12h.001"/><path d="M7 16h10"/></svg>;