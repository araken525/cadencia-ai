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
};

type AnalyzeRes = {
  engineChord?: string;
  candidates?: Array<string | CandidateObj>;
  analysis?: string;
  reason?: string;
  error?: string;
};

type CandidateUI = {
  id: string;
  chord: string;
  root?: string;
  score?: number;
  tensions: string[];
  chordTones: string[];
  extraTones: string[];
  reasonLines: string[];
  base?: string;
  confidenceLevel: number; 
};

// --- Helper ---
function normalizeCandidates(input: AnalyzeRes["candidates"]): CandidateUI[] {
  const arr = (input ?? []).filter(Boolean);
  return arr.map((c, idx) => {
    let conf = 0;
    if (idx === 0) conf = 95;
    else if (idx === 1) conf = 70;
    else if (idx === 2) conf = 45;
    else conf = 20;

    if (typeof c === "string") {
      return {
        id: `s:${c}:${idx}`,
        chord: c,
        tensions: [],
        chordTones: [],
        extraTones: [],
        reasonLines: [],
        confidenceLevel: conf,
      };
    }

    const chord = c.chord ?? "—";
    const reasonLines =
      typeof c.reason === "string"
        ? [c.reason]
        : Array.isArray(c.reason)
        ? c.reason
        : [];

    return {
      id: `o:${chord}:${c.root ?? ""}:${c.score ?? ""}:${idx}`,
      chord,
      root: c.root,
      score: c.score,
      tensions: (c.tensions ?? []).filter(Boolean),
      chordTones: (c.chordTones ?? []).filter(Boolean),
      extraTones: (c.extraTones ?? []).filter(Boolean),
      reasonLines,
      base: c.base,
      confidenceLevel: conf - (idx * 5),
    };
  });
}

// --- Components ---

