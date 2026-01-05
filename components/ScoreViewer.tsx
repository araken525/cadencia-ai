"use client";

import { useEffect, useRef } from "react";
import { 
  Renderer, 
  Stave, 
  StaveNote, 
  Accidental, 
  Voice, 
  Formatter 
} from "vexflow";

// 音の高さ比較用
const NOTE_ORDER: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 };

type ScoreViewerProps = {
  notes: string[];
  bassHint: string | null;
  rootHint: string | null;
};

export default function ScoreViewer({ notes, bassHint, rootHint }: ScoreViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    container.innerHTML = "";
    
    // 背景透明設定のために alpha: true
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    rendererRef.current = renderer;

    const width = 280; 
    const height = 110;
    renderer.resize(width, height);
    
    const context = renderer.getContext();
    
    // ★デザインA: 音符や線の色を Slate-500 (#64748b) に統一
    const themeColor = "#64748b";
    context.setFillStyle(themeColor);
    context.setStrokeStyle(themeColor);

    const stave = new Stave(0, 0, width - 5);
    stave.addClef("treble");
    // 五線譜の色変更
    stave.setContext(context).draw();

    if (notes.length === 0) return;

    // --- オクターブ視覚調整ロジック ---
    // 目的: バス音を一番下に配置しつつ、全体を五線譜の中に収める(Octave 4-5付近)
    
    // 基準となる音（バス指定があればバス、なければルート、それもなければ最初の音）
    const baseNoteRaw = bassHint || rootHint || notes[0];
    const baseKey = baseNoteRaw.charAt(0).toLowerCase();
    const baseVal = NOTE_ORDER[baseKey];

    const vexNotes = notes.map((note) => {
      let key = note.charAt(0).toLowerCase();
      let accRaw = note.slice(1);
      
      let accVex = "";
      if (accRaw === "#" || accRaw === "♯") accVex = "#";
      else if (accRaw === "b" || accRaw === "♭") accVex = "b";
      else if (accRaw === "##" || accRaw === "x" || accRaw === "𝄪") accVex = "##";
      else if (accRaw === "bb" || accRaw === "𝄫") accVex = "bb";

      // 視覚用オクターブ計算:
      // 基準音(Bass)を 4 に固定。
      // 他の音は、基準音よりアルファベット順で「低い」なら、上のオクターブ(5)に飛ばす。
      // 例: Bass=G, Target=C -> CはGより低いので、C5にする (G4の下のC4ではなく)
      const currentVal = NOTE_ORDER[key];
      let octave = 4;
      
      if (note !== baseNoteRaw) {
         if (currentVal < baseVal) {
            octave = 5;
         }
      }

      return { 
        keys: [`${key}/${octave}`], 
        duration: "w", 
        acc: accVex 
      };
    });

    const chordKeys = vexNotes.map(n => n.keys[0]);
    
    const staveNote = new StaveNote({
      keys: chordKeys,
      duration: "w",
      autoStem: true,
      alignCenter: true,
    });

    // 音符自体の色変更
    staveNote.setStyle({ fillStyle: themeColor, strokeStyle: themeColor });

    vexNotes.forEach((n, index) => {
      if (n.acc) {
        // 臨時記号の色変更も忘れずに
        const acc = new Accidental(n.acc);
        // VexFlow 4.xでのスタイル適用は addModifier 後に行われることが多いが
        // ここでは念のためModifier自体はデフォルト生成し、描画時にContextの色を使うことを期待
        // ※厳密に指定するなら acc.setStyle(...) だが、Contextの色が継承される場合が多い
        staveNote.addModifier(acc, index);
      }
    });

    const voice = new Voice({ numBeats: 4, beatValue: 4 });
    voice.addTickables([staveNote]);

    const formatter = new Formatter();
    formatter.joinVoices([voice]).format([voice], width - 60);

    voice.draw(context, stave);

    // SVG内の全てのパス要素の色を強制的に上書き（念押し）
    const svg = container.querySelector("svg");
    if (svg) {
       svg.style.overflow = "visible"; // はみ出し防止
       const paths = svg.querySelectorAll("path");
       paths.forEach(p => {
          p.setAttribute("fill", themeColor);
          p.setAttribute("stroke", themeColor);
       });
       // テキスト（拍子記号など）
       const texts = svg.querySelectorAll("text");
       texts.forEach(t => {
          t.setAttribute("fill", themeColor);
       });
    }

  }, [notes, bassHint, rootHint]);

  return (
    <div 
      ref={containerRef} 
      // ★デザインA: 背景色や枠線を削除、少し透明度を持たせて馴染ませる
      className="flex justify-center items-center pointer-events-none opacity-80"
      style={{ transform: "scale(0.9)", transformOrigin: "center top" }}
    />
  );
}