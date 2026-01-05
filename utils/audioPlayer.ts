// utils/audioPlayer.ts
import * as Tone from "tone";

let synth: Tone.PolySynth | null = null;

// 音名定数 (ソート用)
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

// 初期化（ユーザーの初回操作時に呼ばれる）
function initSynth() {
  if (!synth) {
    synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" }, // 柔らかい音
      volume: -8, // 音量調整
      envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 1.2 },
    }).toDestination();
  }
}

// Tone.js用に記号を変換
function normalizeForTone(note: string): string {
  return note
    .replaceAll("♭", "b")
    .replaceAll("♯", "#")
    .replaceAll("𝄫", "bb")
    .replaceAll("𝄪", "x"); // Tone.jsのダブルシャープは 'x'
}

export async function playChord(notes: string[]) {
  if (!notes || notes.length === 0) return;

  // 1. ブラウザの制限解除 (必須)
  await Tone.start();
  initSynth();

  if (!synth) return;

  // 2. 音の高さ（オクターブ）を自動計算
  // 単純な実装として、ソートして「極端に低い音」が出ないように調整
  // (ベース音を3、それ以外を4にする簡易ロジック)
  
  // まず入力順などを整理
  const cleanNotes = notes.map(n => ({
    original: n,
    toneName: normalizeForTone(n),
    val: getNoteValue(normalizeForTone(n))
  })).sort((a, b) => a.val - b.val); // 低い順に並べる

  // 構成音にオクターブを付与
  const notesToPlay = cleanNotes.map((n, i) => {
    // 一番低い音(Bass相当)はオクターブ3、他はオクターブ4
    // ただし、音程が離れすぎないように少し調整
    const octave = (i === 0) ? 3 : 4; 
    return `${n.toneName}${octave}`;
  });

  // 3. 再生 (ジャローンと鳴らす)
  synth.triggerAttackRelease(notesToPlay, "1.5n");
}