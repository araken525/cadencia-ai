"use client";

import { useMemo, useRef, useState, useEffect } from "react";

// --- Design Constants ---
const G = {
  heroGradient: "bg-gradient-to-r from-blue-600 via-cyan-500 to-sky-400",
  // 修正点1: アニメーション時間を5sから8sに変更してゆっくりに
  heroTextShine: "bg-clip-text text-transparent bg-[linear-gradient(110deg,#0ea5e9,45%,#e0f2fe,50%,#0ea5e9)] bg-[length:250%_100%] animate-text-shine drop-shadow-sm",
  cardBase: "bg-white rounded-[32px] shadow-xl shadow-blue-900/5 border border-white overflow-hidden relative",
  glassKey: "bg-white/90 backdrop-blur-2xl border-t border-white/60 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]",
};

const NOTE_KEYS = ["C", "D", "E", "F", "G", "A", "B"];
const KEYS_ROOT = ["none", "C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];
const KEYS_TYPE = ["Major", "Minor"];
const SORT_ORDER = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

const SHORTCUT_QUESTIONS = [
  "詳しく説明して",
  "他の解釈はある？",
  "なぜこの機能になるの？",
];

// --- Types ---
// (略: 以前と同じ)
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
// (略: 以前と同じ)
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
// (略: Icon, FeedbackLink, WelcomeModal, MiniPiano, ResultCard, InsightCard, LoadingOverlay は以前と同じ)

const FeedbackLink = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <a href="https://x.com/araken525_toho?s=21" target="_blank" rel="noopener noreferrer" className={className}>
    {children}
  </a>
);

