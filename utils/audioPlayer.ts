import * as Tone from "tone";

let sampler: Tone.Sampler | null = null;

// 音名ソート用
const NOTE_ORDER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function getNoteValue(note: string) {
  const match = note.match(/^([A-G])([#b]*)$/);
  if (!match) return 0;
  let val = NOTE_ORDER[match[1]];
  const acc = match[2];
  if (acc === "#") val += 1;
  if (acc === "##" || acc === "x" || acc === "𝄪") val += 2;
  if (acc === "b") val -= 1;
  if (acc === "bb" || acc === "𝄫") val -= 2;
  return val;
}

// 初期化（ピアノ音源のロード）
function initSampler() {
  if (!sampler) {
    sampler = new Tone.Sampler({
      urls: {
        "A0": "A0.mp3", "C1": "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3",
        "A1": "A1.mp3", "C2": "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3",
        "A2": "A2.mp3", "C3": "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3",
        "A3": "A3.mp3", "C4": "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3",
        "A4": "A4.mp3", "C5": "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3",
        "A5": "A5.mp3", "C6": "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3",
        "A6": "A6.mp3", "C7": "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3",
        "A7": "A7.mp3", "C8": "C8.mp3"
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).toDestination();
    
    // 音量調整 (少し大きめにする)
    sampler.volume.value = -5;
  }
}

// Tone.js用に記号を変換
function normalizeForTone(note: string): string {
  return note
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "x"); 
}

export async function playChord(notes: string[], bassHint: string | null = null, rootHint: string | null = null) {
  if (!notes || notes.length === 0) return;

  // 1. ブラウザの制限解除 & ロード開始
  await Tone.start();
  initSampler();

  if (!sampler) return;

  // 2. まだ音源ロード中なら、ロード完了を待つ (初回クリック時の無音防止)
  if (!sampler.loaded) {
    await Tone.loaded();
  }

  // 3. 音高決定ロジック (バス優先)
  const notesToPlay = notes.map((note) => {
    const toneName = normalizeForTone(note);
    let octave = 4; // 基本は真ん中

    // バス指定 or 根音指定(バスなし時) ならオクターブを下げる(3)
    if (bassHint && note === bassHint) {
      octave = 3;
    } else if (!bassHint && rootHint && note === rootHint) {
      octave = 3;
    }
    
    return { note, toneName, octave, val: getNoteValue(toneName) };
  });

  // 指定が一切ない場合は、一番低い音をベース(3)にする
  if (!bassHint && !rootHint) {
    notesToPlay.sort((a, b) => a.val - b.val);
    notesToPlay.forEach((n, i) => {
      if (i === 0) n.octave = 3;
    });
  }

  const finalNotes = notesToPlay.map(n => `${n.toneName}${n.octave}`);

  // 4. 再生 (ダンパーペダルを踏んだような長めの余韻)
  sampler.triggerAttackRelease(finalNotes, "2n");
}
