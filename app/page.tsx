"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants: Luminous Void (Ultimate Modern Dark) ---
const G = {
  // 背景: 深い宇宙のようなダークネイビー〜黒のグラデーション + ノイズ
  bgMain: "bg-slate-950",
  bgGradient: "bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950",
  
  // テキスト: 発光感のある白と、落ち着いたグレー
  textMain: "text-slate-100",
  textSub: "text-slate-400",
  textAccent: "text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-fuchsia-400",
  
  // ガラス素材: 黒ベースのすりガラス、極細の輝くボーダー
  glass: "bg-slate-900/60 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/50",
  glassKey: "bg-white/5 border border-white/10 hover:bg-white/10 active:bg-white/20 transition-all duration-200 backdrop-blur-md",
  
  // カード: 浮遊感のあるダークカード
  card: "bg-slate-900/40 border border-white/10 rounded-[24px] shadow-xl backdrop-blur-xl",
  
  // アクセント: ネオンの輝き（AI感、デジタル感）
  glowCyan: "shadow-[0_0_20px_rgba(34,211,238,0.3)] border-cyan-500/50",
  glowPink: "shadow-[0_0_20px_rgba(232,121,249,0.3)] border-fuchsia-500/50",
  
  // ステータス色
  accentRoot: "bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.2)]",
  accentBass: "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]",
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

// 1. Mini Piano (Cyber Style)
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
    <div className="h-16 w-full relative select-none pointer-events-none rounded-xl overflow-hidden shadow-inner bg-black/40">
       <svg viewBox="0 0 100 50" className="w-full h-full">
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v44 a2,2 0 0 1 -2,2 h-10.28 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-500" : isBass(k.idx) ? "fill-amber-500" : "fill-cyan-500") 
                 : "fill-slate-800/50"
             } stroke-slate-700/50 stroke-[0.5]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 a2,2 0 0 1 -2,2 h-4 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-400" : isBass(k.idx) ? "fill-amber-400" : "fill-cyan-400") 
                 : "fill-black"
             }`} />
         ))}
       </svg>
       {/* Glow Overlay */}
       <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/5 to-transparent pointer-events-none mix-blend-screen"></div>
    </div>
  );
};

// 2. Flick Key (Glass Pad Style)
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
      relative rounded-[16px] touch-none select-none overflow-hidden flex flex-col items-center justify-center z-0
      transition-all duration-200
      ${isRoot ? G.accentRoot
        : isBass ? G.accentBass
        : G.glassKey}
      ${!isBass && !isRoot && isActive ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.2)]" : ""}
      ${!isActive && !isRoot && !isBass ? "text-slate-300" : ""}
      active:scale-95
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* Background Glow */}
      {isActive && <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />}

      {/* Guide Indicators */}
      <div className={`absolute top-1.5 left-0 right-0 flex justify-center transition-all duration-300 ${isUp ? "opacity-100 -translate-y-1 text-cyan-400 font-bold scale-110" : "opacity-0"}`}>
        <span className="text-[10px]">♯</span>
      </div>
      <div className={`absolute bottom-1.5 left-0 right-0 flex justify-center transition-all duration-300 ${isDown ? "opacity-100 translate-y-1 text-cyan-400 font-bold scale-110" : "opacity-0"}`}>
        <span className="text-[10px]">♭</span>
      </div>
      
      {/* Label */}
      <span className={`text-2xl font-medium tracking-tighter relative z-10 transition-transform`} 
        style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
    </div>
  );
};

// 3. Result Card (Dashboard Widget Style)
const ResultCard = ({ candidate, isTop, isKeySet }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;
  const invMap: Record<string, string> = { "root": "基本形", "1st": "第1転回", "2nd": "第2転回", "3rd": "第3転回", "unknown": "不明" };
  const invJp = invMap[candidate.inversion || "unknown"] || "―";

  return (
    <div className={`relative overflow-hidden transition-all duration-700 group animate-in slide-in-from-bottom-4 fade-in
      ${isTop 
        ? `bg-slate-900/80 border border-white/20 shadow-[0_0_40px_-10px_rgba(100,100,255,0.15)] rounded-[30px] p-6`
        : "bg-slate-900/40 border border-white/5 shadow-sm rounded-[20px] p-4"}
    `}>
      {/* Dynamic Background Gradient for Top */}
      {isTop && (
        <>
          <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-indigo-600/20 blur-[80px] -z-10 rounded-full pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-[200px] h-[200px] bg-fuchsia-600/20 blur-[80px] -z-10 rounded-full pointer-events-none"></div>
        </>
      )}

      {/* Rank Number (Outline) */}
      <div className={`absolute -right-4 -bottom-8 font-black text-transparent stroke-text select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-9xl opacity-10" : "text-7xl opacity-5"}`} 
           style={{ WebkitTextStroke: "1px rgba(255,255,255,0.1)" }}>
        {String(isTop ? 1 : 2).padStart(2, '0')}
      </div>

      <div className="relative z-10 flex flex-col gap-5">
        {/* Header Section */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {isTop && (
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide border ${isProvisional ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/30"} shadow-[0_0_10px_rgba(0,0,0,0.2)]`}>
                  {isProvisional ? "⚠️ 暫定判定" : "🏆 判定結果"}
                </span>
              )}
              {candidate.chordType && (
                <span className="px-3 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-slate-300 border border-white/10">
                  {candidate.chordType}
                </span>
              )}
            </div>
            <h2 className={`font-black text-white tracking-tighter leading-none ${isTop ? "text-5xl drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]" : "text-2xl"}`}>
              {candidate.chord}
            </h2>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Confidence</span>
            <span className={`font-black ${isTop ? "text-3xl text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 to-indigo-400" : "text-sm text-slate-500"}`}>{percent}<span className="text-xs opacity-50 text-slate-400">%</span></span>
          </div>
        </div>

        {/* Function Analysis Grid */}
        {isKeySet ? (
          <div className="bg-white/5 rounded-2xl p-1.5 border border-white/5 grid grid-cols-12 gap-1.5">
            {/* Function (TDS) */}
            <div className="col-span-4 bg-slate-950/50 rounded-xl border border-white/5 flex flex-col items-center justify-center py-3 shadow-inner">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">機能</span>
              <span className={`text-3xl font-black leading-none ${
                candidate.tds === "T" ? "text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]" : 
                candidate.tds === "D" ? "text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.5)]" : 
                candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]" : "text-slate-600"
              }`}>
                {candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds}
              </span>
            </div>
            {/* Details */}
            <div className="col-span-8 flex flex-col gap-1.5">
               <div className="flex-1 bg-slate-950/50 rounded-xl border border-white/5 flex items-center justify-between px-4">
                  <span className="text-[10px] font-bold text-slate-500">和音記号</span>
                  <span className="text-lg font-serif font-bold text-slate-200">{candidate.romanNumeral || "―"}</span>
               </div>
               <div className="flex-1 bg-slate-950/50 rounded-xl border border-white/5 flex items-center justify-between px-4">
                  <span className="text-[10px] font-bold text-slate-500">転回形</span>
                  <span className="text-xs font-bold text-slate-400">{invJp}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 bg-white/5 rounded-2xl border border-dashed border-white/10">
            <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
              <span>🗝️</span> Keyを指定すると機能分析(TDS)が表示されます
            </span>
          </div>
        )}

        {/* Confidence Bar */}
        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-1000 ease-out relative ${isTop ? "bg-gradient-to-r from-cyan-500 to-fuchsia-500" : "bg-slate-600"}`} style={{ width: `${percent}%` }}>
             {isTop && <div className="absolute inset-0 bg-white/30 animate-pulse"></div>}
          </div>
        </div>
      </div>
    </div>
  );
};

// 4. Insight Card (AI Terminal Style)
const InsightCard = ({ text }: { text: string }) => (
  <div className="relative rounded-[24px] overflow-hidden bg-slate-900/50 border border-indigo-500/30 p-6 shadow-[0_0_30px_-10px_rgba(99,102,241,0.2)]">
    <div className="flex items-center gap-3 mb-3">
      <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300 border border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.4)]">
         <IconRobot className="w-4 h-4" />
      </div>
      <h3 className="text-sm font-bold text-indigo-200">Cadencia AI の考察</h3>
    </div>
    <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap font-medium">{text}</p>
  </div>
);

// 5. Ask Card (Modern Input)
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp }: any) => (
  <div className={`relative rounded-[24px] overflow-hidden ${G.glass} p-1 transition-all`}>
    <div className="bg-slate-950/80 backdrop-blur-xl rounded-[22px] p-5">
      <h3 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-2 uppercase tracking-wider">
        <span className="text-lg">💬</span> Cadencia AIに質問
      </h3>
      <div className="relative group">
        <input 
          ref={inputRefProp}
          className="w-full bg-slate-900 border border-slate-700/50 rounded-xl py-3.5 pl-4 pr-12 text-base focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent transition-all shadow-inner placeholder:text-slate-600 text-white" 
          placeholder="例：なぜこの機能になるの？" 
          value={question} 
          onChange={(e) => setQuestion(e.target.value)} 
          onKeyDown={(e) => e.key === 'Enter' && ask()} 
          disabled={isThinking} 
        />
        <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-white transition-all active:scale-90 shadow-lg ${!question.trim() ? "bg-slate-800 text-slate-500" : "bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-cyan-500/30"}`}>
          <IconSend className="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
);

