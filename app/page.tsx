"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants ---
const G = {
  // ヒーロー: 静かで知的なグラデーションテキスト
  heroTextStatic: "text-slate-700 drop-shadow-sm",
  
  // ベースカード: 清潔感のある白、控えめな影
  cardBase: "bg-white rounded-[32px] shadow-xl shadow-blue-900/5 border border-white overflow-hidden relative",
  
  // キーボード: 半透明ガラス（復刻）
  glassKeyContainer: "bg-white/60 backdrop-blur-xl border-t border-white/40 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]",
  glassKey: "bg-white/40 border border-white/50 shadow-sm backdrop-blur-md active:bg-white/70 transition-all",
  
  // チャット: 最高のメッセージUI
  chatBubbleUser: "bg-gradient-to-br from-blue-600 to-cyan-600 text-white rounded-[20px] rounded-tr-sm shadow-md",
  chatBubbleAI: "bg-white text-slate-700 border border-slate-100 rounded-[20px] rounded-tl-sm shadow-sm",
  chatContainer: "bg-slate-50/80 backdrop-blur-3xl rounded-[40px] border border-white/60 shadow-2xl shadow-blue-900/10 overflow-hidden",
};

const NOTE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];
const KEYS_ROOT = ["none", "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
const KEYS_TYPE = ["Major", "Minor"];
const SORT_ORDER = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

const SHORTCUT_QUESTIONS = [
  "もっと詳しく説明して",
  "なぜこの機能に分類されるの？",
  "この和音はどんな役割で使われることが多い？",
];

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

type ChatMessage = {
  role: "user" | "ai";
  text: string;
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

// リッチなイントロダクションモーダル
const WelcomeModal = ({ onClose }: { onClose: () => void }) => {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onClose, 300);
  };

  return (
    <div className={`fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 transition-opacity duration-300 ${isClosing ? "opacity-0" : "opacity-100"}`}>
      <div className={`w-full max-w-md h-[85vh] bg-white rounded-[40px] shadow-2xl overflow-hidden relative transform transition-all duration-300 flex flex-col ${isClosing ? "scale-95 translate-y-8 opacity-0" : "scale-100 translate-y-0 opacity-100"}`}>
        
        {/* Background Watermark */}
        <div className="absolute top-10 -left-10 text-[8rem] font-black text-slate-100 rotate-90 pointer-events-none select-none opacity-50">
          INTRODUCTION
        </div>

        <div className="flex-1 overflow-y-auto p-8 relative z-10 scrollbar-hide">
          {/* Header */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 flex items-center justify-center text-white text-3xl shadow-xl mx-auto mb-6 rotate-3">
              🎹
            </div>
            <div className="text-xs font-bold text-slate-400 tracking-[0.2em] mb-2">カデンツィア</div>
            <h1 className="text-4xl font-black text-slate-800 tracking-tighter mb-2">Cadencia AI</h1>
            <p className="text-sm font-bold text-slate-500">ポケットに、専属の音楽理論家を。</p>
          </div>

          {/* Section 1: Target Audience */}
          <div className="mb-10">
            <h2 className="text-sm font-black text-slate-800 border-b-2 border-slate-100 pb-2 mb-4 flex items-center gap-2">
              <span className="text-xl">🎯</span> 対象ユーザー
            </h2>
            
            <div className="space-y-6">
              <div className="bg-slate-50 p-5 rounded-3xl">
                <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <span className="text-xl">🎺</span> 奏者の方へ
                  <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">吹奏楽・オケ・合唱</span>
                </h3>
                <ul className="space-y-2 text-xs text-slate-600 font-medium leading-relaxed list-disc list-outside pl-4">
                  <li>和音の響きは分かるが、機能和声として言語化できない。</li>
                  <li>スコアを読んでいて「この和音の役割は？」と立ち止まってしまう。</li>
                  <li>記号としてのコード名より、音楽的な「意味」を知りたい。</li>
                </ul>
              </div>

              <div className="bg-slate-50 p-5 rounded-3xl">
                <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <span className="text-xl">🎓</span> 学ぶ方へ
                  <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">音大生・学習者</span>
                </h3>
                <ul className="space-y-2 text-xs text-slate-600 font-medium leading-relaxed list-disc list-outside pl-4">
                  <li>和声学の用語（主和音、属和音など）を用いた解説が欲しい。</li>
                  <li>転回形やバス、文脈による解釈の変化を深く学びたい。</li>
                  <li>自習時の解答合わせや、理論の復習ツールとして。</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Section 2: Features */}
          <div className="mb-8">
            <h2 className="text-sm font-black text-slate-800 border-b-2 border-slate-100 pb-2 mb-4 flex items-center gap-2">
              <span className="text-xl">✨</span> Cadencia AIの特徴
            </h2>
            <div className="text-xs text-slate-600 leading-relaxed font-medium space-y-4">
              <p>
                入力された構成音から和音を判定し、その音楽的意味を<span className="bg-yellow-100 font-bold px-1">「和声学の言葉」</span>で解説する音楽理論特化型AI解析アプリです。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 p-3 rounded-2xl text-center">
                  <div className="text-lg mb-1">🧐</div>
                  <div className="font-bold text-blue-700">根拠</div>
                  <div className="text-[9px] text-blue-500">なぜその和音か</div>
                </div>
                <div className="bg-rose-50 p-3 rounded-2xl text-center">
                  <div className="text-lg mb-1">⚙️</div>
                  <div className="font-bold text-rose-700">機能</div>
                  <div className="text-[9px] text-rose-500">調性内の役割</div>
                </div>
                <div className="bg-emerald-50 p-3 rounded-2xl text-center">
                  <div className="text-lg mb-1">🏗️</div>
                  <div className="font-bold text-emerald-700">構造</div>
                  <div className="text-[9px] text-emerald-500">転回形・バス</div>
                </div>
                <div className="bg-purple-50 p-3 rounded-2xl text-center">
                  <div className="text-lg mb-1">💡</div>
                  <div className="font-bold text-purple-700">多義性</div>
                  <div className="text-[9px] text-purple-500">他の解釈</div>
                </div>
              </div>
              <p className="text-center font-bold text-slate-400 mt-2">
                プロの音楽家の思考プロセスを、AIが可視化します。
              </p>
            </div>
          </div>
        </div>

        {/* Footer Button */}
        <div className="p-6 bg-white border-t border-slate-100 relative z-20">
          <button 
            onClick={handleClose}
            className="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold shadow-lg hover:bg-slate-800 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 group"
          >
            <span>はじめる</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const KeyboardGuideCard = ({ onClose }: { onClose: () => void }) => {
  const [isClosing, setIsClosing] = useState(false);
  const handleClose = () => { setIsClosing(true); setTimeout(onClose, 300); };

  return (
    <div className={`${G.cardBase} bg-blue-50/50 border-blue-100 shadow-sm mb-6 transition-all duration-300 ${isClosing ? "opacity-0 -translate-y-2 scale-95" : "opacity-100 translate-y-0 scale-100 animate-in fade-in slide-in-from-bottom-2"}`}>
      <button onClick={handleClose} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 p-1"><IconX className="w-4 h-4" /></button>
      <div className="p-5 pb-4">
        <h3 className="text-xs font-bold text-blue-600 mb-3 flex items-center gap-2"><IconKeyboard className="w-4 h-4" /> キーボードの操作方法</h3>
        <ul className="space-y-2.5">
          <GuideItem icon="👆" text={<>キーを<span className="font-bold">タップ</span>して入力しよう</>} />
          <GuideItem icon="↕️" text={<>キーを<span className="font-bold">上にフリックで♯</span>、<span className="font-bold">下にフリックで♭</span>がつきます</>} />
          <GuideItem icon="🎛️" text={<><span className="font-bold">根音</span>または<span className="font-bold">最低音</span>は専用のキーで指定できます</>} />
          <GuideItem icon="🤖" text={<><span className="font-bold">3つ以上の音</span>を選択し、<span className="font-bold">分析ボタン</span>でAIの分析開始！</>} />
        </ul>
      </div>
    </div>
  );
};

const GuideItem = ({ icon, text }: { icon: string, text: React.ReactNode }) => (
  <li className="flex items-start gap-3 text-[11px] text-slate-600 leading-tight"><span className="text-sm shrink-0 relative top-[-1px]">{icon}</span><span>{text}</span></li>
);

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
    <div className="h-24 w-full relative select-none pointer-events-none">
       <svg viewBox="0 0 100 50" className="w-full h-full" preserveAspectRatio="none">
         {keys.filter(k => k.type === "white").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h14.28 v46 a4,4 0 0 1 -4,4 h-6.28 a4,4 0 0 1 -4,-4 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-400" : isBass(k.idx) ? "fill-amber-400" : "fill-cyan-400") 
                 : "fill-slate-100"
             } stroke-white stroke-[1]`} />
         ))}
         {keys.filter(k => k.type === "black").map((k) => (
           <path key={k.idx} d={`M${k.x},0 h8 v30 a2,2 0 0 1 -2,2 h-4 a2,2 0 0 1 -2,-2 z`}
             className={`transition-all duration-300 ${
               isActive(k.idx) 
                 ? (isRoot(k.idx) ? "fill-rose-600" : isBass(k.idx) ? "fill-amber-600" : "fill-cyan-600") 
                 : "fill-slate-200"
             }`} />
         ))}
       </svg>
    </div>
  );
};

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

  const handlePointerDown = (e: React.PointerEvent) => { e.preventDefault(); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {} setStartY(e.clientY); };
  const handlePointerMove = (e: React.PointerEvent) => { if (startY === null) return; setOffsetY(Math.max(-30, Math.min(30, e.clientY - startY))); };
  const handlePointerUp = (e: React.PointerEvent) => { if (startY !== null) { const delta = e.clientY - startY; if (delta < -THRESHOLD) onInput(`${noteBase}#`, "flick"); else if (delta > THRESHOLD) onInput(`${noteBase}b`, "flick"); else onInput(noteBase, "tap"); } setStartY(null); setOffsetY(0); try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {} };
  const isUp = offsetY < -10;
  const isDown = offsetY > 10;

  return (
    <div className={`relative rounded-2xl touch-none select-none overflow-visible flex flex-col items-center justify-center transition-all duration-200 z-0 ${isRoot ? "bg-rose-50 border border-rose-200 shadow-[0_4px_12px_rgba(244,63,94,0.2)]" : isBass ? "bg-amber-50 border border-amber-200 shadow-[0_4px_12px_rgba(251,191,36,0.2)]" : G.glassKey} ${!isBass && !isRoot && isActive ? "bg-cyan-50 border-cyan-200 shadow-[0_4px_12px_rgba(34,211,238,0.2)]" : ""} ${className}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all duration-300 ${isUp ? "opacity-100 -translate-y-1 text-cyan-500 scale-125" : "opacity-30 text-slate-400"}`}><span className="text-[8px] font-bold leading-none">♯</span></div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all duration-300 ${isDown ? "opacity-100 translate-y-1 text-cyan-500 scale-125" : "opacity-30 text-slate-400"}`}><span className="text-[8px] font-bold leading-none">♭</span></div>
      <span className={`text-2xl font-medium tracking-tight transition-all duration-200 ${isRoot ? "text-rose-500" : isBass ? "text-amber-500" : isActive ? "text-cyan-600" : "text-slate-600"}`} style={{ transform: `translateY(${offsetY * 0.4}px)` }}>{displayLabel}</span>
    </div>
  );
};

const ResultCard = ({ candidate, isTop, isKeySet, rank }: { candidate: CandidateObj, isTop: boolean, isKeySet: boolean, rank: number }) => {
  const isProvisional = isTop && (candidate.provisional || candidate.score < 50);
  const percent = candidate.score;
  const invMap: Record<string, string> = { "root": "基本形", "1st": "第1転回", "2nd": "第2転回", "3rd": "第3転回", "unknown": "不明" };
  const invJp = invMap[candidate.inversion || "unknown"] || "―";

  return (
    <div className={`relative overflow-hidden transition-all duration-700 group ${G.cardBase} p-0`}>
      <div className={`absolute -right-4 -bottom-6 font-black select-none pointer-events-none z-0 tracking-tighter leading-none ${isTop ? "text-slate-100 text-[10rem]" : "text-slate-50 text-[6rem]"}`}>{String(rank).padStart(2, '0')}</div>
      <div className="relative z-10 p-6 flex flex-col gap-6">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
             {isTop && (
               <div className="flex items-center gap-2">
                 <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${isProvisional ? "bg-amber-50 text-amber-600 border-amber-100" : "bg-gradient-to-r from-yellow-50 to-amber-50 text-amber-600 border-amber-100"}`}>
                   {isProvisional ? "⚠️ 暫定判定" : "👑 最有力候補"}
                 </span>
               </div>
             )}
             <h2 className="text-5xl font-black text-slate-800 tracking-tighter leading-none">{candidate.chord}</h2>
          </div>
          <div className="text-right">
             <div className="flex items-baseline justify-end gap-1">
               <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-br from-blue-500 to-cyan-400">{percent}</span>
               <span className="text-sm font-bold text-slate-300">%</span>
             </div>
             <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">CONFIDENCE</span>
          </div>
        </div>
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 shadow-inner flex items-stretch justify-between divide-x divide-slate-200/60 h-24">
            <div className={`flex-1 flex flex-col items-center justify-center px-1`}>
                <span className="text-[9px] font-bold text-slate-400 mb-1">機能</span>
                <span className={`text-2xl font-black leading-none ${!isKeySet ? "text-slate-200" : candidate.tds === "T" ? "text-cyan-500" : candidate.tds === "D" ? "text-rose-500" : candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-500" : "text-slate-300"}`}>
                  {!isKeySet ? "―" : (candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds)}
                </span>
            </div>
            <div className={`flex-1 flex flex-col items-center justify-center px-1`}>
                <span className="text-[9px] font-bold text-slate-400 mb-1">記号</span>
                <span className={`text-xl font-serif font-black leading-none ${!isKeySet ? "text-slate-200" : "text-slate-700"}`}>{!isKeySet ? "―" : (candidate.romanNumeral || "―")}</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center px-1">
                <span className="text-[9px] font-bold text-slate-400 mb-1">転回形</span>
                <span className="text-xs font-bold text-slate-600 leading-none text-center">{invJp}</span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center px-1">
                <span className="text-[9px] font-bold text-slate-400 mb-1">種類</span>
                <span className="text-xs font-bold text-slate-600 leading-none text-center">{candidate.chordType || "―"}</span>
            </div>
        </div>
      </div>
    </div>
  );
};

