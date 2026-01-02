"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants: Harmonic Spellbook (Magic Style) ---
const G = {
  // 背景: 古びた羊皮紙（エイジド・パーチメント）
  bgMain: "bg-[#F2EFE5]",
  
  // テキスト: 魔法使いのインク（深いブラウンブラック）
  textMain: "text-[#2A211C]",
  textSub: "text-[#5D524A]",
  
  // アクセント: 賢者のゴールド、魔法のシアン
  accentGold: "text-[#B45309] border-[#B45309]",
  accentMagic: "text-cyan-700 bg-cyan-50 border-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.3)]",
  
  // マテリアル: 魔法がかけられた石板（キーボード用）
  stonePlate: "bg-[#E6DECA] border border-[#C5B498] shadow-[2px_4px_0_#B0A080] active:translate-y-[2px] active:shadow-none transition-all duration-150",
  
  // マテリアル: 羊皮紙のカード
  parchment: "bg-[#FDFBF7] border border-[#DBCAB0] shadow-md shadow-[#2A211C]/5 rounded-[2px]",
  
  // 魔法の輝き（選択状態）
  glow: "shadow-[0_0_15px_rgba(251,191,36,0.6)] border-amber-400 z-10",
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

// 1. Mini Piano (Ivory & Ebony Style)
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
    <div className="h-16 w-full relative select-none pointer-events-none p-1 bg-[#2A211C] rounded-sm shadow-inner">
       <svg viewBox="0 0 100 50" className="w-full h-full">
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v44 a2,2 0 0 1 -2,2 h-10.28 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-300" : isBass(k.idx) ? "fill-amber-200" : "fill-cyan-200") 
                 : "fill-[#FDFBF7]"
             } stroke-[#DBCAB0] stroke-[0.5]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 a2,2 0 0 1 -2,2 h-4 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-600" : isBass(k.idx) ? "fill-amber-500" : "fill-cyan-500") 
                 : "fill-[#1A1512] stroke-[#3E3229]"
             }`} />
         ))}
       </svg>
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
      relative rounded-[4px] touch-none select-none overflow-visible flex flex-col items-center justify-center z-0
      font-serif
      ${isRoot ? "bg-rose-50 border border-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.4)]" 
        : isBass ? "bg-amber-50 border border-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.4)]" 
        : G.stonePlate}
      ${!isBass && !isRoot && isActive ? "bg-cyan-50 border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)]" : ""}
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* Ancient Rune Guides */}
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all ${isUp ? "opacity-100 -translate-y-1 text-cyan-700" : "opacity-0"}`}>
        <span className="text-[10px] font-bold">♯</span>
      </div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all ${isDown ? "opacity-100 translate-y-1 text-cyan-700" : "opacity-0"}`}>
        <span className="text-[10px] font-bold">♭</span>
      </div>

      {/* Magic Sparks */}
      {isActive && <div className="absolute inset-0 rounded-md border border-white/50 animate-pulse"></div>}
      
      {/* Label */}
      <span className={`text-2xl font-black tracking-tight ${isRoot ? "text-rose-800" : isBass ? "text-amber-800" : "text-[#2A211C]"} ${isActive && !isRoot && !isBass ? "text-cyan-900" : ""}`} 
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
        ? `bg-[#FDFBF7] border-2 border-amber-400/60 shadow-[0_0_20px_rgba(251,191,36,0.2)] rounded-[8px] p-6`
        : "bg-[#FDFBF7]/80 border border-[#DBCAB0] shadow-sm rounded-[6px] p-4"}
    `}>
      {/* Magic Circle Watermark */}
      <div className={`absolute -right-6 -bottom-8 font-serif font-black text-[#E6DECA] select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-9xl opacity-50" : "text-7xl opacity-30"}`}>
        {String(isTop ? 1 : 2).padStart(2, '0')}
      </div>

      <div className="relative z-10 flex flex-col gap-4">
        {/* Header Section */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {isTop && (
                <span className={`px-3 py-0.5 rounded-sm text-[11px] font-bold font-serif tracking-wide border ${isProvisional ? "bg-amber-100 text-amber-900 border-amber-300" : "bg-[#2A211C] text-amber-400 border-[#2A211C]"}`}>
                  {isProvisional ? "⚠️ 暫定" : "✦ 判定結果"}
                </span>
              )}
              {candidate.chordType && (
                <span className="px-3 py-0.5 rounded-sm text-[11px] font-serif font-bold bg-[#F2EFE5] text-[#5D524A] border border-[#DBCAB0]">
                  {candidate.chordType}
                </span>
              )}
            </div>
            <h2 className={`font-serif font-black text-[#2A211C] tracking-tighter leading-none ${isTop ? "text-5xl drop-shadow-sm" : "text-2xl"}`}>
              {candidate.chord}
            </h2>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[#8C7B70] font-bold font-serif uppercase tracking-widest mb-0.5">Confidence</span>
            <span className={`font-serif font-bold ${isTop ? "text-3xl text-amber-700" : "text-sm text-[#8C7B70]"}`}>{percent}<span className="text-xs opacity-50 font-sans">%</span></span>
          </div>
        </div>

        {/* Function Analysis Grid */}
        {isKeySet ? (
          <div className="bg-[#E6DECA]/50 rounded-[4px] p-2 border border-[#DBCAB0] grid grid-cols-12 gap-2">
            {/* Function (TDS) */}
            <div className="col-span-4 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex flex-col items-center justify-center py-2 shadow-sm">
              <span className="text-[9px] font-bold text-[#8C7B70] uppercase tracking-widest mb-0.5">機能</span>
              <span className={`text-3xl font-serif font-black leading-none ${
                candidate.tds === "T" ? "text-cyan-800" : 
                candidate.tds === "D" ? "text-rose-800" : 
                candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-800" : "text-slate-400"
              }`}>
                {candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds}
              </span>
            </div>
            {/* Details */}
            <div className="col-span-8 flex flex-col gap-2">
               <div className="flex-1 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[10px] font-serif font-bold text-[#8C7B70]">記号</span>
                  <span className="text-xl font-serif font-bold text-[#2A211C]">{candidate.romanNumeral || "―"}</span>
               </div>
               <div className="flex-1 bg-[#FDFBF7] rounded-[2px] border border-[#E6DECA] flex items-center justify-between px-4 shadow-sm">
                  <span className="text-[10px] font-serif font-bold text-[#8C7B70]">転回</span>
                  <span className="text-xs font-bold text-[#5D524A]">{invJp}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 bg-[#E6DECA]/30 rounded-[4px] border border-dashed border-[#DBCAB0]">
            <span className="text-[11px] font-serif font-bold text-[#8C7B70] flex items-center justify-center gap-2">
              <span>🗝️</span> Keyを設定して魔導書を解読
            </span>
          </div>
        )}

        {/* Confidence Bar (Ink Style) */}
        <div className="h-1.5 w-full bg-[#E6DECA] rounded-full overflow-hidden border border-[#DBCAB0]">
          <div className={`h-full transition-all duration-1000 ease-out ${isTop ? "bg-[#2A211C]" : "bg-[#8C7B70]"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
};

// 4. Insight Card (Owl Style)
const InsightCard = ({ text }: { text: string }) => (
  <div className={`relative rounded-[8px] overflow-hidden bg-[#FDFBF7] border border-[#DBCAB0] shadow-md p-6`}>
    <div className="flex items-center gap-3 mb-3">
      <div className="w-8 h-8 rounded-full bg-[#2A211C] text-amber-400 flex items-center justify-center text-lg shadow-sm border border-amber-600/50">
         🦉
      </div>
      <h3 className="text-sm font-serif font-bold text-[#2A211C]">賢者の考察</h3>
    </div>
    <p className="text-sm leading-relaxed text-[#4A403A] whitespace-pre-wrap font-serif font-medium">{text}</p>
  </div>
);

// 5. Ask Card (Quill Style)
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp }: any) => (
  <div className={`relative rounded-[8px] overflow-hidden bg-[#FDFBF7] border border-[#DBCAB0] p-6 shadow-sm`}>
    <h3 className="text-sm font-serif font-bold text-[#2A211C] mb-4 flex items-center gap-2">
      <span className="text-xl">📜</span> 魔導書に質問する
    </h3>
    <div className="relative group">
      <input 
        ref={inputRefProp}
        className="w-full bg-[#F2EFE5] border border-[#C5B498] rounded-md py-4 pl-5 pr-14 text-base font-serif focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-500 transition-all shadow-inner placeholder:text-[#9C8B7A] text-[#2A211C]" 
        placeholder="例：この響きの秘密は？" 
        value={question} 
        onChange={(e) => setQuestion(e.target.value)} 
        onKeyDown={(e) => e.key === 'Enter' && ask()} 
        disabled={isThinking} 
      />
      <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-md text-[#FDFBF7] transition-all active:scale-95 shadow-sm ${!question.trim() ? "bg-[#C5B498]" : "bg-[#2A211C] hover:bg-[#4A3B32] border border-amber-600/30"}`}>
        <IconSend className="w-4 h-4" />
      </button>
    </div>
  </div>
);

// 6. Loading Overlay (Cauldron Style)
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#2A211C]/80 backdrop-blur-sm animate-in fade-in duration-500">
    <div className="relative w-28 h-28 bg-[#2A211C] rounded-full shadow-[0_0_30px_rgba(251,191,36,0.3)] flex items-center justify-center border-2 border-amber-600/50 animate-pulse">
       <span className="text-5xl animate-bounce">🕯️</span>
    </div>
    <div className="mt-6 text-center space-y-2">
      <h2 className="text-xl font-serif font-bold text-[#FDFBF7] tracking-wider">解読の儀、執り行い中...</h2>
      <p className="text-xs font-serif text-amber-200/70">古代の文献を検索しています</p>
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
      await new Promise(r => setTimeout(r, 1200)); // 魔法の詠唱時間
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
    <div className={`min-h-screen ${G.bgMain} ${G.textMain} font-sans pb-[450px] selection:bg-amber-200 overflow-x-hidden`}>
      
      {/* Background Texture (Parchment Vibe) */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0 opacity-30">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/0 via-[#DBCAB0]/20 to-[#DBCAB0]/40"></div>
      </div>

      {loading && <LoadingOverlay />}

      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 bg-[#F2EFE5]/90 backdrop-blur-sm border-b-2 border-[#DBCAB0] flex items-center justify-between px-5 transition-all shadow-sm`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-[#2A211C] flex items-center justify-center text-amber-400 text-xl border border-amber-600 shadow-md">
             🧙‍♂️
          </div>
          <div className="flex flex-col justify-center leading-none">
            <span className="text-[9px] font-serif font-bold text-[#5D524A] tracking-widest mb-0.5 uppercase">Harmonic Spellbook</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-serif font-black tracking-tight text-[#2A211C]`}>Cadencia AI</span>
              <FeedbackLink className="bg-[#E6DECA] border border-[#C5B498] text-[9px] font-serif font-bold text-[#5D524A] px-2 py-0.5 rounded hover:bg-[#DBCAB0] transition-colors flex items-center gap-1">
                <span>BETA</span>
              </FeedbackLink>
            </div>
          </div>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-6 relative z-10">
        
        {/* Hero */}
        {!hasResult && (
          <section className="text-center space-y-4 animate-in fade-in zoom-in duration-1000 py-6">
            <h1 className={`text-3xl font-serif font-black tracking-tight text-[#2A211C] leading-tight drop-shadow-sm`}>
              ポケットに、<br/><span className="text-amber-700 decoration-amber-400/50 underline decoration-4 underline-offset-4">専属の音楽理論家</span>を。
            </h1>
            <p className="text-xs font-serif font-bold text-[#5D524A] flex items-center justify-center gap-2 tracking-widest uppercase">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2A211C]"></span>
              The Music Theory Grimoire
              <span className="w-1.5 h-1.5 rounded-full bg-[#2A211C]"></span>
            </p>
          </section>
        )}

        {/* Input Monitor Card (Frame) */}
        <section className={`bg-[#FDFBF7] border-4 border-[#DBCAB0] shadow-xl shadow-[#2A211C]/10 rounded-[4px] p-5 transition-all duration-300 relative ${justUpdated ? "ring-2 ring-amber-400" : ""}`}>
           {/* Corner Decorations */}
           <div className="absolute top-1 left-1 w-2 h-2 border-t-2 border-l-2 border-[#8C7B70]"></div>
           <div className="absolute top-1 right-1 w-2 h-2 border-t-2 border-r-2 border-[#8C7B70]"></div>
           <div className="absolute bottom-1 left-1 w-2 h-2 border-b-2 border-l-2 border-[#8C7B70]"></div>
           <div className="absolute bottom-1 right-1 w-2 h-2 border-b-2 border-r-2 border-[#8C7B70]"></div>

           <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-serif font-bold text-[#5D524A] uppercase tracking-wider flex items-center gap-2">
                <IconKeyboard className="w-4 h-4" /> Input Monitor
              </h3>
              <span className="text-[10px] font-serif font-bold text-[#2A211C] bg-[#E6DECA] px-2 py-1 rounded border border-[#C5B498]">{selected.length} Runes</span>
           </div>
           
           <div className="flex flex-wrap gap-2 mb-4 min-h-[2.5rem]">
             {selected.length === 0 ? (
               <div className="w-full text-center py-3 bg-[#F2EFE5] rounded border border-dashed border-[#C5B498]">
                 <span className="text-xs font-serif text-[#8C7B70] italic">鍵盤を弾いて音を追加...</span>
               </div>
             ) : (
               sortedSelected.map((note) => (
                 <span key={note} className={`px-3 py-1.5 border border-b-4 shadow-sm rounded text-sm font-bold font-serif animate-in zoom-in duration-200 ${
                   rootHint === note 
                     ? "bg-rose-100 border-rose-300 text-rose-900" 
                     : bassHint === note 
                       ? "bg-amber-100 border-amber-300 text-amber-900" 
                       : "bg-[#FDFBF7] border-[#C5B498] text-[#2A211C]"
                 }`}>
                   {note}
                   {rootHint === note && <span className="ml-1 text-[9px] opacity-70 font-sans">R</span>}
                   {bassHint === note && <span className="ml-1 text-[9px] opacity-70 font-sans">B</span>}
                 </span>
               ))
             )}
           </div>

           <div className="pt-2 border-t-2 border-dashed border-[#DBCAB0]">
              <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
             
             <div className="flex items-center gap-3 px-1">
               <div className="h-[2px] w-4 bg-[#2A211C]"></div>
               <h2 className="text-sm font-serif font-black text-[#2A211C] uppercase tracking-widest">Analysis Result</h2>
               <div className="h-[2px] flex-1 bg-[#2A211C]"></div>
             </div>

             {topCandidate && <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />}

             {infoText && <InsightCard text={infoText} />}

             {otherCandidates.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center justify-center py-2">
                   <span className="text-[10px] font-serif font-bold text-[#5D524A] uppercase tracking-widest bg-[#E6DECA] border border-[#C5B498] px-4 py-1.5 rounded shadow-sm">Other Candidates</span>
                 </div>
                 {otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}
               </div>
             )}

             <div className="pt-4 pb-8">
               {answer && (
                 <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                   <div className="bg-[#2A211C] border-2 border-amber-600/50 rounded-[4px] p-5 text-sm text-[#FDFBF7] leading-relaxed shadow-lg relative">
                     <span className="absolute -top-3 -left-2 text-3xl filter drop-shadow-md">🔮</span>
                     <div className="pl-2 font-serif">{answer}</div>
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
      <div className={`fixed bottom-0 inset-x-0 z-50 bg-[#F2EFE5]/95 backdrop-blur-md border-t-4 border-[#DBCAB0] rounded-t-[32px] pt-5 pb-8 shadow-[0_-10px_40px_rgba(42,33,28,0.2)] transition-transform duration-300`}>
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-4 grid-rows-4 gap-2 h-full">
            
            {/* Row 1 */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-[4px] bg-[#E6DECA] border border-[#C5B498] text-[#5D524A] active:bg-rose-100 active:text-rose-800 transition-all flex items-center justify-center shadow-sm active:scale-95" onClick={reset}><IconTrash /></button>

            {/* Row 2 */}
            <FlickKey className="col-start-1 row-start-2" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} onInput={handleKeyInput} />

            {/* Row 3: Mode & Key */}
            <div className="col-start-1 row-start-3 h-14 flex flex-col gap-1">
               <button onClick={() => setInputMode(m => m === "root" ? "normal" : "root")} className={`flex-1 rounded-[4px] text-[10px] font-serif font-bold transition-all border-b-2 ${inputMode === "root" ? "bg-rose-600 border-rose-800 text-[#FDFBF7]" : "bg-[#FDFBF7] text-[#5D524A] border-[#C5B498]"}`}>Root</button>
               <button onClick={() => setInputMode(m => m === "bass" ? "normal" : "bass")} className={`flex-1 rounded-[4px] text-[10px] font-serif font-bold transition-all border-b-2 ${inputMode === "bass" ? "bg-amber-600 border-amber-800 text-[#FDFBF7]" : "bg-[#FDFBF7] text-[#5D524A] border-[#C5B498]"}`}>Bass</button>
            </div>

            <div className="col-start-2 col-span-2 row-start-3 h-14 bg-[#FDFBF7] rounded-[4px] border border-[#C5B498] shadow-inner flex items-center overflow-hidden">
                <div className="flex-[0.8] flex items-center justify-center border-r border-dashed border-[#C5B498] h-full px-1 bg-[#F2EFE5]">
                   <span className="text-[10px] font-serif font-bold text-[#8C7B70] leading-tight text-center">Key</span>
                </div>
                <div className="flex-1 relative h-full border-r border-dashed border-[#C5B498] group active:bg-[#E6DECA] transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>{KEYS_ROOT.map(k => <option key={k} value={k}>{k === "none" ? "None" : k}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-serif font-bold ${keyRoot === "none" ? "text-[#C5B498]" : "text-[#2A211C]"}`}>{keyRoot === "none" ? "-" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-[#E6DECA] transition-colors ${keyRoot === "none" ? "opacity-30" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k}>{k === "Major" ? "Maj" : "min"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-[10px] font-serif font-bold ${keyRoot === "none" ? "text-[#C5B498]" : "text-[#5D524A]"}`}>{keyType === "Major" ? "Maj" : "min"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-[4px] flex flex-col items-center justify-center shadow-md transition-all border-b-4 active:border-b-0 active:translate-y-1 border-[#2A211C] ${canAnalyze && !loading ? "bg-[#2A211C] text-amber-400" : "bg-[#C5B498] border-[#B0A080] text-[#FDFBF7] cursor-not-allowed"}`} onClick={analyze} disabled={!canAnalyze || loading}>
               <div className="relative z-10 flex flex-col items-center">
                 {loading ? <IconRefresh className="animate-spin" /> : <IconArrowRight />}
                 <span className="text-[10px] font-serif font-bold mt-1 text-center leading-tight">解読</span>
               </div>
            </button>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className={`col-start-1 col-span-3 row-start-4 h-14 rounded-[4px] border border-[#C5B498] font-serif font-bold shadow-sm active:scale-95 flex items-center justify-center gap-2 relative overflow-hidden group bg-[#FDFBF7] text-[#2A211C] hover:bg-[#E6DECA]`}>
               <IconSparkles className="w-4 h-4 text-amber-500" />
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