const WelcomeModal = ({ onClose }: { onClose: () => void }) => {
  return (
    <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xl flex items-center justify-center p-5 animate-in fade-in duration-500">
      <div className={`${G.cardBase} w-full max-w-sm max-h-[90vh] overflow-y-auto bg-gradient-to-b from-white to-slate-50 flex flex-col shadow-2xl shadow-blue-900/20`}>
        <div className="pt-8 pb-4 px-6 text-center relative">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30 mx-auto mb-4 transform -rotate-3">
             <IconBook className="w-7 h-7" />
          </div>
          <h2 className="text-xs font-bold text-slate-400 tracking-widest uppercase mb-1">MUSIC THEORY AI</h2>
          <div className={`text-3xl font-black tracking-tight ${G.heroTextShine} mb-2`}>Cadencia AI</div>
          <p className="text-xs font-bold text-slate-500">ポケットに、専属音楽理論家を。</p>
        </div>
        <div className="px-6 space-y-3">
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
             <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
               <span className="text-lg">🎹</span>
             </div>
             <div>
               <h3 className="text-sm font-black text-slate-800">プロ仕様の理論解析</h3>
               <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                 複雑な和音機能や転回形も、瞬時に特定。
               </p>
             </div>
          </div>
          <div className="bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-2xl border border-blue-100 shadow-sm flex items-center gap-4 relative overflow-hidden">
             <div className="absolute right-0 top-0 w-20 h-20 bg-blue-400/10 rounded-full blur-xl pointer-events-none"></div>
             <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-blue-500 shrink-0 shadow-sm z-10">
               <span className="text-lg">🤖</span>
             </div>
             <div className="z-10">
               <h3 className="text-sm font-black text-blue-700 flex items-center gap-1">
                 最新AIをフル搭載 <IconSparkles className="w-3 h-3 animate-pulse" />
               </h3>
               <p className="text-[10px] text-blue-600/80 leading-tight mt-0.5">
                 疑問があればAIと議論。学習をサポート。
               </p>
             </div>
          </div>
        </div>
        <div className="mt-auto px-6 py-6 space-y-4">
          <div className="bg-slate-900 rounded-2xl p-4 shadow-lg flex items-start gap-3 relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all"></div>
             <div className="text-2xl pt-1 relative z-10">💻</div>
             <div className="relative z-10 flex-1">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-xs font-bold text-white">現在ベータ版です</h3>
                  <span className="text-[9px] font-bold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded border border-slate-600">v0.1.0</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  まだ開発途中ですが、PCやスマホで自由に使えます。バグ報告や機能要望は大歓迎！
                </p>
                <FeedbackLink className="inline-flex items-center gap-1 mt-2 text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors">
                   <IconTwitter className="w-3 h-3" /> 開発者(@araken525_toho)
                </FeedbackLink>
             </div>
          </div>
          <button 
            onClick={onClose}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold text-sm shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:scale-[1.01] active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            <span>分析をはじめる</span>
            <IconArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

// 修正点2: キーボード操作ガイドカードコンポーネントを追加
const KeyboardGuideCard = ({ onClose }: { onClose: () => void }) => (
  <div className={`${G.cardBase} bg-blue-50/50 border-blue-100 shadow-sm mb-6 animate-in fade-in slide-in-from-bottom-2`}>
    <button onClick={onClose} className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 p-1">
      <IconX className="w-4 h-4" />
    </button>
    <div className="p-5 pb-4">
      <h3 className="text-xs font-bold text-blue-600 mb-3 flex items-center gap-2">
        <IconKeyboard className="w-4 h-4" /> キーボードの操作方法
      </h3>
      <ul className="space-y-2.5">
        <GuideItem icon="👆" text={<>キーを<span className="font-bold">タップ</span>して入力しよう</>} />
        <GuideItem icon="↕️" text={<>キーを<span className="font-bold">上にフリックで♯</span>、<span className="font-bold">下にフリックで♭</span>がつきます</>} />
        <GuideItem icon="🎛️" text={<><span className="font-bold">根音</span>または<span className="font-bold">最低音</span>は専用のキーで指定できます</>} />
        <GuideItem icon="🔑" text={<><span className="font-bold">調性(Key)</span>は専用のエリアで指定できます</>} />
        <GuideItem icon="🤖" text={<><span className="font-bold">3つ以上の音</span>を選択し、<span className="font-bold">分析ボタン</span>でAIの分析開始！</>} />
      </ul>
    </div>
  </div>
);

const GuideItem = ({ icon, text }: { icon: string, text: React.ReactNode }) => (
  <li className="flex items-start gap-3 text-[11px] text-slate-600 leading-tight">
    <span className="text-sm shrink-0 relative top-[-1px]">{icon}</span>
    <span>{text}</span>
  </li>
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

// 修正点4: ♯と♭のガイドを常時薄く表示するよう変更
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
      relative rounded-2xl touch-none select-none overflow-visible flex flex-col items-center justify-center transition-all duration-200 z-0
      ${isRoot ? "bg-rose-50 border border-rose-200 shadow-[0_4px_12px_rgba(244,63,94,0.2)]" 
        : isBass ? "bg-amber-50 border border-amber-200 shadow-[0_4px_12px_rgba(251,191,36,0.2)]" 
        : "bg-white/40 border border-white/60 shadow-sm backdrop-blur-md active:bg-white/80"}
      ${!isBass && !isRoot && isActive ? "bg-cyan-50 border-cyan-200 shadow-[0_4px_12px_rgba(34,211,238,0.2)]" : ""}
      ${className}
    `}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
      
      {/* 修正点4: ガイドを常時薄く表示し、操作時に濃く、位置を移動させる */}
      <div className={`absolute top-1 left-0 right-0 flex justify-center transition-all duration-300 ${isUp ? "opacity-100 -translate-y-1 text-cyan-500 scale-125" : "opacity-30 text-slate-400"}`}>
        <span className="text-[8px] font-bold leading-none">♯</span>
      </div>
      <div className={`absolute bottom-1 left-0 right-0 flex justify-center transition-all duration-300 ${isDown ? "opacity-100 translate-y-1 text-cyan-500 scale-125" : "opacity-30 text-slate-400"}`}>
        <span className="text-[8px] font-bold leading-none">♭</span>
      </div>
      
      <span className={`text-2xl font-medium tracking-tight transition-all duration-200 ${isRoot ? "text-rose-500" : isBass ? "text-amber-500" : isActive ? "text-cyan-600" : "text-slate-600"}`} 
        style={{ transform: `translateY(${offsetY * 0.4}px)` }}>
        {displayLabel}
      </span>
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
      <div className={`absolute -right-4 -bottom-6 font-black select-none pointer-events-none z-0 tracking-tighter leading-none ${isTop ? "text-slate-100 text-[10rem]" : "text-slate-50 text-[6rem]"}`}>
        {String(rank).padStart(2, '0')}
      </div>
      <div className="relative z-10 p-6 flex flex-col gap-6">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-2">
             {isTop && (
               <div className="flex items-center gap-2">
                 <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border shadow-sm ${
                    isProvisional 
                    ? "bg-amber-50 text-amber-600 border-amber-100" 
                    : "bg-gradient-to-r from-yellow-50 to-amber-50 text-amber-600 border-amber-100"
                 }`}>
                   {isProvisional ? "⚠️ 暫定判定" : "👑 最有力候補"}
                 </span>
               </div>
             )}
             <h2 className="text-5xl font-black text-slate-800 tracking-tighter leading-none">
               {candidate.chord}
             </h2>
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
                <span className={`text-2xl font-black leading-none ${
                  !isKeySet ? "text-slate-200" :
                  candidate.tds === "T" ? "text-cyan-500" : 
                  candidate.tds === "D" ? "text-rose-500" : 
                  candidate.tds === "S" || candidate.tds === "SD" ? "text-emerald-500" : "text-slate-300"
                }`}>
                  {!isKeySet ? "―" : (candidate.tds === "?" ? "―" : candidate.tds === "SD" ? "S" : candidate.tds)}
                </span>
            </div>
            <div className={`flex-1 flex flex-col items-center justify-center px-1`}>
                <span className="text-[9px] font-bold text-slate-400 mb-1">記号</span>
                <span className={`text-xl font-serif font-black leading-none ${!isKeySet ? "text-slate-200" : "text-slate-700"}`}>
                  {!isKeySet ? "―" : (candidate.romanNumeral || "―")}
                </span>
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
    <div className="absolute -right-4 top-2 text-[5rem] font-black text-slate-900/5 pointer-events-none select-none z-0 transform rotate-[-5deg] tracking-tighter leading-none whitespace-nowrap">
       Cadencia AI
    </div>
    <div className="relative z-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-gradient-to-br from-blue-500 to-cyan-500 shadow-md">
           <IconBook className="w-4 h-4" />
        </div>
        <h3 className="text-sm font-bold text-slate-800">Cadencia AI の考察</h3>
      </div>
      <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap font-medium">{text}</p>
    </div>
  </div>
);

