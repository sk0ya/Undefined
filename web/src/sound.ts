// 効果音。音声ファイルを持たずに済むよう WebAudio で合成する。
// ブラウザの自動再生制限があるため、最初のユーザー操作まで音は鳴らない。

let ctx: AudioContext | null = null;
let muted = localStorage.getItem("reqgame_muted") === "1";

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  localStorage.setItem("reqgame_muted", v ? "1" : "0");
  if (!v) unlockAudio();
}

/** クリック等のユーザー操作から呼ぶと、以降の自動再生が許可される */
export function unlockAudio() {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
}

type Note = { freq: number; at: number; dur: number; gain?: number };

function play(notes: Note[]) {
  if (muted) return;
  unlockAudio();
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime;
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.freq;
    const peak = n.gain ?? 0.16;
    g.gain.setValueAtTime(0.0001, t0 + n.at);
    g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.dur + 0.05);
  }
}

/** 残り1分の予告(控えめな2音) */
export function playWarning() {
  play([
    { freq: 784, at: 0, dur: 0.16, gain: 0.1 },
    { freq: 659, at: 0.18, dur: 0.22, gain: 0.1 },
  ]);
}

/** タイムアップ(下降する3音) */
export function playTimeUp() {
  play([
    { freq: 880, at: 0, dur: 0.22 },
    { freq: 698, at: 0.24, dur: 0.22 },
    { freq: 523, at: 0.48, dur: 0.5 },
  ]);
}

/** イベント配信・NPC回答の到着 */
export function playDing() {
  play([
    { freq: 1046, at: 0, dur: 0.14, gain: 0.09 },
    { freq: 1318, at: 0.09, dur: 0.26, gain: 0.09 },
  ]);
}

/** 結果発表のファンファーレ */
export function playFanfare() {
  play([
    { freq: 523, at: 0, dur: 0.16 },
    { freq: 659, at: 0.14, dur: 0.16 },
    { freq: 784, at: 0.28, dur: 0.16 },
    { freq: 1046, at: 0.42, dur: 0.7 },
  ]);
}
