"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants: Harmonic Grimoire (Harry Potter Style) ---
const G = {
  // 背景: 古びた羊皮紙（エイジド・パーチメント）のテクスチャ感
  bgMain: "bg-[#F2EFE5]", //bg-[url('/parchment-bg.jpg')] のように画像を入れるとなお良い
  
  // テキスト: 魔法使いのインク（セピアがかった深いブラウンブラック）
  textMain: "text-[#3E3229]",
  textSub: "text-[#6D5E52]",
  
  // アクセント: 賢者のゴールド、グリフィンドールのような深紅、魔法の碧（へき）
  accentGold: "text-[#B48E43] border-[#B48E43]",
  accentRed: "text-[#8B0000] bg-[#FFEEEE] border-[#CC0000]",
  accentMagic: "text-teal-700 bg-teal-50 border-teal-200 shadow-[0_0_15px_rgba(20,184,166,0.4)]",
  
  // マテリアル: 魔法がかけられたルーン石板（キーボード用）
  stonePlate: "bg-[#E8E4D9] border-2 border-[#C5B498] shadow-[4px_4px_0px_#B0A080] active:translate-y-[2px] active:shadow-[2px_2px_0px_#B0A080] transition-all",
  
  // マテリアル: 古文書のページ（カード用）
  parchmentCard: "bg-[#FDFBF7] border-2 border-[#DBCAB0] shadow-md shadow-[#3E3229]/10 rounded-lg",
  
  // 魔法の輝き（選択状態やトップ評価）
  magicGlow: "shadow-[0_0_20px_rgba(180,142,67,0.7)] border-[#B48E43] z-10 relative animate-pulse-slow",
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

// 1. Mini Piano (Antique Instruments Style)
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
    <div className="h-16 w-full relative select-none pointer-events-none p-1.5 bg-[#2A211C] rounded-sm shadow-inner border-2 border-[#B48E43]">
       <svg viewBox="0 0 100 50" className="w-full h-full">
         {/* White Keys (Ivory) */}
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v44 a2,2 0 0 1 -2,2 h-10.28 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-400" : isBass(k.idx) ? "fill-amber-400" : "fill-teal-300") 
                 : "fill-[#FDFBF7]"
             } stroke-[#DBCAB0] stroke-[0.5]`} />
         ))}
         {/* Black Keys (Ebony) */}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 a2,2 0 0 1 -2,2 h-4 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-600" : isBass(k.idx) ? "fill-amber-600" : "fill-teal-500") 
                 : "fill-[#1A1512] stroke-[#5D524A]"
             }`} />
         ))}
       </svg>
       {/* Magic overlay effect */}
       <div className="absolute inset-0 bg-gradient-to-t from-[#B48E43]/10 to-transparent pointer-events-none rounded-sm mix-blend-overlay"></div>
    </div>
  );
};

// 2. Flick Key (Rune Stone Style)
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
      relative rounded-[6px] touch-none select-none overflow-visible flex flex-col items-center justify-center z-0
      font-serif
      ${isRoot ? "bg-rose-100 border-2 border-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.4)]" 
        : isBass ? "bg-amber-100 border-2 border-amber-400 shadow-[0_0_15px_rgba(217,119,6,0.4)]" 
        : G.stonePlate}
      ${!isBass && !isRoot && isActive ? "bg-teal-50 border-2 border-teal-400 shadow-[0_0_15px_rgba(20,184,166,0.4)]" : ""}
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* Ancient Rune Guides */}
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all ${isUp ? "opacity-100 -translate-y-2 text-teal-700 drop-shadow-sm" : "opacity-0"}`}>
        <span className="text-xs font-bold">♯</span>
      </div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all ${isDown ? "opacity-100 translate-y-2 text-teal-700 drop-shadow-sm" : "opacity-0"}`}>
        <span className="text-xs font-bold">♭</span>
      </div>

      {/* Magic Sparks Animation when Active */}
      {isActive && (
        <div className="absolute inset-0 z-[-1]">
          <div className="absolute inset-0 rounded-[6px] animate-ping opacity-30 bg-teal-200"></div>
        </div>
      )}
      
      {/* Label */}
      <span className={`text-2xl font-black tracking-tight drop-shadow-sm ${isRoot ? "text-rose-800" : isBass ? "text-amber-800" : "text-[#3E3229]"} ${isActive && !isRoot && !isBass ? "text-teal-900" : ""}`} 
        style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
    </div>
  );
};

// 3. Result Card (Magic Scroll Style)
const ResultCard = ({ candidate, isTop, isKeySet }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;
  const invMap: Record<string, string> = { "root": "基本形", "1st": "第1転回", "2nd": "第2転回", "3rd": "第3転回", "unknown": "不明" };
  const invJp = invMap[candidate.inversion || "unknown"] || "―";

  return (
    <div className={`relative overflow-hidden transition-all duration-700 group animate-in slide-in-from-bottom-4 fade-in
      ${isTop 
        ? `${G.parchmentCard} ${G.magicGlow} p-6 bg-[radial-gradient(circle_at_top_left,_var(--tw-gradient-stops))] from-[#FDFBF7] to-[#F2EFE5]`
        : `${G.parchmentCard} p-4 bg-[#FDFBF7]/80`}
    `}>
      {/* Magic Circle Watermark */}
      <div className={`absolute -right-6 -bottom-8 font-serif font-black text-[#B48E43] select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-9xl opacity-20" : "text-7xl opacity-10"}`}>
        {String(isTop ? 1 : 2).padStart(2, '0')}
      </div>

      <div className="relative z-10 flex flex-col gap-4">
        {/* Header Section */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {isTop && (
                <span className={`px-3 py-0.5 rounded-sm text-[11px] font-bold font-serif tracking-wide border flex items-center gap-1 ${isProvisional ? G.accentRed : "bg-[#3E3229] text-[#B48E43] border-[#3E3229]"}`}>
                  <IconSparkles className="w-3 h-3" /> {isProvisional ? "暫定判定" : "判定結果"}
                </span>
              )}
              {candidate.chordType && (
                <span className="px-3 py-0.5 rounded-sm text-[11px] font-serif font-bold bg-[#E8E4D9] text-[#6D5E52] border border-[#C5B498]">
                  {candidate.chordType}
                </span>
              )}
            </div>
            <h2 className={`font-serif font-black text-[#3E3229] tracking-tighter leading-none drop-shadow-sm ${isTop ? "text-5xl" : "text-2xl"}`}>
              {candidate.chord}
            </h2>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[#8C7B70] font-bold font-serif uppercase tracking-widest mb-0.5">Confidence</span>
            <span className={`font-serif font-bold ${isTop ? "text-3xl text-[#B48E43]" : "text-sm text-[#8C7B70]"}`}>{percent}<span className="text-xs opacity-50 font-sans">%</span></span>
          </div>
        </div>

        {/* Function Analysis Grid */}
        {isKeySet ? (
          <div className="bg-[#E8E4D9]/50 rounded-[4px] p-2 border border-[#DBCAB0] grid grid-cols-12 gap-2 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('/noise.png')] opacity-10 mix-blend-overlay pointer-events-none"></div>
            {/* Function (TDS) */}
            <div className="col-span-4 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex flex-col items-center justify-center py-2 shadow-sm relative">
              <span className="text-[9px] font-bold text-[#8C7B70] uppercase tracking-widest mb-0.5">機能</span>
              <span className={`text-3xl font-serif font-black leading-none drop-shadow-sm ${
                candidate.tds === "T" ? "text-teal-700" : 
                candidate.tds === "D" ? "text-rose-700" : 
                candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-700" : "text-slate-400"
              }`}>
                {candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds}
              </span>
            </div>
            {/* Details */}
            <div className="col-span-8 flex flex-col gap-2">
               <div className="flex-1 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[10px] font-serif font-bold text-[#8C7B70]">記号 📜</span>
                  <span className="text-xl font-serif font-bold text-[#3E3229]">{candidate.romanNumeral || "―"}</span>
               </div>
               <div className="flex-1 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[10px] font-serif font-bold text-[#8C7B70]">転回 🎻</span>
                  <span className="text-xs font-bold text-[#6D5E52]">{invJp}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 bg-[#E8E4D9]/30 rounded-[4px] border-2 border-dashed border-[#DBCAB0]">
            <span className="text-[11px] font-serif font-bold text-[#8C7B70] flex items-center justify-center gap-2">
              <span>🗝️</span> Keyを設定して魔導書を解読
            </span>
          </div>
        )}

        {/* Confidence Bar (Magic Meter) */}
        <div className="h-2 w-full bg-[#E8E4D9] rounded-full overflow-hidden border border-[#DBCAB0] p-[1px]">
          <div className={`h-full rounded-full transition-all duration-1000 ease-out relative ${isTop ? "bg-gradient-to-r from-[#B48E43] to-teal-500" : "bg-[#8C7B70]"}`} style={{ width: `${percent}%` }}>
              {isTop && <div className="absolute inset-0 animate-pulse bg-white/30"></div>}
          </div>
        </div>
      </div>
    </div>
  );
};

// 4. Insight Card (Wizard Style)
const InsightCard = ({ text }: { text: string }) => (
  <div className={`relative rounded-[8px] overflow-hidden bg-[#FDFBF7] border-l-4 border-[#B48E43] shadow-md p-6`}>
    <div className="flex items-center gap-3 mb-3">
      <div className="w-10 h-10 rounded-full bg-[#3E3229] text-[#B48E43] flex items-center justify-center text-2xl shadow-sm border-2 border-[#B48E43]">
         🧙
      </div>
      <h3 className="text-sm font-serif font-bold text-[#3E3229]">賢者の考察</h3>
    </div>
    <p className="text-sm leading-relaxed text-[#4A403A] whitespace-pre-wrap font-serif font-medium relative z-10">{text}</p>
    <div className="absolute right-0 bottom-0 opacity-10 text-6xl pointer-events-none">📜</div>
  </div>
);

// 5. Ask Card (Magic Quill Style)
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp }: any) => (
  <div className={`relative rounded-[8px] overflow-hidden bg-gradient-to-br from-[#FDFBF7] to-[#F2EFE5] border-2 border-[#DBCAB0] p-6 shadow-sm`}>
    <h3 className="text-sm font-serif font-bold text-[#3E3229] mb-4 flex items-center gap-2">
      <span className="text-2xl">✨</span> 賢者に質問する
    </h3>
    <div className="relative group">
      <input 
        ref={inputRefProp}
        className="w-full bg-[#FDFBF7] border-2 border-[#C5B498] rounded-md py-4 pl-5 pr-14 text-base font-serif focus:outline-none focus:ring-2 focus:ring-[#B48E43]/50 focus:border-[#B48E43] transition-all shadow-inner placeholder:text-[#9C8B7A] text-[#3E3229]" 
        placeholder="例：この響きの秘密は？" 
        value={question} 
        onChange={(e) => setQuestion(e.target.value)} 
        onKeyDown={(e) => e.key === 'Enter' && ask()} 
        disabled={isThinking} 
      />
      <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-md text-[#FDFBF7] transition-all active:scale-95 shadow-sm flex items-center justify-center ${!question.trim() ? "bg-[#C5B498] text-[#E8E4D9]" : "bg-[#B48E43] hover:bg-[#9A7A3A] border border-[#8C7B70] shadow-[0_0_10px_rgba(180,142,67,0.5)]"}`}>
        <span className="text-lg">🪄</span>
      </button>
    </div>
  </div>
);

// 6. Loading Overlay (Cauldron & Potion)
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#2A211C]/80 backdrop-blur-sm animate-in fade-in duration-500">
    <div className="relative">
       <div className="w-32 h-32 bg-[#3E3229] rounded-full shadow-[0_0_40px_rgba(20,184,166,0.4)] flex items-center justify-center border-4 border-[#B48E43]/50 relative overflow-hidden animate-pulse-slow">
         <span className="text-6xl relative z-10">⚗️</span>
         {/* Potion liquid effect */}
         <div className="absolute bottom-0 left-0 right-0 bg-teal-500/30 h-1/2 w-full animate-wave rounded-b-full"></div>
       </div>
       <div className="absolute -top-2 -right-2 text-3xl animate-bounce">✨</div>
    </div>
    <div className="mt-8 text-center space-y-3">
      <h2 className="text-2xl font-serif font-black text-[#FDFBF7] tracking-wider drop-shadow-md">
        <span className="text-[#B48E43]">解読の儀</span>、執り行い中...
      </h2>
      <p className="text-sm font-serif text-teal-200/80 flex items-center justify-center gap-2">
        <IconSparkles className="w-4 h-4" /> 古代の文献を検索しています
      </p>
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

  const hasResult = candidates.length > 0;
  const topCandidate = hasResult ? candidates[0] : null;
  const otherCandidates = hasResult ? candidates.slice(1) : [];

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
      await new Promise(r => setTimeout(r, 1500)); // 魔法の詠唱時間を少し長く
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedNotes: selected, keyHint, bassHint, rootHint }),
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : { error: await res.text() };
      if (!res.ok) { setCandidates([]); setInfoText(`魔法エラー: ${data?.error}`); return; }
      setCandidates(normalizeCandidates(data.candidates));
      setInfoText((data.analysis ?? data.reason ?? "").trim());
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: any) { setInfoText(`通信エラー: ${e?.message}`); } finally { setLoading(false); }
  }

  async function ask() {
    const q = question.trim();
    if (!q || loading || isThinking) return;
    if (!canAnalyze || candidates.length === 0) { setAnswer("（まずは和音を確定させてから質問してください）"); return; }
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

  return (
    <div className={`min-h-screen ${G.bgMain} ${G.textMain} font-sans pb-[450px] selection:bg-amber-200 selection:text-[#3E3229] overflow-x-hidden`}>
      
      <style jsx global>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .animate-pulse-slow { animation: pulse-slow 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        @keyframes wave {
          0% { transform: translateY(0) scaleY(1); }
          50% { transform: translateY(-5px) scaleY(1.1); }
          100% { transform: translateY(0) scaleY(1); }
        }
        .animate-wave { animation: wave 2s ease-in-out infinite; }
      `}</style>

      {/* Background Texture & Magic Particles */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute inset-0 bg-[url('/noise.png')] opacity-5 mix-blend-multiply"></div> {/* ノイズ画像があれば */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-50/20 via-transparent to-transparent"></div>
        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-amber-50/20 via-transparent to-transparent"></div>
      </div>

      {loading && <LoadingOverlay />}

      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 bg-[#F2EFE5]/90 backdrop-blur-sm border-b-2 border-[#DBCAB0] flex items-center justify-between px-5 transition-all shadow-sm`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#3E3229] flex items-center justify-center text-[#B48E43] text-2xl border-2 border-[#B48E43] shadow-sm">
             🧙‍♂️
          </div>
          <div className="flex flex-col justify-center leading-none">
            <span className="text-[9px] font-serif font-bold text-[#6D5E52] tracking-widest mb-0.5 uppercase">Harmonic Grimoire</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-serif font-black tracking-tight text-[#3E3229] drop-shadow-sm`}>Cadencia AI</span>
              <FeedbackLink className="bg-[#E8E4D9] border border-[#C5B498] text-[9px] font-serif font-bold text-[#6D5E52] px-2 py-0.5 rounded-sm hover:bg-[#DBCAB0] transition-colors flex items-center gap-1">
                <span>BETA</span>
              </FeedbackLink>
            </div>
          </div>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-6 relative z-10">
        
        {/* Hero Section (Stylish Magic Title) */}
        {!hasResult && (
          <section className="text-center space-y-5 animate-in fade-in zoom-in duration-1000 py-8 relative">
            {/* Magical Aura Background */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle,_var(--tw-gradient-stops))] from-[#B48E43]/20 via-transparent to-transparent blur-2xl -z-10 animate-pulse-slow"></div>
            
            <div className="relative inline-block">
               <h1 className={`text-5xl font-serif font-black tracking-tighter text-[#3E3229] leading-none drop-shadow-md relative z-10`}>
                 Cadencia AI
               </h1>
               {/* Magic Sparkles around title */}
               <div className="absolute -top-4 -left-6 text-3xl text-[#B48E43] animate-bounce opacity-80">✨</div>
               <div className="absolute -bottom-2 -right-4 text-2xl text-teal-500 animate-pulse opacity-80">🪄</div>
            </div>
            
            <p className="text-base font-serif font-bold text-[#6D5E52] flex items-center justify-center gap-3 tracking-wide">
              <span className="h-px w-8 bg-[#B48E43]/50"></span>
              <span className="relative">
                ポケットに、専属の音楽理論家を。
                <span className="absolute -bottom-1 left-0 w-full h-1 bg-[#B48E43]/30 -skew-x-12"></span>
              </span>
              <span className="h-px w-8 bg-[#B48E43]/50"></span>
            </p>
          </section>
        )}

        {/* Input Monitor Card (Frame) */}
        <section className={`${G.parchmentCard} p-5 transition-all duration-300 relative ${justUpdated ? G.magicGlow : ""}`}>
           {/* Corner Decorations (Brass style) */}
           <div className="absolute top-0 left-0 w-3 h-3 border-t-4 border-l-4 border-[#B48E43] rounded-tl-sm"></div>
           <div className="absolute top-0 right-0 w-3 h-3 border-t-4 border-r-4 border-[#B48E43] rounded-tr-sm"></div>
           <div className="absolute bottom-0 left-0 w-3 h-3 border-b-4 border-l-4 border-[#B48E43] rounded-bl-sm"></div>
           <div className="absolute bottom-0 right-0 w-3 h-3 border-b-4 border-r-4 border-[#B48E43] rounded-br-sm"></div>

           <div className="flex justify-between items-center mb-4 relative z-10">
              <h3 className="text-xs font-serif font-bold text-[#6D5E52] uppercase tracking-wider flex items-center gap-2">
                <IconKeyboard className="w-4 h-4" /> Input Monitor
              </h3>
              <span className="text-[10px] font-serif font-bold text-[#3E3229] bg-[#E8E4D9] px-2 py-1 rounded-sm border border-[#C5B498] shadow-sm">{selected.length} Runes</span>
           </div>
           
           <div className="flex flex-wrap gap-2 mb-4 min-h-[2.5rem] relative z-10">
             {selected.length === 0 ? (
               <div className="w-full text-center py-3 bg-[#F2EFE5] rounded-sm border-2 border-dashed border-[#C5B498]">
                 <span className="text-xs font-serif text-[#8C7B70] italic">🎹 鍵盤を弾いて音を追加...</span>
               </div>
             ) : (
               sortedSelected.map((note) => (
                 <span key={note} className={`px-3 py-1.5 border-2 border-b-4 shadow-sm rounded-sm text-sm font-bold font-serif animate-in zoom-in duration-200 ${
                   rootHint === note 
                     ? G.accentRed
                     : bassHint === note 
                       ? "bg-amber-100 border-amber-400 text-amber-900" 
                       : "bg-[#FDFBF7] border-[#C5B498] text-[#3E3229]"
                 }`}>
                   {note}
                   {rootHint === note && <span className="ml-1 text-[9px] opacity-70 font-sans">R</span>}
                   {bassHint === note && <span className="ml-1 text-[9px] opacity-70 font-sans">B</span>}
                 </span>
               ))
             )}
           </div>

           <div className="pt-4 border-t-2 border-dashed border-[#DBCAB0] relative z-10">
              <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
             
             <div className="flex items-center gap-3 px-1">
               <IconSparkles className="w-5 h-5 text-[#B48E43]" />
               <h2 className="text-sm font-serif font-black text-[#3E3229] uppercase tracking-widest">Analysis Result</h2>
               <div className="h-[2px] flex-1 bg-[#DBCAB0] relative">
                 <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-[#B48E43] rotate-45"></div>
               </div>
             </div>

             {topCandidate && <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />}

             {infoText && <InsightCard text={infoText} />}

             {otherCandidates.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center justify-center py-2">
                   <span className="text-[10px] font-serif font-bold text-[#6D5E52] uppercase tracking-widest bg-[#E8E4D9] border border-[#C5B498] px-4 py-1.5 rounded-sm shadow-sm flex items-center gap-2">
                     <span>📜</span> Other Candidates
                   </span>
                 </div>
                 {otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}
               </div>
             )}

             <div className="pt-4 pb-8">
               {answer && (
                 <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                   <div className="bg-[#3E3229] border-2 border-[#B48E43] rounded-[8px] p-6 text-sm text-[#FDFBF7] leading-relaxed shadow-lg relative">
                     <div className="absolute -top-4 -left-3 w-10 h-10 bg-[#B48E43] rounded-full flex items-center justify-center border-2 border-[#3E3229] shadow-sm">
                       <span className="text-2xl">🧙‍♂️</span>
                     </div>
                     <div className="pl-4 font-serif relative z-10">{answer}</div>
                     {/* Magic Dust */}
                     <div className="absolute bottom-2 right-2 text-[#B48E43] opacity-30 text-xl">✨</div>
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

      {/* --- Floating Rune Keyboard --- */}
      <div className={`fixed bottom-0 inset-x-0 z-50 bg-[#F2EFE5]/95 backdrop-blur-md border-t-4 border-[#DBCAB0] rounded-t-[24px] pt-6 pb-8 shadow-[0_-10px_40px_rgba(62,50,41,0.3)] transition-transform duration-300 relative`}>
        {/* Decorative border top */}
        <div className="absolute top-[-4px] left-1/2 -translate-x-1/2 w-16 h-1 bg-[#B48E43] rounded-full"></div>
        
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-4 grid-rows-4 gap-2.5 h-full">
            
            {/* Row 1 */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-[6px] bg-[#E8E4D9] border-2 border-[#C5B498] text-[#6D5E52] active:bg-rose-100 active:text-rose-800 active:border-rose-300 transition-all flex items-center justify-center shadow-[2px_2px_0px_#B0A080] active:translate-y-[2px] active:shadow-none" onClick={reset}><IconTrash /></button>

            {/* Row 2 */}
            <FlickKey className="col-start-1 row-start-2" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} onInput={handleKeyInput} />

            {/* Row 3: Mode & Key */}
            <div className="col-start-1 row-start-3 h-14 flex flex-col gap-1.5">
               <button onClick={() => setInputMode(m => m === "root" ? "normal" : "root")} className={`flex-1 rounded-[6px] text-[10px] font-serif font-bold transition-all border-2 shadow-sm ${inputMode === "root" ? G.accentRed : "bg-[#FDFBF7] text-[#6D5E52] border-[#C5B498]"}`}>Root</button>
               <button onClick={() => setInputMode(m => m === "bass" ? "normal" : "bass")} className={`flex-1 rounded-[6px] text-[10px] font-serif font-bold transition-all border-2 shadow-sm ${inputMode === "bass" ? "bg-amber-100 border-amber-400 text-amber-900" : "bg-[#FDFBF7] text-[#6D5E52] border-[#C5B498]"}`}>Bass</button>
            </div>

            <div className="col-start-2 col-span-2 row-start-3 h-14 bg-[#FDFBF7] rounded-[6px] border-2 border-[#C5B498] shadow-inner flex items-center overflow-hidden">
                <div className="flex-[0.8] flex items-center justify-center border-r-2 border-dashed border-[#C5B498] h-full px-1 bg-[#F2EFE5]">
                   <span className="text-[10px] font-serif font-bold text-[#8C7B70] leading-tight text-center">Key</span>
                </div>
                <div className="flex-1 relative h-full border-r-2 border-dashed border-[#C5B498] group active:bg-[#E8E4D9] transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>{KEYS_ROOT.map(k => <option key={k} value={k}>{k === "none" ? "None" : k}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-serif font-bold ${keyRoot === "none" ? "text-[#C5B498]" : "text-[#3E3229]"}`}>{keyRoot === "none" ? "-" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-[#E8E4D9] transition-colors ${keyRoot === "none" ? "opacity-30" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k}>{k === "Major" ? "Maj" : "min"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-[10px] font-serif font-bold ${keyRoot === "none" ? "text-[#C5B498]" : "text-[#6D5E52]"}`}>{keyType === "Major" ? "Maj" : "min"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-[6px] flex flex-col items-center justify-center shadow-[4px_4px_0px_#3E3229] transition-all border-2 active:translate-y-[2px] active:shadow-[2px_2px_0px_#3E3229] border-[#3E3229] ${canAnalyze && !loading ? "bg-[#3E3229] text-[#B48E43]" : "bg-[#C5B498] border-[#B0A080] text-[#F2EFE5] cursor-not-allowed shadow-none"}`} onClick={analyze} disabled={!canAnalyze || loading}>
               <div className="relative z-10 flex flex-col items-center">
                 {loading ? <IconRefresh className="animate-spin" /> : <IconArrowRight />}
                 <span className="text-[10px] font-serif font-bold mt-1 text-center leading-tight">解読</span>
               </div>
            </button>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className={`col-start-1 col-span-3 row-start-4 h-14 rounded-[6px] border-2 border-[#B48E43] font-serif font-bold shadow-sm active:scale-95 flex items-center justify-center gap-3 relative overflow-hidden group bg-[#FDFBF7] text-[#3E3229] hover:bg-[#E8E4D9]`}>
               <span className="text-xl">🪄</span>
               <span className={`text-xs font-bold`}>賢者に尋ねる</span>
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