const InsightCard = ({ text }: { text: string }) => (
  <div className={`${G.cardBase} p-6 overflow-hidden bg-gradient-to-br from-white to-slate-50`}>
    <div className="absolute -right-4 top-2 text-[5rem] font-black text-slate-900/5 pointer-events-none select-none z-0 transform rotate-[-5deg] tracking-tighter leading-none whitespace-nowrap">Cadencia AI</div>
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-gradient-to-br from-blue-500 to-cyan-500 shadow-md"><IconBook className="w-4 h-4" /></div>
        <h3 className="text-sm font-bold text-slate-800">Cadencia AI の考察</h3>
      </div>
      <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">{text}</p>
    </div>
  </div>
);

// 修正: 抜本的に更新された「最高のチャットUI」
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp, history }: { question: string, setQuestion: (s:string)=>void, ask: ()=>void, isThinking: boolean, loading: boolean, inputRefProp: any, history: ChatMessage[] }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, 100);
    }
  }, [history, isThinking]);

  return (
    <div className={G.chatContainer}>
      <div className="flex flex-col h-[500px]">
        {/* Chat Header */}
        <div className="px-6 py-4 bg-white/50 backdrop-blur-md border-b border-white/50 flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 animate-pulse"></div>
            <h3 className="font-bold text-slate-700">Cadencia AIのチャット</h3>
          </div>
          <IconRobot className="text-slate-300 w-5 h-5" />
        </div>

        {/* Chat Stream */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-hide">
          {history.length === 0 && !isThinking && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
              <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center shadow-lg"><span className="text-3xl">💬</span></div>
              <p className="text-xs font-bold text-slate-500">知りたいことを入力して<br/>AIと対話しよう</p>
            </div>
          )}
          
          {history.map((msg, i) => (
            <div key={i} className={`flex items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              {msg.role === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0 border border-slate-100">
                  <IconRobot className="w-4 h-4 text-blue-500" />
                </div>
              )}
              <div className={`px-5 py-3 text-sm font-medium leading-relaxed max-w-[80%] ${msg.role === 'user' ? G.chatBubbleUser : G.chatBubbleAI}`}>
                {msg.text}
              </div>
            </div>
          ))}

          {/* Thinking Indicator */}
          {isThinking && (
            <div className="flex items-end gap-2 animate-in fade-in">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm shrink-0 border border-slate-100"><IconRobot className="w-4 h-4 text-blue-500 animate-bounce" /></div>
              <div className={`${G.chatBubbleAI} px-4 py-3 flex gap-1.5 items-center`}>
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white/60 backdrop-blur-md border-t border-white/50">
          {/* Shortcuts */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 mask-linear-fade">
            {SHORTCUT_QUESTIONS.map((q) => (
              <button 
                key={q} 
                onClick={() => { setQuestion(q); setTimeout(ask, 0); }}
                disabled={loading || isThinking}
                className="whitespace-nowrap text-[10px] font-bold text-slate-600 bg-white/80 hover:bg-blue-50 border border-white/60 hover:border-blue-200 px-3 py-1.5 rounded-full shadow-sm transition-all active:scale-95 shrink-0"
              >
                {q}
              </button>
            ))}
          </div>
          
          {/* Input Box */}
          <div className="relative flex items-center gap-2 bg-white rounded-2xl p-1.5 shadow-sm border border-slate-100 transition-shadow focus-within:shadow-md focus-within:ring-2 focus-within:ring-blue-100">
            <textarea 
              ref={inputRefProp}
              className="flex-1 bg-transparent border-none rounded-xl py-3 px-3 text-base text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0 resize-none max-h-24 min-h-[48px] leading-relaxed" // text-base avoids zoom
              placeholder="質問を入力..." 
              value={question} 
              rows={1}
              onChange={(e) => setQuestion(e.target.value)} 
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
              disabled={isThinking}
            />
            <button 
              onClick={ask} 
              disabled={loading || isThinking || !question.trim()} 
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 transition-all ${
                !question.trim() ? "bg-slate-200 text-slate-400 cursor-default" : "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/30 active:scale-90"
              }`}
            >
              <IconSend className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/20 backdrop-blur-lg animate-in fade-in duration-500 px-6">
    <div className="relative w-24 h-24 mb-8">
      <div className="absolute inset-0 rounded-full bg-cyan-400/20 animate-ping"></div>
      <div className="absolute inset-0 rounded-full border-[3px] border-white/10 border-t-cyan-400 animate-spin"></div>
      <div className="absolute inset-4 rounded-full bg-white/90 shadow-[0_0_30px_rgba(34,211,238,0.5)] flex items-center justify-center text-3xl animate-bounce">🎹</div>
      <div className="absolute -right-2 -bottom-2 text-2xl animate-pulse">🔎</div>
    </div>
    <div className="text-center space-y-4 max-w-xs relative z-10">
      <h2 className="text-lg font-black text-slate-800 drop-shadow-sm leading-tight">Cadencia AIが和音を分析し、<br/>解説の生成をしています…</h2>
      <div className="h-1 w-12 bg-cyan-400/50 rounded-full mx-auto animate-pulse"></div>
      <p className="text-[10px] font-bold text-slate-500 leading-relaxed max-w-[200px] mx-auto opacity-80">複雑な和音や、たくさんの解釈がある組み合わせの場合、あらゆる可能性を考慮するため、時間がかかる場合があります。</p>
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
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  const [showGuide, setShowGuide] = useState(true);

  const [candidates, setCandidates] = useState<CandidateObj[]>([]);
  const [infoText, setInfoText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);

  const canAnalyze = selected.length >= 3;
  const isKeySet = keyRoot !== "none";
  const hasResult = candidates.length > 0;

  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

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
      if (existingIndex === -1) nextSelected.push(inputNote);
      else nextSelected[existingIndex] = inputNote;
      setSelected(nextSelected);
      if (rootHint === inputNote) setRootHint(null);
      else { setRootHint(inputNote); if (bassHint === inputNote) setBassHint(null); }
      setInputMode("normal");
    } else if (inputMode === "bass") {
      if (existingIndex === -1) nextSelected.push(inputNote);
      else nextSelected[existingIndex] = inputNote;
      setSelected(nextSelected);
      if (bassHint === inputNote) setBassHint(null);
      else { setBassHint(inputNote); if (rootHint === inputNote) setRootHint(null); }
      setInputMode("normal");
    } else {
      updateSelection();
    }
  };

  const reset = () => {
    setSelected([]); setCandidates([]); setBassHint(null); setRootHint(null);
    setInfoText(""); setQuestion(""); setChatHistory([]); setLoading(false); setInputMode("normal");
  };

  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true); setChatHistory([]); setInfoText("");
    const keyHint = keyRoot === "none" ? "none" : `${keyRoot} ${keyType}`;
    try {
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
    if (!canAnalyze || candidates.length === 0) { 
        setChatHistory(prev => [...prev, { role: 'ai', text: 'コードを確定させてから質問してね' }]);
        return; 
    }
    setChatHistory(prev => [...prev, { role: 'user', text: q }]);
    setQuestion("");
    setIsThinking(true);
    
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
      const answerText = res.ok ? await res.text() : `エラー: ${await res.text()}`;
      setChatHistory(prev => [...prev, { role: 'ai', text: answerText }]);
    } catch (e: any) { 
        setChatHistory(prev => [...prev, { role: 'ai', text: `通信エラー: ${e?.message}` }]);
    } finally { setIsThinking(false); }
  }

  const handleDragStart = (e: React.PointerEvent) => {
    if (!isKeyboardOpen) return;
    setDragStartY(e.clientY);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDragMove = (e: React.PointerEvent) => {
    if (dragStartY === null) return;
    const delta = e.clientY - dragStartY;
    if (delta > 0) setKeyboardOffset(delta);
  };

  const handleDragEnd = (e: React.PointerEvent) => {
    if (dragStartY === null) return;
    if (keyboardOffset > 50) setIsKeyboardOpen(false);
    setDragStartY(null);
    setKeyboardOffset(0);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[450px] selection:bg-cyan-100 overflow-x-hidden">
      <style jsx global>{`
        @keyframes float-note-1 { 0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.2; } 50% { transform: translateY(-20px) rotate(10deg); opacity: 0.5; } }
        @keyframes float-note-2 { 0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.3; } 50% { transform: translateY(-15px) rotate(-10deg); opacity: 0.6; } }
        
        .animate-float-1 { animation: float-note-1 6s ease-in-out infinite; }
        .animate-float-2 { animation: float-note-2 8s ease-in-out infinite; }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .mask-linear-fade { mask-image: linear-gradient(to right, transparent, black 10px, black 90%, transparent); }
      `}</style>
      
      {showWelcome && <WelcomeModal onClose={() => setShowWelcome(false)} />}
      {loading && <LoadingOverlay />}

      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-40 h-16 bg-white/80 backdrop-blur-md border-b border-white/50 flex items-center justify-between px-5 transition-all">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center text-slate-800">
             <IconBook className="w-6 h-6" />
          </div>
          <div className="flex flex-col justify-center leading-none">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-lg font-black tracking-tight text-slate-800">Cadencia AI</span>
            </div>
            <span className="text-[10px] font-bold text-slate-400 tracking-wide">ポケットに、専属音楽理論家を。</span>
          </div>
        </div>
        <div className="flex items-center">
            <span className="font-mono text-[10px] font-bold text-black border-l-2 border-slate-200 pl-3 ml-2">v0.1.0 BETA</span>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* 1. Hero */}
        <section className="text-center space-y-2 py-4 relative">
          <div className="absolute top-0 left-10 text-4xl text-cyan-200 animate-float-1 pointer-events-none select-none">♪</div>
          <div className="absolute bottom-0 right-10 text-3xl text-blue-200 animate-float-2 pointer-events-none select-none">♫</div>
          <div className="absolute top-1/2 right-0 text-xl text-purple-200 animate-float-1 pointer-events-none select-none" style={{animationDelay: '1s'}}>♭</div>
          <div className="inline-block relative z-10">
             <h1 className="text-5xl font-black tracking-tighter pb-2 leading-none flex flex-col items-center">
                <span className="text-[10px] font-bold text-cyan-500 tracking-widest mb-1">カデンツィア</span>
                <span className={G.heroTextStatic}>Cadencia AI</span>
             </h1>
          </div>
          <p className="text-sm font-bold text-slate-400 relative z-10">
              ポケットに、専属音楽理論家を。
          </p>
        </section>

        {showGuide && <KeyboardGuideCard onClose={() => setShowGuide(false)} />}

        {/* Input Card */}
        <section className={`${G.cardBase} bg-white shadow-xl transition-all duration-300 ${justUpdated ? "ring-2 ring-cyan-200" : ""}`}>
           <div className="p-5 flex flex-col min-h-[240px]">
              <h3 className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-2 uppercase tracking-wider">
                  Cadencia AIに分析と解説をさせよう
              </h3>
              <div className="flex-1 flex flex-col items-center justify-center">
                 {selected.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-4 animate-in fade-in zoom-in duration-500 py-6">
                       <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner">
                          <IconKeyboard className="w-8 h-8" />
                       </div>
                       <div className="text-center space-y-1">
                         <p className="text-sm font-bold text-slate-500">和音を入力してスタート</p>
                         <p className="text-[10px] text-slate-400">下のキーボードから音を選んでください</p>
                       </div>
                    </div>
                 ) : (
                    <div className="w-full">
                       <div className="flex flex-wrap justify-center gap-3 mb-4">
                          {sortedSelected.map((note) => (
                            <div key={note} className={`relative group animate-in zoom-in duration-300`}>
                              <div className={`w-14 h-14 rounded-2xl text-2xl font-black shadow-lg flex items-center justify-center border transition-transform hover:scale-105 ${
                                rootHint === note 
                                  ? "bg-rose-500 border-rose-400 text-white shadow-rose-200" 
                                  : bassHint === note 
                                    ? "bg-amber-400 border-amber-300 text-white shadow-amber-200" 
                                    : "bg-white border-slate-100 text-slate-700 shadow-slate-200"
                              }`}>
                                {note}
                              </div>
                              <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex flex-col gap-1 items-center w-max pointer-events-none">
                                {rootHint === note && <span className="text-[9px] bg-rose-600 text-white px-2 py-0.5 rounded-full font-bold shadow-sm z-20">根音</span>}
                                {bassHint === note && <span className="text-[9px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold shadow-sm z-10">最低音</span>}
                              </div>
                            </div>
                          ))}
                       </div>
                       <div className="opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
                          <MiniPiano selected={selected} bassHint={bassHint} rootHint={rootHint} />
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </section>

        {/* --- Results Section --- */}
        {hasResult && (
          <div ref={resultRef} className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-2 px-1 py-2">
                <IconBook className="text-slate-800 w-5 h-5" />
                <h2 className="text-lg font-bold text-slate-800">Cadencia AIの分析結果 📖</h2>
              </div>
              {candidates[0] && <ResultCard candidate={candidates[0]} isTop={true} isKeySet={isKeySet} rank={1} />}
              {infoText && <InsightCard text={infoText} />}
              {candidates.length > 1 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-center py-4 gap-4">
                    <div className="h-px bg-slate-200 flex-1"></div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">その他の候補</span>
                    <div className="h-px bg-slate-200 flex-1"></div>
                  </div>
                  {candidates.slice(1).map((c, i) => (<ResultCard key={c.chord} candidate={c} isTop={false} isKeySet={isKeySet} rank={i + 2} />))}
                </div>
              )}
              <div className="pt-4 pb-8">
                <AskCard 
                  question={question} 
                  setQuestion={setQuestion} 
                  ask={ask} 
                  isThinking={isThinking} 
                  loading={loading}
                  inputRefProp={inputRef}
                  history={chatHistory}
                />
              </div>
          </div>
        )}
      </main>

      {/* --- Footer Beta Card --- */}
      <footer className="relative z-10 px-5 pb-32 mt-12">
        <div className="bg-slate-900 rounded-[24px] p-6 shadow-xl relative overflow-hidden group border border-slate-800">
           {/* Background Decoration */}
           <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all duration-500 pointer-events-none"></div>
           <div className="relative z-10 flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center text-2xl shadow-inner border border-slate-700">
                🧑‍💻
              </div>
              <div>
                <h3 className="text-white font-bold text-sm mb-1">Cadencia AI Beta</h3>
                <p className="text-slate-400 text-[10px] leading-relaxed max-w-xs mx-auto">
                  このアプリは現在ベータ版です。機能の改善やバグの報告など、開発者までお気軽にご連絡ください。
                </p>
              </div>
              <a href="https://x.com/araken525_toho?s=21" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-black text-white text-[10px] font-bold px-4 py-2 rounded-full border border-slate-700 hover:bg-slate-800 transition-all hover:scale-105 active:scale-95">
                <IconTwitter className="w-3 h-3" />
                <span>@araken525_toho に連絡する</span>
              </a>
           </div>
        </div>
      </footer>

      {/* --- Floating Glass Keyboard (Translucent) --- */}
      <div 
        className={`fixed bottom-0 inset-x-0 z-50 ${G.glassKeyContainer} rounded-t-[36px] transition-transform duration-300 ease-out touch-none ${isKeyboardOpen ? "translate-y-0" : "translate-y-[calc(100%-30px)]"}`}
        style={{ transform: isKeyboardOpen ? `translateY(${keyboardOffset}px)` : undefined }}
      >
        <div 
          className="h-8 flex items-center justify-center cursor-grab active:cursor-grabbing active:opacity-50" 
          onClick={() => setIsKeyboardOpen(!isKeyboardOpen)}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
           <div className="w-12 h-1 bg-slate-300/80 rounded-full"></div>
        </div>

        <div className="max-w-md mx-auto px-4 pb-8 pt-2">
          <div className="grid grid-cols-4 grid-rows-4 gap-2.5 h-full">
            
            <FlickKey className="col-start-1 row-start-1" noteBase="C" currentSelection={selected.find(s=>s.startsWith("C"))} isBass={bassHint?.startsWith("C")??false} isRoot={rootHint?.startsWith("C")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-2 row-start-1" noteBase="D" currentSelection={selected.find(s=>s.startsWith("D"))} isBass={bassHint?.startsWith("D")??false} isRoot={rootHint?.startsWith("D")??false} onInput={handleKeyInput} />
            <FlickKey className="col-start-3 row-start-1" noteBase="E" currentSelection={selected.find(s=>s.startsWith("E"))} isBass={bassHint?.startsWith("E")??false} isRoot={rootHint?.startsWith("E")??false} onInput={handleKeyInput} />
            <button className="col-start-4 row-start-1 h-14 rounded-2xl bg-white/40 border border-white/40 text-slate-400 active:text-rose-500 active:bg-rose-50 transition-all flex items-center justify-center shadow-sm active:scale-95 hover:bg-white/60" onClick={reset}><IconTrash /></button>

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
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-400" : "text-cyan-600"}`}>{keyRoot === "none" ? "なし" : keyRoot}</span></div>
                </div>
                <div className={`flex-1 relative h-full active:bg-black/5 transition-colors ${keyRoot === "none" ? "opacity-50" : ""}`}>
                   <select className="absolute inset-0 w-full h-full opacity-0 z-10 appearance-none cursor-pointer" value={keyType} onChange={(e) => setKeyType(e.target.value)} disabled={keyRoot === "none"}>{KEYS_TYPE.map(k => <option key={k} value={k}>{k === "Major" ? "Major" : "Minor"}</option>)}</select>
                   <div className="w-full h-full flex flex-col items-center justify-center pointer-events-none"><span className={`text-xs font-bold ${keyRoot === "none" ? "text-slate-300" : "text-purple-600"}`}>{keyType === "Major" ? "Major" : "Minor"}</span></div>
                </div>
            </div>
            
            <button className={`col-start-4 row-start-3 row-span-2 rounded-2xl flex flex-col items-center justify-center shadow-lg transition-all active:scale-95 border border-white/20 relative overflow-hidden group ${canAnalyze && !loading ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-300 cursor-not-allowed"}`} onClick={analyze} disabled={!canAnalyze || loading}>
               <div className="relative z-10 flex flex-col items-center gap-1">
                 {loading ? <IconRefresh className="animate-spin w-5 h-5" /> : <IconArrowRight className="w-5 h-5" />}
                 <span className="text-[10px] font-bold leading-tight">分析</span>
               </div>
            </button>

            {/* Row 4: Ask AI (Disabled when no result) */}
            <button 
              onClick={focusInput} 
              disabled={!hasResult}
              className={`col-start-1 col-span-3 row-start-4 h-14 rounded-2xl border font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 relative overflow-hidden group 
                ${!hasResult 
                  ? "bg-slate-100 border-slate-200 text-slate-300 shadow-none cursor-default" 
                  : "bg-white/60 border-white/40 shadow-cyan-500/10 text-cyan-600 hover:bg-white/80"
                }`}
            >
               {hasResult && <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity bg-cyan-400`}></div>}
               <div className={`w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] shadow-sm relative z-10 ${!hasResult ? "bg-slate-200 text-white" : "bg-cyan-500 text-white"}`}>
                  <IconBook className="w-3 h-3" />
               </div>
               <span className={`text-xs font-bold relative z-10`}>Cadencia AI にきく</span>
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

// Icons
const IconBook = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
const IconSparkles = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>;
const IconSend = ({className}: {className?: string}) => <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IconRefresh = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
const IconTrash = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
const IconTwitter = ({className}: {className?: string}) => <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
const IconArrowRight = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;
const IconRobot = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
const IconKeyboard = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M6 12h.001"/><path d="M10 12h.001"/><path d="M14 12h.001"/><path d="M18 12h.001"/><path d="M7 16h10"/></svg>;
const IconX = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;