// ============================================================
// sound.js — Web Audio による効果音(外部音源不要・オフライン対応)
//   ・どんぐりラン用の効果音をすべて合成音でその場生成
//   ・ミュート設定は端末内(localStorage)に保存
// ============================================================

const MUTE_KEY = 'donguri-sound-muted';
let ctx = null;
let muted = localStorage.getItem(MUTE_KEY) === '1';

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** 最初のタップ/クリックで呼ぶ(iOS Safariの自動再生制限対策) */
export function unlockAudio() {
  try { getCtx(); } catch { /* AudioContext未対応環境は無音のまま */ }
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}
export function toggleMute() { setMuted(!muted); return muted; }

function tone(freq, dur, { type = 'sine', gain = 0.18, delay = 0, sweep = 0, attack = 0.005 } = {}) {
  if (muted) return;
  let c;
  try { c = getCtx(); } catch { return; }
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, { gain = 0.14, delay = 0, filterFreq = 1200 } = {}) {
  if (muted) return;
  let c;
  try { c = getCtx(); } catch { return; }
  const t0 = c.currentTime + delay;
  const bufSize = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = filterFreq;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// ---- どんぐりラン効果音 ----
export function sfxJump() { tone(520, 0.16, { type: 'triangle', sweep: 260, gain: 0.16 }); }
export function sfxLand() { tone(180, 0.09, { type: 'sine', sweep: -60, gain: 0.12 }); }
export function sfxSlide() { noise(0.22, { gain: 0.1, filterFreq: 900 }); }
export function sfxLaneChange() { tone(700, 0.07, { type: 'sine', sweep: 200, gain: 0.08 }); }

export function sfxCollect(combo = 1) {
  const base = 780 + Math.min(combo, 8) * 55;
  tone(base, 0.09, { type: 'sine', gain: 0.15 });
  tone(base * 1.5, 0.12, { type: 'sine', gain: 0.1, delay: 0.045 });
}
export function sfxGolden() {
  [0, 0.08, 0.16].forEach((d, i) => tone(880 + i * 220, 0.14, { type: 'triangle', gain: 0.16, delay: d }));
}
export function sfxShieldGet() { tone(500, 0.22, { type: 'sawtooth', sweep: 400, gain: 0.12 }); }
export function sfxShieldBreak() {
  noise(0.18, { gain: 0.16, filterFreq: 500 });
  tone(220, 0.15, { type: 'square', sweep: -100, gain: 0.1, delay: 0.02 });
}
export function sfxHit() {
  noise(0.25, { gain: 0.2, filterFreq: 350 });
  tone(140, 0.35, { type: 'sawtooth', sweep: -90, gain: 0.18, delay: 0.02 });
}
export function sfxGameOver() {
  [523, 466, 392, 330].forEach((f, i) => tone(f, 0.28, { type: 'sine', gain: 0.13, delay: i * 0.13 }));
}
export function sfxCountdownTick() { tone(440, 0.1, { type: 'square', gain: 0.12 }); }
export function sfxCountdownGo() { tone(660, 0.22, { type: 'triangle', sweep: 220, gain: 0.18 }); }
export function sfxMilestone() {
  [660, 880].forEach((f, i) => tone(f, 0.16, { type: 'sine', gain: 0.12, delay: i * 0.1 }));
}
export function sfxClick() { tone(600, 0.05, { type: 'sine', gain: 0.08 }); }
