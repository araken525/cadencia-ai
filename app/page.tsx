"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants: THE CLASSIC (Henle Style) ---
const G = {
  // 背景: 上質なクリーム色の楽譜用紙
  bgMain: "bg-[#F5F2E9]", 
  
  // テキスト: 深い鉄紺色のインク (Iron Blue)
  textMain: "text-[#2C3E50]",
  textSub: "text-[#5D6D7E]",
  
  // ボーダー: インクの細線
  border: "border-[#2C3E50]",
  borderSub: "border-[#B2BABB]",
  
  // アクセント: 落ち着いたロイヤルブルー（主機能）、エンジ（強調）、深緑（安定）
  accentBlue: "text-[#1A5276] bg-[#D4E6F1] border-[#1A5276]",
  accentRed: "text-[#922B21] bg-[#F2D7D5] border-[#922B21]",
  accentGreen: "text-[#196F3D] bg-[#D5F5E3] border-[#196F3D]",
  
  // マテリアル: 厚手の紙（カード用）
  paperCard: "bg-[#FDFFEF] border border-[#2C3E50]/30 shadow-sm rounded-sm",
  paperHigh: "bg-[#FFFFFF] border-2 border-[#2C3E50] shadow-md rounded-sm", // トップ判定用
  
  // キーボード: ピアノの白鍵と黒鍵の質感
  keyWhite: "bg-[#FFFFFF] border border-[#BDC3C7] shadow-[0_2px_0_#95A5A6] active:translate-y-[1px] active:shadow-none transition-all",
  keyActive: "bg-[#2C3E50] text-[#F5F2E9] shadow-none border border-[#2C3E50]",
  
  // ボタン: 堅実な印字ボタン
  btnPrimary: "bg-[#2C3E50] text-[#F5F2E9] border border-[#2C3E50] hover:bg-[#34495E] transition-colors",
  btnDisabled: "bg-[#D5D8DC] text-[#ABB2B9] border border-[#D5D8DC]",
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

// 1. Mini Piano (Diagram Style)
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
    <div className="h-16 w-full relative select-none pointer-events-none border border-[#2C3E50] bg-white">
       <svg viewBox="0 0 100 50" className="w-full h-full">
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v49 a1,1 0 0 1 -1,1 h-12.28 a1,1 0 0 1 -1,-1 z`}
             className={`transition-all duration-0 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-[#922B21]" : isBass(k.idx) ? "fill-[#D35400]" : "fill-[#2471A3]") 
                 : "fill-white"
             } stroke-[#2C3E50] stroke-[0.5]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 h-8 z`}
             className={`transition-all duration-0 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-[#922B21]" : isBass(k.idx) ? "fill-[#D35400]" : "fill-[#2471A3]") 
                 : "fill-[#2C3E50] stroke-[#2C3E50]"
             }`} />
         ))}
       </svg>
    </div>
  );
};

// 2. Flick Key (Serif & Print Style)
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
      relative rounded-sm touch-none select-none overflow-visible flex flex-col items-center justify-center z-0 font-serif
      ${isRoot ? "bg-[#F2D7D5] border border-[#922B21] text-[#922B21]" 
        : isBass ? "bg-[#FDEBD0] border border-[#D35400] text-[#D35400]" 
        : G.keyWhite}
      ${!isBass && !isRoot && isActive ? G.keyActive : ""}
      ${!isActive && !isRoot && !isBass ? "text-[#2C3E50]" : ""}
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* Guide Indicators */}
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all ${isUp ? "opacity-100 -translate-y-1 font-bold" : "opacity-0"}`}>
        <span className="text-[10px]">♯</span>
      </div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all ${isDown ? "opacity-100 translate-y-1 font-bold" : "opacity-0"}`}>
        <span className="text-[10px]">♭</span>
      </div>

      {/* Label */}
      <span className={`text-2xl font-bold tracking-tight`} 
        style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
    </div>
  );
};