// ミニピアノ鍵盤 (Visualizer)
const MiniPiano = ({ selected }: { selected: string[] }) => {
  const keys = [
    { n: ["C"], type: "white", x: 0 },
    { n: ["C#", "Db"], type: "black", x: 10 },
    { n: ["D"], type: "white", x: 14.28 },
    { n: ["D#", "Eb"], type: "black", x: 24.28 },
    { n: ["E"], type: "white", x: 28.56 },
    { n: ["F"], type: "white", x: 42.84 },
    { n: ["F#", "Gb"], type: "black", x: 52.84 },
    { n: ["G"], type: "white", x: 57.12 },
    { n: ["G#", "Ab"], type: "black", x: 67.12 },
    { n: ["A"], type: "white", x: 71.4 },
    { n: ["A#", "Bb"], type: "black", x: 81.4 },
    { n: ["B"], type: "white", x: 85.68 },
  ];
  const isActive = (names: string[]) => selected.some(s => names.includes(s));

  return (
    <div className="h-16 w-full max-w-[240px] mx-auto relative mt-2 mb-4 select-none pointer-events-none">
       <svg viewBox="0 0 100 60" className="w-full h-full drop-shadow-md">
         {keys.filter(k => k.type === "white").map((k, i) => (
           <rect key={i} x={k.x} y="0" width="14.28" height="60" rx="2" ry="2"
             className={`transition-all duration-300 ${isActive(k.n) ? "fill-[url(#activeKeyGradient)] stroke-indigo-300 stroke-[0.5]" : "fill-white stroke-slate-200 stroke-[0.5]"}`} />
         ))}
         {keys.filter(k => k.type === "black").map((k, i) => (
           <rect key={i} x={k.x} y="0" width="8" height="38" rx="1" ry="1"
             className={`transition-all duration-300 ${isActive(k.n) ? "fill-[url(#activeKeyGradient)] stroke-indigo-300 stroke-[0.5]" : "fill-slate-800 stroke-slate-900 stroke-[0.5]"}`} />
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

// Feedback Link Component (共通パーツ)
const FeedbackLink = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <a 
    href="https://x.com/araken525_toho?s=21" 
    target="_blank" 
    rel="noopener noreferrer"
    className={className}
  >
    {children}
  </a>
);

export default function CadenciaPage() {
  const resultRef = useRef<HTMLDivElement>(null);
  const [showGuide, setShowGuide] = useState(true);

  // 音名ボタン定義
  const NOTE_BUTTONS = useMemo(() => [
    { id: 0, d: "C", a: "C" }, { id: 1, d: "C#", a: "Db" }, { id: 2, d: "D", a: "D" },
    { id: 3, d: "D#", a: "Eb" }, { id: 4, d: "E", a: "E" }, { id: 5, d: "F", a: "F" },
    { id: 6, d: "F#", a: "Gb" }, { id: 7, d: "G", a: "G" }, { id: 8, d: "G#", a: "Ab" },
    { id: 9, d: "A", a: "A" }, { id: 10, d: "A#", a: "Bb" }, { id: 11, d: "B", a: "B" },
  ], []);

  const [selected, setSelected] = useState<string[]>([]);
  const [engineChord, setEngineChord] = useState<string>("---");
  const [candidates, setCandidates] = useState<CandidateUI[]>([]);
  const [infoText, setInfoText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  const canAnalyze = selected.length >= 3;

  // Toggle Selection
  const toggle = (n: { d: string; a: string }) => {
    const idx = selected.findIndex((x) => x === n.d || x === n.a);
    if (idx === -1) { setSelected([...selected, n.d]); return; }
    const cur = selected[idx];
    if (n.d !== n.a && cur === n.d) { const next = [...selected]; next[idx] = n.a; setSelected(next); return; }
    setSelected(selected.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setSelected([]); setEngineChord("---"); setCandidates([]);
    setInfoText(""); setQuestion(""); setAnswer(""); setLoading(false);
  };

  // --- API Functions ---
  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true); setAnswer(""); setInfoText("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedNotes: selected }),
      });
      const data = res.headers.get("content-type")?.includes("json") ? await res.json() : { error: await res.text() };
      if (!res.ok) {
        setEngineChord("判定不能"); setCandidates([]); setInfoText(`システムエラー: ${data?.error}`); return;
      }
      setEngineChord((data.engineChord ?? "---").trim());
      setCandidates(normalizeCandidates(data.candidates));
      setInfoText((data.analysis ?? data.reason ?? "").trim());
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e: any) {
      setEngineChord("Error"); setInfoText(`通信エラー: ${e?.message}`);
    } finally { setLoading(false); }
  }

  async function ask() {
    const q = question.trim();
    if (!q || loading || isThinking) return;
    if (!canAnalyze) { setAnswer("（コードを確定させてから質問してね）"); return; }
    setIsThinking(true); setAnswer("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedNotes: selected, engineChord, question: q }),
      });
      setAnswer(res.ok ? await res.text() : `エラー: ${await res.text()}`);
    } catch (e: any) { setAnswer(`通信エラー: ${e?.message}`); } finally { setIsThinking(false); setQuestion(""); }
  }

  // --- Icons ---
  const IconSparkles = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>;
  const IconSend = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
  const IconRefresh = () => <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
  const IconTrash = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
  const IconX = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
  const IconBrain = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/></svg>;
  const IconCheck = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
  const IconRobot = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v4" />
      <line x1="8" y1="16" x2="8" y2="16" />
      <line x1="16" y1="16" x2="16" y2="16" />
    </svg>
  );
  const IconTwitter = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  );

  // Constants
  const G = {
    main: "bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500",
    textMain: "bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600",
    glass: "bg-white/70 backdrop-blur-xl border border-white/50 shadow-lg shadow-indigo-100/50",
  };
  const sortOrder = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
  const sortedSelected = [...selected].sort((a, b) => sortOrder.indexOf(a) - sortOrder.indexOf(b));

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[400px] selection:bg-purple-200">
      
      {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-200/30 blur-[100px] animate-pulse"></div>
        <div className="absolute bottom-[10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-fuchsia-200/20 blur-[120px]"></div>
      </div>

      {/* Header */}
      <header className={`fixed top-0 inset-x-0 z-50 h-16 ${G.glass} flex items-center justify-between px-5`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${G.main} flex items-center justify-center text-white shadow-md`}>
            <IconSparkles />
          </div>
          <div className="flex flex-col justify-center leading-none">
            <span className="text-[9px] font-bold text-indigo-400 tracking-widest mb-0.5">カデンツィア</span>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-black tracking-tight ${G.textMain}`}>Cadencia AI</span>
              {/* 【1. Header: Beta Badge & Feedback Link】 */}
              <FeedbackLink className="bg-indigo-50 border border-indigo-100 text-[9px] font-bold text-indigo-500 px-1.5 py-0.5 rounded-md hover:bg-indigo-100 transition-colors flex items-center gap-1">
                <span>BETA</span>
                <IconTwitter />
              </FeedbackLink>
            </div>
          </div>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* ① Hero Section: 固定キャッチコピー */}
        <section className="text-center space-y-2">
          <div className="inline-block relative">
             <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold text-indigo-400/80 tracking-[0.2em] whitespace-nowrap">
               カデンツィア AI
             </span>
             <h1 className={`text-4xl font-black tracking-tight ${G.textMain} drop-shadow-sm pb-1`}>
               Cadencia AI
             </h1>
          </div>
          <p className="text-sm font-bold text-slate-600 flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse"></span>
            ポケットに、専属の音楽理論家を。
          </p>
        </section>

        {/* ② Intro / Guide Card */}
        {showGuide && (
          <section className="relative rounded-3xl p-0.5 animate-in fade-in slide-in-from-top-4 duration-500 bg-gradient-to-br from-indigo-200 via-purple-200 to-fuchsia-200 shadow-xl shadow-indigo-100">
            <div className="bg-white/95 backdrop-blur-xl rounded-[22px] p-6 relative overflow-hidden">
              <button 
                onClick={() => setShowGuide(false)}
                className="absolute top-3 right-3 text-slate-300 active:text-slate-500 active:bg-slate-100 p-2 rounded-full transition-colors"
              >
                <IconX />
              </button>

              <div className="mb-6">
                <h2 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-1">
                  <span className="text-lg">🎓</span> はじめての方へ
                </h2>
                <p className="text-[11px] text-slate-400 font-bold">Cadencia AI が選ばれる3つの理由</p>
              </div>

              <div className="grid gap-4 mb-6">
                 {/* Feature 1 */}
                 <div className="flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-500 flex items-center justify-center flex-shrink-0 shadow-sm"><IconCheck /></div>
                    <div>
                      <h3 className="text-xs font-bold text-indigo-600">ロジック × AI</h3>
                      <p className="text-[11px] text-slate-500 leading-snug mt-1">コード名は厳密なロジックで判定。解説はAIが担当。</p>
                    </div>
                 </div>
                 {/* Feature 2 */}
                 <div className="flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-xl bg-fuchsia-50 border border-fuchsia-100 text-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-sm"><span className="text-xs font-serif italic font-bold">A#</span></div>
                    <div>
                      <h3 className="text-xs font-bold text-fuchsia-600">異名同音の区別</h3>
                      <p className="text-[11px] text-slate-500 leading-snug mt-1">A#とBbを区別し、正しい和声解釈を導き出します。</p>
                    </div>
                 </div>
                 {/* Feature 3 */}
                 <div className="flex gap-3 items-start">
                    <div className="w-9 h-9 rounded-xl bg-purple-50 border border-purple-100 text-purple-500 flex items-center justify-center flex-shrink-0 shadow-sm"><IconBrain /></div>
                    <div>
                      <h3 className="text-xs font-bold text-purple-600">比較と深掘り</h3>
                      <p className="text-[11px] text-slate-500 leading-snug mt-1">別解釈と比較したり、チャットで質問できます。</p>
                    </div>
                 </div>
              </div>

              {/* Usage Flow */}
              <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-100 mb-4">
                 <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 text-center">HOW TO USE</h3>
                 <div className="flex justify-between items-center relative px-2">
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group">
                       <div className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-lg shadow-sm group-active:scale-95 transition-transform">🎹</div>
                       <span className="text-[10px] font-bold text-slate-500">選ぶ</span>
                    </div>
                    <div className="h-[2px] flex-1 bg-slate-200 mx-1"></div>
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group">
                       <div className={`w-10 h-10 ${G.main} rounded-full flex items-center justify-center text-lg shadow-md shadow-purple-200 text-white animate-pulse group-active:scale-95 transition-transform`}>✨</div>
                       <span className="text-[10px] font-bold text-purple-600">判定</span>
                    </div>
                    <div className="h-[2px] flex-1 bg-slate-200 mx-1"></div>
                    <div className="flex flex-col items-center gap-1.5 relative z-10 group">
                       <div className="w-10 h-10 bg-white border border-slate-200 rounded-full flex items-center justify-center text-lg shadow-sm group-active:scale-95 transition-transform">💬</div>
                       <span className="text-[10px] font-bold text-slate-500">対話</span>
                    </div>
                 </div>
              </div>
              
              <button 
                onClick={() => setShowGuide(false)}
                className={`w-full py-3.5 rounded-2xl text-white text-xs font-bold tracking-wide shadow-lg shadow-indigo-200 ${G.main} active:scale-95 transition-transform mb-3`}
              >
                さっそく始める 🚀
              </button>

              {/* 【2. Intro: Feedback Block】 */}
              <div className="text-center pt-2 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 mb-1">本アプリはベータ版です</p>
                <FeedbackLink className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-500 hover:underline">
                  <IconTwitter /> 開発者にフィードバックを送る
                </FeedbackLink>
              </div>

            </div>
          </section>
        )}

        {/* ③ Main Result */}
        <section ref={resultRef} className={`${G.glass} rounded-3xl p-8 text-center relative overflow-hidden`}>
          <div className="relative z-10">
            <div className="flex items-center justify-center gap-2 mb-4">
              <span className="text-lg">🎹</span>
              <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest">判定結果</p>
            </div>
            <div className={`text-5xl font-black tracking-tighter mb-4 transition-all duration-500 ${engineChord === "---" ? "text-slate-300 scale-95" : `scale-100 ${G.textMain}`}`}>
               {engineChord}
            </div>
            <MiniPiano selected={selected} />
            <div className="flex justify-center gap-2 flex-wrap min-h-[2rem] mt-4">
               {selected.length === 0 ? (
                 <span className="text-xs text-slate-400 bg-slate-100/50 px-3 py-1 rounded-full animate-pulse">👇 下のボタンで音を選択</span>
               ) : (
                 sortedSelected.map((note) => (
                   <span key={note} className="px-3 py-1.5 bg-white border border-indigo-100 shadow-sm rounded-lg text-xs font-bold text-indigo-600 animate-in zoom-in duration-200">
                     {note}
                   </span>
                 ))
               )}
            </div>
          </div>
        </section>

        {/* ④ AI Analysis */}
        <section className={`transition-all duration-700 ease-out ${infoText ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 max-h-0 overflow-hidden"}`}>
           <div className="flex gap-4 items-start pl-2">
             <div className={`flex-shrink-0 w-12 h-12 rounded-2xl ${G.main} flex items-center justify-center text-white shadow-md animate-in zoom-in duration-300`}>
                <IconRobot />
             </div>
             <div className="flex-1 bg-white/80 backdrop-blur-md rounded-2xl rounded-tl-none p-5 shadow-sm border border-indigo-50 relative">
                <div className="absolute -left-2 top-0 w-4 h-4 bg-white/80 transform rotate-45 border-l border-b border-indigo-50"></div>
                <h3 className={`text-xs font-bold mb-2 flex items-center gap-2 ${G.textMain}`}>Cadencia AI の考察</h3>
                <p className="text-sm leading-snug text-slate-700 whitespace-pre-wrap">{infoText}</p>
             </div>
           </div>
        </section>

        {/* ⑤ Candidates */}
        {candidates.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2 px-1">
              <span className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-indigo-200"></span>
              <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider">その他の候補</span>
              <span className="h-[1px] flex-1 bg-gradient-to-r from-indigo-200 to-transparent"></span>
            </div>
            <div className="grid gap-3">
              {candidates.map((c, idx) => (
                <div key={c.id} className="bg-white/60 backdrop-blur-sm border border-white/60 shadow-sm rounded-2xl p-5 relative overflow-hidden active:bg-white/90 transition-colors">
                  <div className="absolute -right-2 -bottom-6 text-7xl font-black text-indigo-900 opacity-[0.03] select-none z-0 pointer-events-none transform -rotate-12">
                    {String(idx + 1).padStart(2, '0')}
                  </div>
                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-2">
                       <span className="text-xl font-bold text-slate-700">{c.chord}</span>
                       <div className="text-right">
                          <span className="text-[9px] text-slate-400 block">信頼度</span>
                          <span className="text-xs font-bold text-indigo-400">{c.confidenceLevel}%</span>
                       </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                       {c.base && <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] font-bold text-slate-500">Bass: {c.base}</span>}
                       {c.tensions.map(t => <span key={t} className="inline-flex items-center px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100 text-[10px] font-bold text-indigo-500">{t}</span>)}
                       {!c.base && c.tensions.length === 0 && <span className="text-[10px] text-slate-300 italic">Basic Triad</span>}
                    </div>
                  </div>
                  <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mt-3">
                    <div className={`h-full ${G.main} transition-all duration-1000 ease-out`} style={{ width: `${c.confidenceLevel}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ⑥ Ask AI */}
        <section className={`${G.glass} rounded-3xl p-1 overflow-hidden`}>
           <div className="bg-white/40 rounded-[20px] p-5">
              <div className="flex items-center gap-2 mb-4">
                 <div className={`w-6 h-6 rounded-full ${G.main} flex items-center justify-center text-white text-[10px]`}>
                   <IconSparkles />
                 </div>
                 <h3 className={`text-sm font-bold ${G.textMain}`}>Cadencia AI に質問する</h3>
              </div>
              {answer && (
                <div className="mb-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                  <div className="bg-gradient-to-br from-indigo-50 to-fuchsia-50 border border-indigo-100 rounded-2xl rounded-tl-none p-4 text-sm text-slate-700 leading-snug shadow-inner relative whitespace-pre-wrap">
                    <span className="absolute -top-1 -left-1 text-lg">💡</span>
                    <div className="pl-3">{answer}</div>
                  </div>
                </div>
              )}
              {isThinking && (
                 <div className="mb-4 flex items-center gap-2 pl-2">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
                    <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-75"></span>
                    <span className="w-2 h-2 bg-fuchsia-400 rounded-full animate-bounce delay-150"></span>
                    <span className="text-xs text-indigo-300 font-bold ml-2">AIが考え中...🤔</span>
                 </div>
              )}
              <div className="relative group">
                 <input
                    className="w-full bg-white border border-indigo-100 rounded-xl py-3 pl-4 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/50 transition-all shadow-sm placeholder:text-slate-300"
                    placeholder="例：ドミナントって何？🤔"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && ask()}
                    disabled={isThinking}
                 />
                 <button onClick={ask} disabled={loading || isThinking || !question.trim()} className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white transition-all active:scale-90 ${!question.trim() ? "bg-slate-200 text-slate-400" : `${G.main} shadow-md`}`}>
                    <IconSend />
                 </button>
              </div>
           </div>
        </section>

        {/* 【3. Operation Area: Footer Link】 */}
        <section className="text-center pb-4">
           <FeedbackLink className="text-[10px] text-slate-400 hover:text-indigo-500 transition-colors inline-flex items-center gap-1">
             <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
             不具合報告・機能要望はこちら (X: @araken525_toho)
           </FeedbackLink>
        </section>

      </main>

      {/* Bottom Controls */}
      <div className={`fixed bottom-0 inset-x-0 z-50 ${G.glass} border-t-0 rounded-t-[30px] pt-5 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]`}>
        <div className="max-w-md mx-auto px-5">
          <div className="flex gap-3 mb-5">
             <button onClick={reset} className="flex-shrink-0 w-14 h-14 rounded-2xl bg-white border border-slate-200 text-slate-400 active:text-red-500 active:border-red-200 active:bg-red-50 transition-colors flex items-center justify-center shadow-sm active:scale-95"><IconTrash /></button>
             <button onClick={analyze} disabled={!canAnalyze || loading} className={`flex-1 h-14 rounded-2xl font-bold text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2 relative overflow-hidden active:scale-[0.98] ${canAnalyze && !loading ? `${G.main} text-white shadow-lg shadow-indigo-300/50` : "bg-slate-100 text-slate-300 cursor-not-allowed"}`}>
                {loading ? <IconRefresh /> : <IconSparkles />}
                <span>{loading ? "解析中..." : "AIで判定する ✨"}</span>
             </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {NOTE_BUTTONS.map((n) => {
              const active = selected.find((x) => x === n.d || x === n.a);
              return (
                <button key={n.id} onClick={() => toggle(n)} className={`h-12 rounded-xl font-bold text-sm transition-all duration-150 relative backdrop-blur-sm active:scale-95 ${active ? `${G.main} text-white shadow-md shadow-purple-200` : "bg-white border border-slate-100 text-slate-600 active:bg-indigo-50"}`}>
                  {active || n.d}
                  {active && n.d !== n.a && <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white border border-fuchsia-200 rounded-full flex items-center justify-center text-[8px] text-fuchsia-600 shadow-sm">↻</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}