"use client";



import { useMemo, useRef, useState, useEffect } from "react";



// --- Design Constants ---

const G = {

// Apple Intelligence風 オーロラグラデーション

aurora: "bg-gradient-to-r from-blue-500 via-purple-500 via-pink-500 to-amber-400 bg-[length:300%_300%] animate-aurora-shift",

auroraText: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 animate-aurora-text",

// 透明感のある極薄ガラス

glassBase: "bg-white/40 backdrop-blur-2xl border border-white/40 shadow-xl shadow-indigo-500/5",

glassHigh: "bg-white/60 backdrop-blur-3xl border border-white/50 shadow-2xl shadow-purple-500/10",

// キーボード用（さらに透明度を高く）

glassKey: "bg-white/30 backdrop-blur-xl border border-white/20 shadow-sm active:bg-white/50 transition-all",

// 汎用メインカラー

main: "bg-gradient-to-tr from-indigo-500 via-purple-500 to-fuchsia-500",

textMain: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600",

glassActive: "bg-white/90 backdrop-blur-2xl border border-white/60 shadow-xl",

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



// 1. Mini Piano

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



// 2. Flick Key

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



// 3. Result Card

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



// 4. Insight Card

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



// 5. Ask Card (Revised to accept ref)

const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp }: any) => (

<div className={`relative rounded-[32px] overflow-hidden ${G.glassBase} p-1 transition-all`}>

<div className="bg-white/60 backdrop-blur-xl rounded-[30px] p-6">

<h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">

<span className="text-xl">💬</span> Cadencia AIにこの和音について質問する

</h3>

<div className="relative group">

<input

ref={inputRefProp}

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