// 3. Result Card (Official Score Style)
const ResultCard = ({ candidate, isTop, isKeySet }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;
  const invMap: Record<string, string> = { "root": "基本形", "1st": "第1転回", "2nd": "第2転回", "3rd": "第3転回", "unknown": "不明" };
  const invJp = invMap[candidate.inversion || "unknown"] || "―";

  return (
    <div className={`relative overflow-hidden transition-all duration-500 group animate-in slide-in-from-bottom-4 fade-in
      ${isTop 
        ? G.paperHigh
        : G.paperCard}
    `}>
      {/* Rank Number (Watermark Style) */}
      <div className={`absolute -right-4 -bottom-8 font-serif font-bold text-[#2C3E50] select-none z-0 pointer-events-none transform -rotate-12 ${isTop ? "text-9xl opacity-5" : "text-7xl opacity-5"}`}>
        {String(isTop ? 1 : 2).padStart(2, '0')}
      </div>

      <div className="relative z-10 flex flex-col gap-4 p-5">
        {/* Header Section */}
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2 items-center">
              {isTop && (
                <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wide border font-serif ${isProvisional ? G.accentRed : "bg-[#2C3E50] text-[#F5F2E9] border-[#2C3E50]"}`}>
                  {isProvisional ? "暫定判定" : "判定結果"}
                </span>
              )}
              {candidate.chordType && (
                <span className="px-2 py-0.5 text-[10px] font-bold border border-[#2C3E50] text-[#2C3E50] font-serif">
                  {candidate.chordType}
                </span>
              )}
            </div>
            <h2 className={`font-serif font-bold text-[#2C3E50] tracking-tight leading-none ${isTop ? "text-4xl" : "text-2xl"}`}>
              {candidate.chord}
            </h2>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[9px] text-[#5D6D7E] font-bold uppercase tracking-widest mb-0.5 font-serif">Confidence</span>
            <span className={`font-serif font-bold ${isTop ? "text-3xl text-[#2C3E50]" : "text-sm text-[#5D6D7E]"}`}>{percent}<span className="text-xs opacity-50 font-sans">%</span></span>
          </div>
        </div>

        {/* Function Analysis Grid */}
        {isKeySet ? (
          <div className="border-t border-b border-[#2C3E50]/20 py-3 grid grid-cols-12 gap-3">
            {/* Function (TDS) */}
            <div className="col-span-4 flex flex-col items-center justify-center border-r border-[#2C3E50]/20 pr-3">
              <span className="text-[9px] font-bold text-[#5D6D7E] uppercase tracking-widest mb-0.5 font-serif">機能</span>
              <span className={`text-3xl font-serif font-bold leading-none ${
                candidate.tds === "T" ? "text-[#1A5276]" : 
                candidate.tds === "D" ? "text-[#922B21]" : 
                candidate.tds === "S" || candidate.tds === "SD" ? "text-[#196F3D]" : "text-[#7F8C8D]"
              }`}>
                {candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds}
              </span>
            </div>
            {/* Details */}
            <div className="col-span-8 flex flex-col justify-center gap-1">
               <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#5D6D7E] font-serif">記号</span>
                  <span className="text-lg font-serif font-bold text-[#2C3E50]">{candidate.romanNumeral || "―"}</span>
               </div>
               <div className="h-[1px] w-full bg-[#2C3E50]/10"></div>
               <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[#5D6D7E] font-serif">転回</span>
                  <span className="text-xs font-bold text-[#2C3E50] font-serif">{invJp}</span>
               </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-4 border border-dashed border-[#B2BABB] rounded-sm bg-[#FDFCF8]">
            <span className="text-[10px] font-bold text-[#5D6D7E] font-serif">
              Keyを設定して機能を分析
            </span>
          </div>
        )}

        {/* Confidence Bar (Simple Ink Line) */}
        <div className="h-1 w-full bg-[#E5E8E8] overflow-hidden">
          <div className={`h-full transition-all duration-1000 ease-out ${isTop ? "bg-[#2C3E50]" : "bg-[#95A5A6]"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
};

// 4. Insight Card (Footnote Style)
const InsightCard = ({ text }: { text: string }) => (
  <div className={`${G.paperCard} p-5 border-l-4 border-l-[#2C3E50]`}>
    <div className="flex items-center gap-2 mb-2">
      <IconSparkles className="w-4 h-4 text-[#2C3E50]" />
      <h3 className="text-sm font-bold text-[#2C3E50] font-serif">Cadencia AI の考察</h3>
    </div>
    <p className="text-sm leading-relaxed text-[#2C3E50] whitespace-pre-wrap font-serif border-t border-[#2C3E50]/10 pt-2">{text}</p>
  </div>
);

// 5. Ask Card (Simple Box)
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp }: any) => (
  <div className={`${G.paperCard} p-5`}>
    <h3 className="text-sm font-bold text-[#2C3E50] mb-3 flex items-center gap-2 font-serif">
      <span className="text-lg">💬</span> Cadencia AIにこの和音について質問する
    </h3>
    <div className="relative group">
      <input 
        ref={inputRefProp}
        className="w-full bg-[#FAF9F6] border border-[#B2BABB] rounded-sm py-3 pl-4 pr-12 text-sm font-serif focus:outline-none focus:border-[#2C3E50] transition-all placeholder:text-[#B2BABB] text-[#2C3E50]" 
        placeholder="例：なぜこの機能になるの？" 
        value={question} 
        onChange={(e) => setQuestion(e.target.value)} 
        onKeyDown={(e) => e.key === 'Enter' && ask()} 
        disabled={isThinking} 
      />
      <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-sm text-[#F5F2E9] transition-all active:scale-95 ${!question.trim() ? "bg-[#D5D8DC]" : "bg-[#2C3E50] hover:bg-[#34495E]"}`}>
        <IconSend className="w-3 h-3" />
      </button>
    </div>
  </div>
);

// 6. Loading Overlay (Classic Spinner)
const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#F5F2E9]/90 backdrop-blur-sm animate-in fade-in duration-300">
    <div className="relative w-16 h-16 border-4 border-[#D5D8DC] border-t-[#2C3E50] rounded-full animate-spin"></div>
    <div className="mt-6 text-center space-y-1">
      <h2 className="text-lg font-bold font-serif text-[#2C3E50] tracking-widest uppercase">Analyzing</h2>
      <p className="text-xs font-serif text-[#5D6D7E]">音楽理論AIが解析中</p>
    </div>
  </div>
);

// --- Main Page ---
export default function CadenciaPage() {
  const resultRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className={`min-h-screen ${G.bgMain} ${G.textMain} font-serif pb-[450px] selection:bg-[#D4E6F1] overflow-x-hidden`}>
      
      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.bgMain} border-b border-[#2C3E50]/10 flex items-center justify-between px-5 transition-all`}>
        <div className="flex items-center gap-3">
          <div className="flex flex-col justify-center leading-none">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-xl font-bold tracking-tight text-[#2C3E50]`}>Cadencia AI</span>
              <FeedbackLink className="bg-[#EAECEE] border border-[#D5D8DC] text-[9px] font-bold text-[#5D6D7E] px-1.5 py-0.5 rounded-sm hover:bg-[#D5D8DC] transition-colors flex items-center gap-1">
                <span>BETA</span><IconTwitter />
              </FeedbackLink>
            </div>
            <span className="text-[10px] font-bold text-[#5D6D7E] tracking-wide">ポケットに、専属音楽理論家を。</span>
          </div>
        </div>
      </header>

      <main className="pt-28 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* Hero */}
        {!hasResult && (
          <section className="text-center space-y-4 animate-in fade-in zoom-in duration-700 py-4">
            <div className="inline-block relative py-2 px-6 border-y border-[#2C3E50]/20">
               <span className="block text-[11px] font-bold text-[#5D6D7E] tracking-[0.2em] mb-1 uppercase">MUSIC THEORY ASSISTANT</span>
               <h1 className={`text-5xl font-black tracking-tight text-[#2C3E50] pb-2`}>Cadencia</h1>
            </div>
            <p className="text-sm font-medium text-[#5D6D7E] flex items-center justify-center gap-2">
              ポケットに、専属音楽理論家を。
            </p>
          </section>
        )}

        {/* Input Monitor Card */}
        <section className={`${G.paperCard} p-5 transition-all duration-300 ${justUpdated ? "ring-1 ring-[#2C3E50]" : ""}`}>
           <div className="flex justify-between items-center mb-4 pb-2 border-b border-[#2C3E50]/10">
              <h3 className="text-xs font-bold text-[#5D6D7E] uppercase tracking-wider flex items-center gap-2">
                <IconKeyboard className="w-4 h-4" /> Input Monitor
              </h3>
              <span className="text-[10px] font-bold text-[#2C3E50]">{selected.length} NOTES</span>
           </div>
           
           <div className="flex flex-wrap gap-2 mb-4 min-h-[2rem]">
             {selected.length === 0 ? (
               <span className="text-xs text-[#5D6D7E] italic pl-1">鍵盤を弾いて音を追加...</span>
             ) : (
               sortedSelected.map((note) => (
                 <span key={note} className={`px-3 py-1 border shadow-sm rounded-sm text-xs font-bold animate-in zoom-in duration-200 ${
                   rootHint === note 
                     ? G.accentRed 
                     : bassHint === note 
                       ? G.accentGreen
                       : "bg-white border-[#2C3E50]/40 text-[#2C3E50]"
                 }`}>
                   {note}
                   {rootHint === note && <span className="ml-1 text-[9px] font-sans">root</span>}
                   {bassHint === note && <span className="ml-1 text-[9px] font-sans">bass</span>}
                 </span>
               ))
             )}
           </div>

           <div className="pt-2">
              <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
             
             <div className="flex items-center gap-2 px-2">
               <div className="w-1 h-4 bg-[#2C3E50]"></div>
               <h2 className="text-lg font-bold text-[#2C3E50]">分析結果</h2>
             </div>

             {topCandidate && <ResultCard candidate={topCandidate} isTop={true} isKeySet={isKeySet} />}

             {infoText && <InsightCard text={infoText} />}

             {otherCandidates.length > 0 && (
               <div className="space-y-3">
                 <div className="flex items-center gap-3 px-2 py-2">
                   <div className="h-[1px] flex-1 bg-[#2C3E50]/20"></div>
                   <span className="text-[10px] font-bold text-[#5D6D7E] uppercase tracking-widest">その他の候補</span>
                   <div className="h-[1px] flex-1 bg-[#2C3E50]/20"></div>
                 </div>
                 {otherCandidates.map((c) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} />))}
               </div>
             )}

             <div className="pt-4 pb-8">
               {answer && (
                 <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                   <div className={`${G.paperCard} p-5 text-sm text-[#2C3E50] leading-relaxed relative`}>
                     <span className="absolute -top-3 -left-2 text-xl bg-[#F5F2E9] p-1 rounded-full border border-[#2C3E50]/20">🤖</span>
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

      {/* --- Floating Keyboard Container --- */}
      <div className={`fixed bottom-0 inset-x-0 z-50 bg-[#EAE6D9] border-t border-[#2C3E50]/20 pt-4 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] transition-transform duration-300`}>
        <div className="max-w-md mx-auto px-4">
          <div className="grid grid-cols-4 grid-rows-4 gap-2 h-full">
            
            {/* Row 1 */}
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-sm bg-[#D5D8DC] border border-[#B2BABB] text-[#5D6D7E] active:bg-[#922B21] active:text-white transition-all flex items-center justify-center shadow-sm active:scale-95" onClick={reset}><IconTrash /></button>

            {/* Row 2 */}
            <FlickKey className="col-start-1 row-start-2" noteBase="F" currentSelection={selected.find(s=>s.startsWith("F"))} isBass={bassHint?.startsWith("F")??false} isRoot={rootHint?.startsWith("F")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-2" noteBase="G" currentSelection={selected.find(s=>s.startsWith("G"))} isBass={bassHint?.startsWith("G")??false} isRoot={rootHint?.startsWith("G")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-2" noteBase="A" currentSelection={selected.find(s=>s.startsWith("A"))} isBass={bassHint?.startsWith("A")??false} isRoot={rootHint?.startsWith("A")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-4 row-start-2" noteBase="B" currentSelection={selected.find(s=>s.startsWith("B"))} isBass={bassHint?.startsWith("B")??false} isRoot={rootHint?.startsWith("B")??false} onInput={handleKeyInput} />

            {/* Row 3: Mode & Key */}
            <div className="col-start-1 row-start-3 h-14 flex flex-col gap-1">
               <button onClick={() => setInputMode(m => m === "root" ? "normal" : "root")} className={`flex-1 rounded-sm text-[10px] font-bold transition-all border ${inputMode === "root" ? "bg-[#922B21] text-white border-[#922B21]" : "bg-white text-[#5D6D7E] border-[#BDC3C7]"}`}>根音</button>
               <button onClick={() => setInputMode(m => m === "bass" ? "normal" : "bass")} className={`flex-1 rounded-sm text-[10px] font-bold transition-all border ${inputMode === "bass" ? "bg-[#D35400] text-white border-[#D35400]" : "bg-white text-[#5D6D7E] border-[#BDC3C7]"}`}>最低音</button>
            </div>

            <div className="col-start-2 col-span-2 row-start-3 h-14 bg-white rounded-sm border border-[#BDC3C7] shadow-sm flex items-center overflow-hidden">
                <div className="flex-[0.8] flex items-center justify-center border-r border-dotted border-[#BDC3C7] h-full px-1">
                   <span className="text-[10px] font-bold text-[#5D6D7E] whitespace-nowrap leading-tight text-center">調性は</span>
                </div>
                <div className="flex-1 relative h-full border-r border-dotted border-[#BDC3C7] group active:bg-[#F2F3F4] transition-colors">
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyRoot} onChange={(e) => setKeyRoot(e.target.value)}>{KEYS_ROOT.map(k => <option key={k} value={k}>{k === "none" ? "なし" : k}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-[#B2BABB]" : "text-[#2C3E50]"}`}>{keyRoot === "none" ? "なし" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-[#F2F3F4] transition-colors ${keyRoot === "none" ? "opacity-30" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k}>{k === "Major" ? "メジャー" : "マイナー"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-[#B2BABB]" : "text-[#2C3E50]"}`}>{keyType === "Major" ? "メジャー" : "マイナー"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-sm flex flex-col items-center justify-center shadow-sm transition-all active:scale-95 ${canAnalyze && !loading ? G.btnPrimary : G.btnDisabled}`} onClick={analyze} disabled={!canAnalyze || loading}>
               <div className="relative z-10 flex flex-col items-center">
                 {loading ? <IconRefresh className="animate-spin" /> : <IconArrowRight />}
                 <span className="text-[10px] font-bold mt-1 text-center leading-tight">判定</span>
               </div>
            </button>

            {/* Row 4: Ask AI */}
            <button onClick={focusInput} className={`col-start-1 col-span-3 row-start-4 h-14 rounded-sm border border-[#BDC3C7] font-bold shadow-sm active:scale-95 flex items-center justify-center gap-2 relative overflow-hidden group bg-white text-[#2C3E50] hover:bg-[#F2F3F4]`}>
               <IconSparkles className="w-4 h-4 text-[#2C3E50]" />
               <span className={`text-xs font-bold`}>Cadencia AI にきく</span>
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