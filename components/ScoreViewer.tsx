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
    
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    rendererRef.current = renderer;

    const width = 280; 
    const height = 110;
    renderer.resize(width, height);
    
    const context = renderer.getContext();

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
    
    const staveNote = new StaveNote({
      keys: chordKeys,
      duration: "w",
      autoStem: true,
      alignCenter: true,
    });

    vexNotes.forEach((n, index) => {
      if (n.acc) {
        staveNote.addModifier(new Accidental(n.acc), index);
      }
    });

    // ★修正: num_beats -> numBeats, beat_value -> beatValue
    const voice = new Voice({ numBeats: 4, beatValue: 4 });
    voice.addTickables([staveNote]);

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