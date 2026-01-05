"use client";

import { useEffect, useRef } from "react";
import Vex from "vexflow";

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

    // 初期化（多重描画防止）
    container.innerHTML = "";
    
    const renderer = new Vex.Flow.Renderer(container, Vex.Flow.Renderer.Backends.SVG);
    rendererRef.current = renderer;

    // スマホ向けに少しコンパクトなサイズ
    const width = 280; 
    const height = 110; // 高さを少し詰める
    renderer.resize(width, height);
    
    const context = renderer.getContext();

    // 五線譜 (Stave)
    const stave = new Vex.Flow.Stave(0, 0, width - 5);
    stave.addClef("treble"); // ト音記号
    stave.setContext(context).draw();

    if (notes.length === 0) return;

    // 音符データ変換
    const vexNotes = notes.map((note) => {
      let key = note.charAt(0).toLowerCase();
      let accRaw = note.slice(1);
      
      let accVex = "";
      if (accRaw === "#" || accRaw === "♯") accVex = "#";
      else if (accRaw === "b" || accRaw === "♭") accVex = "b";
      else if (accRaw === "##" || accRaw === "x" || accRaw === "𝄪") accVex = "##";
      else if (accRaw === "bb" || accRaw === "𝄫") accVex = "bb";

      // オクターブ決定 (バス優先ロジック)
      let octave = 4;
      if (bassHint && note === bassHint) octave = 3;
      else if (!bassHint && rootHint && note === rootHint) octave = 3;

      // ★ここがエラーの原因でした（バックスラッシュを削除済み）
      return { 
        keys: [`${key}/${octave}`], 
        duration: "w", 
        acc: accVex 
      };
    });

    const chordKeys = vexNotes.map(n => n.keys[0]);
    const staveNote = new Vex.Flow.StaveNote({
      keys: chordKeys,
      duration: "w",
      auto_stem: true,
      align_center: true,
    });

    // 変化記号の付与
    vexNotes.forEach((n, index) => {
      if (n.acc) {
        staveNote.addModifier(new Vex.Flow.Accidental(n.acc), index);
      }
    });

    // 描画
    const voice = new Vex.Flow.Voice({ num_beats: 4, beat_value: 4 });
    voice.addTickables([staveNote]);

    const formatter = new Vex.Flow.Formatter();
    formatter.joinVoices([voice]).format([voice], width - 60);

    voice.draw(context, stave);

  }, [notes, bassHint, rootHint]);

  return (
    <div 
      ref={containerRef} 
      className="flex justify-center items-center overflow-hidden bg-white/60 rounded-xl border border-slate-100/50 shadow-inner"
      style={{ transform: "scale(0.85)", transformOrigin: "center top" }} // 少し縮小して馴染ませる
    />
  );
}