"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Constants ---
const G = {
  main: "bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500",
  textMain: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600",
  glass: "bg-white/70 backdrop-blur-xl border border-white/50 shadow-lg shadow-indigo-100/50",
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

// --- Helper ---
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
    <div className="h-12 w-full max-w-[200px] mx-auto relative mt-1 mb-2 select-none pointer-events-none">
       <svg viewBox="0 0 100 60" className="w-full h-full drop-shadow-sm">
         {keys.filter(k => k.type === "white").map((k) => (
           <rect key={k.idx} x={k.x} y="0" width="14.28" height="60" rx="2" ry="2"
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-400 stroke-rose-500" : isBass(k.idx) ? "fill-amber-400 stroke-amber-500" : "fill-[url(#activeKeyGradient)] stroke-indigo-300") 
                 : "fill-white stroke-slate-200"
             } stroke-[0.5]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <rect key={k.idx} x={k.x} y="0" width="8" height="38" rx="1" ry="1"
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-500 stroke-rose-600" : isBass(k.idx) ? "fill-amber-500 stroke-amber-600" : "fill-[url(#activeKeyGradient)] stroke-indigo-300") 
                 : "fill-slate-700 stroke-slate-800"
             } stroke-[0.5]`} />
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

const FeedbackLink = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <a href="https://x.com/araken525_toho?s=21" target="_blank" rel="noopener noreferrer" className={className}>
    {children}
  </a>
);

// --- Flick Key Component ---
const FlickKey = ({ 
  noteBase, currentSelection, isBass, isRoot, rootMode, onInput, onBassToggle, onRootSet, className
}: { 
  noteBase: string, currentSelection: string | undefined, isBass: boolean, isRoot: boolean, rootMode: boolean,
  onInput: (n: string) => void, onBassToggle: (n: string) => void, onRootSet: (n: string) => void, className?: string
}) => {
  const [startY, setStartY] = useState<number | null>(null);
  const [offsetY, setOffsetY] = useState(0);
  const isLongPressedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const THRESHOLD = 15;

  const isActive = !!currentSelection;
  const displayLabel = currentSelection || noteBase;

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    setStartY(e.clientY);
    isLongPressedRef.current = false;

    if (rootMode) return; 

    timerRef.current = setTimeout(() => {
      isLongPressedRef.current = true;
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(50);
      onBassToggle(noteBase); 
    }, 500);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (startY === null) return;
    const delta = e.clientY - startY;
    if (Math.abs(delta) > 5 && timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOffsetY(Math.max(-30, Math.min(30, delta)));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (startY === null) return;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

    if (rootMode) {
      onRootSet(noteBase); 
    } else if (!isLongPressedRef.current) {
      const delta = e.clientY - startY;
      if (delta < -THRESHOLD) onInput(`${noteBase}#`);
      else if (delta > THRESHOLD) onInput(`${noteBase}b`);
      else onInput(noteBase);
    }

    setStartY(null); setOffsetY(0); isLongPressedRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  const isUp = offsetY < -10;
  const isDown = offsetY > 10;

  return (
    <div className={`
      relative rounded-xl touch-none select-none overflow-hidden border backdrop-blur-md shadow-sm flex flex-col items-center justify-center transition-all duration-200
      ${isRoot ? "ring-2 ring-rose-400 border-rose-300 bg-rose-50 z-10" 
        : isBass ? "ring-2 ring-amber-400 border-amber-300 bg-amber-50 z-10" 
        : "border-white/40 bg-white/60"}
      ${!isBass && !isRoot && isActive ? "bg-gradient-to-br from-indigo-500/90 to-purple-500/90 text-white shadow-indigo-200" : ""}
      ${rootMode && !isActive && !isRoot ? "ring-2 ring-rose-200/50 animate-pulse" : ""}
      active:scale-95 ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      {isRoot && <div className="absolute top-1 left-1 text-[8px] font-bold text-rose-500">ROOT</div>}
      {isBass && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />}
      <div className={`absolute top-1.5 text-[8px] font-bold ${isUp ? "opacity-100 scale-110 -translate-y-0.5" : "opacity-20"}`}>#</div>
      <span className={`text-xl font-bold transition-transform duration-100 ${isRoot ? "text-rose-600" : isBass ? "text-amber-600" : ""}`} style={{ transform: `translateY(${offsetY * 0.4}px)` }}>{displayLabel}</span>
      <div className={`absolute bottom-1.5 text-[8px] font-bold ${isDown ? "opacity-100 scale-110 translate-y-0.5" : "opacity-20"}`}>b</div>
    </div>
  );
};

// --- Result Card ---
const ResultCard = ({ candidate, isTop, isKeySet }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;

  return (
    <div className={`relative overflow-hidden transition-all duration-500 group ${isTop ? "bg-gradient-to-br from-white via-indigo-50/30 to-purple-50/30 border-2 border-indigo-200 shadow-xl shadow-indigo-100/50 rounded-3xl p-6" : "bg-white/60 backdrop-blur-sm border border-white/60 shadow-sm rounded-2xl p-4 active:bg-white/90"}`}>
      <div className={`absolute -right-2 -bottom-4 font-black text-indigo-900 select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-8xl opacity-[0.05]" : "text-6xl opacity-[0.03]"}`}>{String(isTop ? 1 : 2).padStart(2, '0')}</div>
      <div className="relative z-10 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            {isTop && (
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold mb-2 shadow-sm border ${isProvisional ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-indigo-600 text-white border-indigo-500"}`}>
                 <span>{isProvisional ? "⚠️ 暫定判定" : "🏆 判定結果"}</span>
              </div>
            )}
            <h2 className={`font-black text-slate-800 tracking-tight leading-none ${isTop ? "text-4xl" : "text-xl"}`}>{candidate.chord}</h2>
          </div>
          <div className="text-right">
            <span className="text-[9px] text-slate-400 block font-bold">信頼度</span>
            <span className={`font-bold ${isTop ? "text-xl text-indigo-600" : "text-sm text-indigo-400"}`}>{percent}%</span>
          </div>
        </div>
        {candidate.chordType && <div className="text-xs font-bold text-slate-500">{candidate.chordType}</div>}
        {isKeySet && (
          <div className="flex flex-wrap gap-2">
            {candidate.tds && candidate.tds !== "?" && <span className={`px-2 py-1 rounded-md text-[10px] font-black border ${candidate.tds === "T" ? "bg-cyan-50 text-cyan-600 border-cyan-100" : candidate.tds === "D" ? "bg-pink-50 text-pink-600 border-pink-100" : candidate.tds === "S" ? "bg-lime-50 text-lime-600 border-lime-100" : "bg-slate-50 text-slate-500 border-slate-200"}`}>{candidate.tds === "SD" ? "S(SD)" : candidate.tds}機能</span>}
            {candidate.romanNumeral && <span className="px-2 py-1 rounded-md text-[10px] font-bold bg-violet-50 text-violet-600 border border-violet-100">{candidate.romanNumeral}</span>}
            {candidate.inversion && candidate.inversion !== "unknown" && <span className="px-2 py-1 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">{candidate.inversion === "root" ? "基本形" : candidate.inversion === "1st" ? "第1転回" : candidate.inversion === "2nd" ? "第2転回" : "転回形"}</span>}
          </div>
        )}
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-1000 ease-out ${isTop ? "bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500" : "bg-slate-300"}`} style={{ width: `${percent}%` }}></div>
        </div>
      </div>
    </div>
  );
};

// --- Main Page ---
export default function CadenciaPage() {
  const resultRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showGuide, setShowGuide] = useState(true);

  // State
  const [selected, setSelected] = useState<string[]>([]);
  const [keyRoot, setKeyRoot] = useState<string>("none"); 
  const [keyType, setKeyType] = useState<string>("Major"); 
  const [bassHint, setBassHint] = useState<string | null>(null); 
  const [rootHint, setRootHint] = useState<string | null>(null);
  const [rootMode, setRootMode] = useState(false); // Root指定モード

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

  const handleNoteInput = (inputNote: string) => {
    const base = inputNote.charAt(0);
    const existingIndex = selected.findIndex(s => s.startsWith(base));
    const existingNote = selected[existingIndex];
    let nextSelected = [...selected];

    if (existingIndex !== -1) {
      if (existingNote === inputNote) {
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
    
    if (JSON.stringify(nextSelected) !== JSON.stringify(selected)) {
      setSelected(nextSelected);
      setJustUpdated(true);
      setTimeout(() => setJustUpdated(false), 300);
    }
  };

  const handleBassToggle = (noteBase: string) => {
    const existing = selected.find(s => s.startsWith(noteBase));
    const targetNote = existing || noteBase;
    if (!existing) handleNoteInput(targetNote);
    setBassHint(prev => (prev?.startsWith(noteBase) ? null : targetNote));
  };

  const handleRootSet = (noteBase: string) => {
    const existing = selected.find(s => s.startsWith(noteBase));
    const targetNote = existing || noteBase;
    if (!existing) handleNoteInput(targetNote);
    setRootHint(prev => (prev?.startsWith(noteBase) ? null : targetNote));
    setRootMode(false); // Root指定したらモード終了
  };

  const reset = () => {
    setSelected([]); setCandidates([]); setBassHint(null); setRootHint(null);
    setInfoText(""); setQuestion(""); setAnswer(""); setLoading(false);
  };

  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true); setAnswer(""); setInfoText("");
    const keyHint = keyRoot === "none" ? "none" : `${keyRoot} ${keyType}`;
    try {
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
    const keyHint = keyRoot === "none" ? "none" : `${keyRoot} ${keyType}`;
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          selectedNotes: selected, engineChord: candidates[0].chord, question: q, 
          bassHint, rootHint, keyHint, candidates: candidates.slice(0,5) 
        }),
      });
      setAnswer(res.ok ? await res.text() : `エラー: ${await res.text()}`);
    } catch (e: any) { setAnswer(`通信エラー: ${e?.message}`); } finally { setIsThinking(false); setQuestion(""); }
  }

  const hasResult = candidates.length > 0;
  const topCandidate = hasResult ? candidates[0] : null;
  const otherCandidates = hasResult ? candidates.slice(1) : [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[420px] selection:bg-purple-200">
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-200/30 blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-fuchsia-200/20 blur-[120px]"></div>
      </div>

      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.glass} flex items-center justify-between px-5`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${G.main} flex items-center justify-center text-white shadow-md`}><IconSparkles /></div>
          <div className="flex flex-col justify-center leading-none">
            <span className="text-[9px] font-bold text-indigo-400 tracking-widest mb-0.5">カデンツィア</span>
            <div className="flex items-center gap-2"><span className={`text-lg font-black tracking-tight ${G.textMain}`}>Cadencia AI</span><FeedbackLink className="bg-indigo-50 border border-indigo-100 text-[9px] font-bold text-indigo-500 px-1.5 py-0.5 rounded-md hover:bg-indigo-100 transition-colors flex items-center gap-1"><span>BETA</span><IconTwitter /></FeedbackLink></div>
          </div>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-6 relative z-10">
        {!hasResult && (
          <section className="text-center space-y-2 animate-in fade-in duration-500">
            <div className="inline-block relative">
               <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-indigo-400/80 tracking-[0.2em] whitespace-nowrap">カデンツィア AI</span>
               <h1 className={`text-4xl font-black tracking-tight ${G.textMain} drop-shadow-sm pb-1`}>Cadencia AI</h1>
            </div>
            <p className="text-sm font-bold text-slate-600 flex items-center justify-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse"></span>ポケットに、専属の音楽理論家を。</p>
          </section>
        )}

        {showGuide && !hasResult && (
          <section className="relative rounded-3xl p-0.5 animate-in fade-in slide-in-from-top-4 duration-500 bg-gradient-to-br from-indigo-200 via-purple-200 to-fuchsia-200 shadow-xl shadow-indigo-100">
            <div className="bg-white/95 backdrop-blur-xl rounded-[22px] p-6 relative overflow-hidden">
              <button onClick={() => setShowGuide(false)} className="absolute top-3 right-3 text-slate-300 active:text-slate-500 active:bg-slate-100 p-2 rounded-full transition-colors"><IconX /></button>
              <h2 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2"><span className="text-lg">🎓</span> はじめての方へ</h2>
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 mb-4">
                 <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">HOW TO USE</h3>
                 <div className="flex justify-between items-center relative px-2">
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group"><div className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-lg shadow-sm">🎹</div><span className="text-[10px] font-bold text-slate-500">選ぶ</span></div>
                    <div className="h-[2px] flex-1 bg-slate-200 mx-1"></div>
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group"><div className={`w-10 h-10 ${G.main} rounded-full flex items-center justify-center text-lg shadow-md shadow-purple-200 text-white animate-pulse`}>✨</div><span className="text-[10px] font-bold text-purple-600">判定</span></div>
                    <div className="h-[2px] flex-1 bg-slate-200 mx-1"></div>
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group"><div className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-lg shadow-sm">💬</div><span className="text-[10px] font-bold text-slate-500">対話</span></div>
                 </div>
              </div>
              <button onClick={() => setShowGuide(false)} className={`w-full py-3.5 rounded-2xl text-white text-xs font-bold tracking-wide shadow-lg shadow-indigo-200 ${G.main} active:scale-95 transition-transform mb-3`}>さっそく始める 🚀</button>
            </div>
          </section>
        )}

        {hasResult && topCandidate && (
          <div ref={resultRef} className="animate-in fade-in slide-in-from-bottom-8 duration-500">
             <div className="flex items-center justify-between px-2 mb-2"><h3 className="text-xs font-bold text-indigo-900 flex items-center gap-1.5"><IconSparkles />Cadencia AIによる和音分析の結果</h3></div>
             <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />
          </div>
        )}

        <section className={`rounded-3xl border border-white/60 p-5 relative overflow-hidden transition-all duration-300 ${hasResult ? "bg-white/40 mt-4" : "bg-white/60 shadow-lg shadow-indigo-100/40"} ${justUpdated ? "ring-2 ring-purple-300 ring-offset-2 ring-offset-[#F8FAFC]" : ""}`}>
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-300/50 to-transparent"></div>
           <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">🎹 Input Monitor</span>
              <div className="flex items-center gap-2">
                 {rootHint && <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">ROOT: {rootHint}</span>}
                 {bassHint && <span className="text-[9px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">BASS: {bassHint}</span>}
                 <span className="text-[9px] text-slate-300 font-mono ml-1">{selected.length} NOTES</span>
              </div>
           </div>
           <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
           <div className="flex justify-center gap-2 flex-wrap min-h-[2rem] mt-3">
              {selected.length === 0 ? (<span className="text-xs text-slate-400 bg-slate-100/50 px-3 py-1 rounded-full animate-pulse">👇 下のボタンで音を選択</span>) : (
                sortedSelected.map((note) => (
                  <span key={note} className={`px-3 py-1.5 border shadow-sm rounded-lg text-xs font-bold animate-in zoom-in duration-200 
                    ${rootHint === note ? "bg-rose-50 border-rose-300 text-rose-600 ring-1 ring-rose-300" : bassHint === note ? "bg-amber-50 border-amber-300 text-amber-600 ring-1 ring-amber-300" : "bg-white border-indigo-100 text-indigo-600"}`}>
                    {note} {rootHint === note && <span className="text-[8px] ml-1 opacity-70">(Root)</span>} {bassHint === note && <span className="text-[8px] ml-1 opacity-70">(Bass)</span>}
                  </span>
                ))
              )}
           </div>
        </section>

        <section className={`transition-all duration-700 ease-out ${infoText ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 max-h-0 overflow-hidden"}`}>
           <div className="flex gap-4 items-start pl-2">
             <div className={`flex-shrink-0 w-10 h-10 rounded-xl ${G.main} flex items-center justify-center text-white shadow-md animate-in zoom-in duration-300`}><IconRobot /></div>
             <div className="flex-1 bg-white/80 backdrop-blur-md rounded-2xl rounded-tl-none p-5 shadow-sm border border-indigo-50 relative">
                <div className="absolute -left-2 top-0 w-4 h-4 bg-white/80 transform rotate-45 border-l border-b border-indigo-50"></div>
                <h3 className={`text-xs font-bold mb-2 flex items-center gap-2 ${G.textMain}`}>Cadencia AI の考察</h3>
                <p className="text-sm leading-snug text-slate-700 whitespace-pre-wrap">{infoText}</p>
             </div>
           </div>
        </section>

        {otherCandidates.length > 0 && (
          <section className="space-y-3 pt-2">
            <div className="flex items-center gap-2 px-1"><span className="h-[1px] flex-1 bg-slate-200"></span><span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">その他の候補</span><span className="h-[1px] flex-1 bg-slate-200"></span></div>
            <div className="grid gap-3">{otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}</div>
          </section>
        )}

        <section className={`${G.glass} rounded-3xl p-1 overflow-hidden mt-6`}>
           <div className="bg-white/40 rounded-[20px] p-5">
              <div className="flex items-center gap-2 mb-4"><div className={`w-6 h-6 rounded-full ${G.main} flex items-center justify-center text-white text-[10px]`}><IconSparkles /></div><h3 className={`text-sm font-bold ${G.textMain}`}>Cadencia AI に質問する</h3></div>
              {answer && (<div className="mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500"><div className="bg-gradient-to-br from-indigo-50 to-fuchsia-50 border border-indigo-100 rounded-2xl rounded-tl-none p-4 text-sm text-slate-700 leading-snug shadow-inner relative whitespace-pre-wrap"><span className="absolute -top-1 -left-1 text-lg">💡</span><div className="pl-3">{answer}</div></div></div>)}
              {isThinking && (<div className="mb-4 flex items-center gap-2 pl-2"><span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span><span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-75"></span><span className="w-2 h-2 bg-fuchsia-400 rounded-full animate-bounce delay-150"></span><span className="text-xs text-indigo-300 font-bold ml-2">AIが考え中...🤔</span></div>)}
              <div className="relative group"><input ref={inputRef} className="w-full bg-white border border-indigo-100 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/50 transition-all shadow-sm placeholder:text-slate-300" placeholder="例：ドミナントって何？🤔" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} disabled={isThinking} /><button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white transition-all active:scale-90 ${!question.trim() ? "bg-slate-200 text-slate-400" : `${G.main} shadow-md`}`}><IconSend /></button></div>
           </div>
        </section>
        <section className="text-center pb-4 pt-4"><FeedbackLink className="text-[10px] text-slate-400 hover:text-indigo-500 transition-colors inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>不具合報告・機能要望はこちら (X: @araken525_toho)</FeedbackLink></section>
      </main>

      {/* --- REBUILT Bottom Controls (5 Columns x 4 Rows) --- */}
      <div className={`fixed bottom-0 inset-x-0 z-50 ${G.glass} border-t-0 rounded-t-[30px] pt-4 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]`}>
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-5 grid-rows-4 gap-2 h-full">
            
            {/* Row 1: C, D, E, F, Cancel */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <FlickKey className="col-start-4 row-start-1" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <button className="col-start-5 row-start-1 h-14 rounded-xl bg-white/60 border border-white/60 text-slate-400 active:text-red-500 active:bg-red-50 transition-all flex items-center justify-center shadow-sm active:scale-95" onClick={reset}><IconTrash /></button>

            {/* Row 2: ROOT, G, A, B, Analyze(start) */}
            <button 
              className={`col-start-1 row-start-2 row-span-2 h-full rounded-xl flex flex-col items-center justify-center border text-[9px] font-bold shadow-sm active:scale-95 transition-all leading-tight ${rootMode ? "bg-rose-400 border-rose-500 text-white shadow-rose-200" : "bg-white/60 border-white/60 text-slate-400"}`}
              onClick={() => setRootMode(!rootMode)}
            >
              <span>根音</span><span>を</span><span>選ぶ</span><span className="text-[7px] opacity-70 mt-1">{rootMode ? "ON" : "OFF"}</span>
            </button>
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} rootMode={rootMode} onInput={handleNoteInput} onBassToggle={handleBassToggle} onRootSet={handleRootSet} />
            <button className={`col-start-5 row-start-2 row-span-3 rounded-xl flex flex-col items-center justify-center shadow-lg transition-all active:scale-95 border border-white/20 ${canAnalyze && !loading ? `${G.main} text-white shadow-indigo-300/50` : "bg-slate-100 text-slate-300 cursor-not-allowed"}`} onClick={analyze} disabled={!canAnalyze || loading}>{loading ? <IconRefresh /> : <IconArrowRight />}<span className="text-[10px] font-bold mt-1 text-center leading-tight">判定</span></button>

            {/* Row 3: Key Selector Group (Native Selects) */}
            <div className="col-start-2 col-span-3 row-start-3 h-14 bg-white/60 backdrop-blur-md rounded-xl border border-white/60 shadow-sm flex items-center overflow-hidden">
                {/* Label */}
                <div className="flex-1 flex items-center justify-center border-r-2 border-dotted border-slate-300/50 h-full px-1">
                   <span className="text-[8px] font-bold text-slate-400 whitespace-nowrap">調性を<br/>指定する</span>
                </div>
                {/* Key Select */}
                <div className="flex-1 relative h-full border-r-2 border-dotted border-slate-300/50 group active:bg-black/5 transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>
                      {KEYS_ROOT.map(k => <option key={k} value={k}>{k === "none" ? "Free" : k}</option>)}
                   </select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wider">KEY</span>
                      <span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-400" : "text-indigo-600"}`}>{keyRoot === "none" ? "Free" : keyRoot}</span>
                   </div>
                </div>
                {/* Scale Select */}
                <div className={`flex-1 relative h-full active:bg-black/5 transition-colors ${keyRoot === "none" ? "opacity-50" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>
                      {KEYS_TYPE.map(k => <option key={k} value={k}>{k}</option>)}
                   </select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[7px] font-bold text-slate-400 uppercase tracking-wider">SCALE</span>
                      <span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-300" : "text-fuchsia-600"}`}>{keyType === "Major" ? "Maj" : "min"}</span>
                   </div>
                </div>
            </div>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className="col-start-1 col-span-4 row-start-4 h-14 rounded-xl bg-white/80 border border-white/60 text-indigo-600 font-bold shadow-sm active:scale-95 flex items-center justify-center gap-2">
               <div className={`w-6 h-6 rounded-full ${G.main} flex items-center justify-center text-white text-[10px]`}><IconSparkles /></div><span className="text-xs">Cadencia AI にきく</span>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
const IconSparkles = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>;
const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IconRefresh = () => <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
const IconTrash = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
const IconX = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const IconRobot = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
const IconTwitter = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
const IconArrowRight = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;