// 修正点6: 質問カードにショートカットボタンを追加
const AskCard = ({ question, setQuestion, ask, isThinking, loading, inputRefProp, answer }: any) => {
  return (
    <div className={`${G.cardBase} p-0 flex flex-col overflow-hidden`}>
      <div className="p-5 border-b border-slate-100 bg-slate-50/50">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <span className="text-xl">💬</span> Cadencia AIに質問しよう！
        </h3>
      </div>
      <div className="p-5 bg-slate-50/30 flex flex-col gap-4 min-h-[120px]">
        {/* 修正点6: ショートカットボタンエリアを追加 */}
        {!answer && !isThinking && (
           <div className="flex flex-wrap gap-2 mb-2">
              {SHORTCUT_QUESTIONS.map((q) => (
                <button 
                  key={q} 
                  onClick={() => { setQuestion(q); setTimeout(ask, 0); }}
                  disabled={loading || isThinking}
                  className="text-[10px] font-bold text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full hover:bg-blue-100 active:scale-95 transition-all"
                >
                  {q}
                </button>
              ))}
           </div>
        )}

        {answer && (
           <div className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white shrink-0 shadow-sm mt-1">
                 <IconRobot className="w-4 h-4" />
              </div>
              <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm text-sm text-slate-700 leading-relaxed max-w-[90%]">
                 {answer}
              </div>
           </div>
        )}
        {isThinking && (
           <div className="flex gap-3 animate-in fade-in duration-300">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-white shrink-0 mt-1">
                 <IconSparkles className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-slate-100 p-3 rounded-2xl rounded-tl-none text-xs font-bold text-slate-400 flex items-center gap-1">
                 AIが考え中<span className="animate-pulse">...</span>
              </div>
           </div>
        )}
        {!answer && !isThinking && SHORTCUT_QUESTIONS.length === 0 && (
           <div className="text-center py-6 text-slate-300 text-xs font-bold">
              気になったことを入力してみよう
           </div>
        )}
      </div>
      <div className="p-3 bg-white border-t border-slate-100">
         <div className="relative flex items-center gap-2">
            <input 
              ref={inputRefProp}
              className="flex-1 bg-slate-100 hover:bg-slate-50 focus:bg-white border-transparent focus:border-blue-200 rounded-full py-3 pl-5 pr-4 text-base focus:outline-none focus:ring-2 focus:ring-blue-100 transition-all text-slate-700 placeholder:text-slate-400" 
              placeholder="例：なぜこの機能になるの？" 
              value={question} 
              onChange={(e) => setQuestion(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && ask()} 
              disabled={isThinking} 
            />
            <button 
              onClick={ask} 
              disabled={loading || isThinking || !question.trim()} 
              className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-all shadow-md active:scale-90 ${!question.trim() ? "bg-slate-200 shadow-none text-slate-400 cursor-default" : "bg-gradient-to-r from-blue-500 to-cyan-500 hover:shadow-lg hover:shadow-cyan-500/20"}`}
            >
              <IconSend className="w-4 h-4 ml-0.5" />
            </button>
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
      <div className="absolute inset-4 rounded-full bg-white/90 shadow-[0_0_30px_rgba(34,211,238,0.5)] flex items-center justify-center">
         <IconSparkles className="w-8 h-8 text-cyan-500 animate-pulse" />
      </div>
    </div>
    <div className="text-center space-y-4 max-w-xs relative z-10">
      <h2 className="text-lg font-black text-slate-800 drop-shadow-sm leading-tight">
        Cadencia AIが和音を分析し、<br/>解説の生成をしています…
      </h2>
      <div className="h-1 w-12 bg-cyan-400/50 rounded-full mx-auto animate-pulse"></div>
      <p className="text-[10px] font-bold text-slate-500 leading-relaxed max-w-[200px] mx-auto opacity-80">
        複雑な和音や、たくさんの解釈がある組み合わせの場合、あらゆる可能性を考慮するため、時間がかかる場合があります。
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
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(true);
  const [showWelcome, setShowWelcome] = useState(true);
  // 修正点2: ガイド表示用の状態を追加
  const [showGuide, setShowGuide] = useState(true);

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

  // 修正点5: キーボードスワイプ用の状態変数
  const [dragStartY, setDragStartY] = useState<number | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  const sortedSelected = useMemo(() => {
    return [...selected].sort((a, b) => SORT_ORDER.indexOf(a) - SORT_ORDER.indexOf(b));
  }, [selected]);

  // Focus Input
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
    setInfoText(""); setQuestion(""); setAnswer(""); setLoading(false); setInputMode("normal");
  };

  async function analyze() {
    if (!canAnalyze || loading) return;
    setLoading(true); setAnswer(""); setInfoText("");
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

  // 修正点5: キーボードスワイプ操作のハンドラ
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
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans pb-[420px] selection:bg-cyan-100 overflow-x-hidden">
      <style jsx global>{`
        @keyframes text-shine {
          0% { background-position: 250% 50%; }
          100% { background-position: -150% 50%; }
        }
        @keyframes float-note-1 { 0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.2; } 50% { transform: translateY(-20px) rotate(10deg); opacity: 0.5; } }
        @keyframes float-note-2 { 0%, 100% { transform: translateY(0px) rotate(0deg); opacity: 0.3; } 50% { transform: translateY(-15px) rotate(-10deg); opacity: 0.6; } }
        
        /* 修正点1: アニメーション時間を8sに変更 */
        .animate-text-shine { animation: text-shine 8s linear infinite; }
        .animate-float-1 { animation: float-note-1 6s ease-in-out infinite; }
        .animate-float-2 { animation: float-note-2 8s ease-in-out infinite; }
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
              <FeedbackLink className="bg-slate-100 border border-slate-200 text-[8px] font-bold text-slate-500 px-1.5 py-0.5 rounded-md hover:bg-slate-200 transition-colors flex items-center gap-1">
                <span>BETA</span><IconTwitter />
              </FeedbackLink>
            </div>
            <span className="text-[10px] font-bold text-slate-400 tracking-wide">ポケットに、専属音楽理論家を。</span>
          </div>
        </div>
      </header>

      <main className="pt-24 px-5 max-w-md mx-auto space-y-8 relative z-10">
        
        {/* 1. Hero with Floating Notes Animation */}
        <section className="text-center space-y-2 py-4 relative">
          <div className="absolute top-0 left-10 text-4xl text-cyan-200 animate-float-1 pointer-events-none select-none">♪</div>
          <div className="absolute bottom-0 right-10 text-3xl text-blue-200 animate-float-2 pointer-events-none select-none">♫</div>
          <div className="absolute top-1/2 right-0 text-xl text-purple-200 animate-float-1 pointer-events-none select-none" style={{animationDelay: '1s'}}>♭</div>
          <div className="inline-block relative z-10">
             <h1 className="text-5xl font-black tracking-tighter pb-2 leading-none flex flex-col items-center">
                <span className="text-[10px] font-bold text-cyan-500 tracking-widest mb-1">カデンツィア</span>
                <span className={G.heroTextShine}>Cadencia AI</span>
             </h1>
          </div>
          <p className="text-sm font-bold text-slate-400 relative z-10">
             ポケットに、専属音楽理論家を。
          </p>
        </section>

        {/* 修正点2: キーボード操作ガイドカードを表示 */}
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
                  <div className="flex items-center justify-center py-2">
                    <span className="bg-slate-100 px-4 py-1.5 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-widest border border-slate-200 shadow-sm">
                      その他の候補一覧
                    </span>
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
                  answer={answer}
                />
              </div>
          </div>
        )}
      </main>

      {/* --- Floating Glass Keyboard --- */}
      {/* 修正点5: スワイプ操作のためにtransformを動的に制御し、イベントハンドラを追加 */}
      <div 
        className={`fixed bottom-0 inset-x-0 z-50 ${G.glassKey} rounded-t-[36px] transition-transform duration-300 ease-out touch-none ${isKeyboardOpen ? "translate-y-0" : "translate-y-[calc(100%-30px)]"}`}
        style={{ transform: isKeyboardOpen ? `translateY(${keyboardOffset}px)` : undefined }}
      >
        {/* Handle */}
        <div 
          className="h-8 flex items-center justify-center cursor-grab active:cursor-grabbing active:opacity-50" 
          onClick={() => setIsKeyboardOpen(!isKeyboardOpen)}
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
           <div className="w-12 h-1 bg-slate-300 rounded-full"></div>
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

            {/* Row 3: Mode & Key (修正点3: デザインを元の3分割に戻す) */}
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
            
            {/* Analyze Button */}
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

// Icons (IconXを追加)
const IconBook = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
const IconSparkles = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L12 3Z"/></svg>;
const IconSend = ({className}: {className?: string}) => <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const IconRefresh = ({className}: {className?: string}) => <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>;
const IconTrash = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
const IconTwitter = ({className}: {className?: string}) => <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>;
const IconArrowRight = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>;
const IconRobot = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>;
const IconKeyboard = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M6 12h.001"/><path d="M10 12h.001"/><path d="M14 12h.001"/><path d="M18 12h.001"/><path d="M7 16h10"/></svg>;
const IconX = ({className}: {className?: string}) => <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;