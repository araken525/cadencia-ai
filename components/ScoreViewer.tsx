"use client";

import { useEffect, useRef } from "react";
// ★修正: Vex.Flow 経由ではなく、直接部品をインポートする形に変更
import { 
  Renderer, 
  Stave, 
  StaveNote, 
  Accidental, 
  Voice, 
  Formatter 
} from "vexflow";

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

    // 初期化
    container.innerHTML = "";
    
    // ★修正: new Vex.Flow.Renderer -> new Renderer
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    rendererRef.current = renderer;

    const width = 280; 
    const height = 110;
    renderer.resize(width, height);
    
    const context = renderer.getContext();

    // ★修正: new Vex.Flow.Stave -> new Stave
    const stave = new Stave(0, 0, width - 5);
    stave.addClef("treble");
    stave.setContext(context).draw();

    if (notes.length === 0) return;

    const vexNotes = notes.map((note) => {
      let key = note.charAt(0).toLowerCase();
      let accRaw = note.slice(1);
      
      let accVex = "";
      if (accRaw === "#" || accRaw === "♯") accVex = "#";
      else if (accRaw === "b" || accRaw === "♭") accVex = "b";
      else if (accRaw === "##" || accRaw === "x" || accRaw === "𝄪") accVex = "##";
      else if (accRaw === "bb" || accRaw === "𝄫") accVex = "bb";

      let octave = 4;
      if (bassHint && note === bassHint) octave = 3;
      else if (!bassHint && rootHint && note === rootHint) octave = 3;

      return { 
        keys: [`${key}/${octave}`], 
        duration: "w", 
        acc: accVex 
      };
    });

    const chordKeys = vexNotes.map(n => n.keys[0]);
    
    // ★修正: new Vex.Flow.StaveNote -> new StaveNote
    const staveNote = new StaveNote({
      keys: chordKeys,
      duration: "w",
      auto_stem: true,
      align_center: true,
    });

    vexNotes.forEach((n, index) => {
      if (n.acc) {
        // ★修正: new Vex.Flow.Accidental -> new Accidental
        staveNote.addModifier(new Accidental(n.acc), index);
      }
    });

    // ★修正: new Vex.Flow.Voice -> new Voice
    const voice = new Voice({ num_beats: 4, beat_value: 4 });
    voice.addTickables([staveNote]);

    // ★修正: new Vex.Flow.Formatter -> new Formatter
    const formatter = new Formatter();
    formatter.joinVoices([voice]).format([voice], width - 60);

    voice.draw(context, stave);

  }, [notes, bassHint, rootHint]);

  return (
    <div 
      ref={containerRef} 
      className="flex justify-center items-center overflow-hidden bg-white/60 rounded-xl border border-slate-100/50 shadow-inner"
      style={{ transform: "scale(0.85)", transformOrigin: "center top" }}
    />
  );
}