// 6. Loading Overlay (Neon Pulse)
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-xl animate-in fade-in duration-300">
    <div className="relative w-24 h-24">
      <div className="absolute inset-0 rounded-full border-2 border-slate-800"></div>
      <div className="absolute inset-0 rounded-full border-t-2 border-cyan-400 animate-spin shadow-[0_0_15px_rgba(34,211,238,0.5)]"></div>
      <div className="absolute inset-4 rounded-full bg-slate-900 flex items-center justify-center shadow-inner">
         <IconSparkles className="w-8 h-8 text-indigo-400 animate-pulse" />
      </div>
    </div>
    <div className="mt-8 text-center space-y-2">
      <h2 className={`text-xl font-black ${G.textAccent} tracking-tight`}>Processing Harmony...</h2>
      <p className="text-xs font-bold text-slate-500 tracking-widest animate-pulse">音楽理論AIが解析中</p>
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

  const focusInput = () => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

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
      await new Promise(r => setTimeout(r, 800));
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
    <div className={`min-h-screen ${G.bgMain} ${G.textMain} font-sans pb-[450px] selection:bg-cyan-500/30 overflow-x-hidden`}>
      
      {/* Dynamic Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className={`absolute inset-0 ${G.bgGradient}`}></div>
        <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-indigo-900/20 blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[70%] h-[70%] rounded-full bg-fuchsia-900/20 blur-[120px]"></div>
      </div>

      {loading && <LoadingOverlay />}

      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.glass} flex items-center justify-between px-5 transition-all border-b border-white/5`}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
             <IconSparkles className="w-5 h-5" />
          </div>
          <div className="flex flex-col justify-center leading-none">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-lg font-black tracking-tight ${G.textAccent}`}>Cadencia AI</span>
              <FeedbackLink className="bg-white/10 border border-white/10 text-[9px] font-bold text-slate-300 px-2 py-0.5 rounded-full hover:bg-white/20 transition-colors flex items-center gap-1">
                <span>BETA</span>
              </FeedbackLink>
            </div>
            <span className="text-[10px] font-bold text-slate-500 tracking-wide">ポケットに、専属音楽理論家を。</span>
          </div>
        </div>
      </header>

      <main className="pt-28 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* Hero */}
        {!hasResult && (
          <section className="text-center space-y-4 animate-in fade-in zoom-in duration-700 py-6">
            <div className="inline-block relative">
               <span className="block text-[10px] font-bold text-slate-500 tracking-[0.3em] mb-2 uppercase">Music Theory Intelligence</span>
               <h1 className={`text-5xl font-black tracking-tighter text-white pb-2 drop-shadow-xl`}>
                 Cadencia
               </h1>
            </div>
            <p className="text-sm font-medium text-slate-400 flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,0.8)]"></span>
              Luminous Void Edition
            </p>
          </section>
        )}

        {/* Input Monitor Card */}
        <section className={`${G.glass} rounded-[30px] p-1 overflow-hidden transition-all duration-300 ${justUpdated ? "ring-1 ring-cyan-500/50" : ""}`}>
           <div className="bg-slate-950/50 backdrop-blur-xl rounded-[28px] p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <IconKeyboard className="w-4 h-4" /> 入力モニター
                </h3>
                <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/30 px-2 py-1 rounded border border-cyan-500/20">{selected.length} NOTES</span>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4 min-h-[2rem]">
                {selected.length === 0 ? (
                  <span className="text-xs text-slate-600 italic pl-1">鍵盤を弾いて音を追加...</span>
                ) : (
                  sortedSelected.map((note) => (
                    <span key={note} className={`px-3 py-1.5 border shadow-lg rounded-xl text-xs font-bold animate-in zoom-in duration-200 backdrop-blur-md ${
                      rootHint === note 
                        ? G.accentRoot
                        : bassHint === note 
                          ? G.accentBass
                          : "bg-slate-800 border-slate-700 text-slate-200"
                    }`}>
                      {note}
                      {rootHint === note && <span className="ml-1.5 text-[9px] bg-rose-500/20 px-1 rounded text-rose-300">根</span>}
                      {bassHint === note && <span className="ml-1.5 text-[9px] bg-amber-500/20 px-1 rounded text-amber-300">底</span>}
                    </span>
                  ))
                )}
              </div>

              <div className="pt-2 border-t border-white/5">
                 <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
              </div>
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
             
             <div className="flex items-center gap-2 px-2">
               <div className={`w-1 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-fuchsia-500`}></div>
               <h2 className="text-lg font-bold text-white">分析結果</h2>
             </div>

             {topCandidate && <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />}

             {infoText && <InsightCard text={infoText} />}

             {otherCandidates.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center gap-3 px-2 py-2">
                   <div className="h-[1px] flex-1 bg-white/10"></div>
                   <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">その他の候補</span>
                   <div className="h-[1px] flex-1 bg-white/10"></div>
                 </div>
                 {otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}
               </div>
             )}

             <div className="pt-4 pb-8">
               {answer && (
                 <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                   <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-indigo-500/30 rounded-[24px] rounded-tl-none p-6 text-sm text-slate-300 leading-relaxed shadow-lg relative">
                     <span className="absolute -top-3 -left-2 text-2xl filter drop-shadow-md grayscale opacity-80">🤖</span>
                     <div className="pl-2">{answer}</div>
                   </div>
                 </div>
               )}
               <AskCard 
                 question={question} 
                 setQuestion={setQuestion} 
                 ask={ask} 
                 isThinking={isThinking} 
                 loading={loading}
                 inputRefProp={inputRef}
               />
             </div>
          </div>
        )}

      </main>

      {/* --- Floating Glass Keyboard --- */}
      <div className={`fixed bottom-0 inset-x-0 z-50 ${G.glass} rounded-t-[36px] pt-5 pb-8 border-t border-white/10 transition-transform duration-300`}>
        {/* Glow Line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent"></div>
        
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-4 grid-rows-4 gap-2.5 h-full">
            
            {/* Row 1 */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-2xl bg-white/5 border border-white/10 text-slate-500 active:text-rose-400 active:bg-rose-950/30 transition-all flex items-center justify-center hover:bg-white/10 active:scale-95" onClick={reset}><IconTrash /></button>

            {/* Row 2 */}
            <FlickKey className="col-start-1 row-start-2" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} onInput={handleKeyInput} />

            {/* Row 3: Mode & Key */}
            <div className="col-start-1 row-start-3 h-14 flex flex-col gap-1.5">
               <button onClick={() => setInputMode(m => m === "root" ? "normal" : "root")} className={`flex-1 rounded-xl text-[10px] font-bold transition-all border ${inputMode === "root" ? "bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-[0_0_10px_rgba(244,63,94,0.3)]" : "bg-white/5 text-slate-500 border-white/5"}`}>根音</button>
               <button onClick={() => setInputMode(m => m === "bass" ? "normal" : "bass")} className={`flex-1 rounded-xl text-[10px] font-bold transition-all border ${inputMode === "bass" ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.3)]" : "bg-white/5 text-slate-500 border-white/5"}`}>最低音</button>
            </div>

            <div className="col-start-2 col-span-2 row-start-3 h-14 bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 flex items-center overflow-hidden">
                <div className="flex-[0.8] flex items-center justify-center border-r border-white/5 h-full px-1">
                   <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap leading-tight text-center">調性は</span>
                </div>
                <div className="flex-1 relative h-full border-r border-white/5 group active:bg-white/5 transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>{KEYS_ROOT.map(k => <option key={k} value={k} className="text-black">{k === "none" ? "なし" : k}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-600" : "text-cyan-400"}`}>{keyRoot === "none" ? "なし" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-white/5 transition-colors ${keyRoot === "none" ? "opacity-30" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k} className="text-black">{k === "Major" ? "メジャー" : "マイナー"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-600" : "text-fuchsia-400"}`}>{keyType === "Major" ? "メジャー" : "マイナー"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-2xl flex flex-col items-center justify-center shadow-lg transition-all active:scale-95 border border-white/10 relative overflow-hidden group ${canAnalyze && !loading ? "text-white" : "bg-white/5 text-slate-600 cursor-not-allowed"}`} onClick={analyze} disabled={!canAnalyze || loading}>
               {canAnalyze && !loading && <div className={`absolute inset-0 bg-gradient-to-br from-cyan-600 to-indigo-600 opacity-80 group-hover:opacity-100 transition-opacity`}></div>}
               {canAnalyze && !loading && <div className="absolute inset-0 animate-pulse bg-white/20"></div>}
               <div className="relative z-10 flex flex-col items-center">
                 {loading ? <IconRefresh className="animate-spin" /> : <IconArrowRight />}
                 <span className="text-[10px] font-bold mt-1 text-center leading-tight">判定</span>
               </div>
            </button>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className={`col-start-1 col-span-3 row-start-4 h-14 rounded-2xl border border-white/10 font-bold shadow-lg shadow-purple-500/5 active:scale-95 flex items-center justify-center gap-2 relative overflow-hidden group bg-white/5 hover:bg-white/10`}>
               <div className="relative z-10 text-cyan-300"><IconSparkles /></div>
               <span className={`text-xs font-bold text-slate-200 relative z-10`}>Cadencia AI にきく</span>
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