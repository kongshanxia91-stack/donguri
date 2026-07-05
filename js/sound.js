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
  if (bgmGain) {
    try { bgmGain.gain.setTargetAtTime(muted ? 0 : BGM_VOLUME, getCtx().currentTime, 0.05); } catch { /* noop */ }
  }
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
export function sfxMagnet() {
  [440, 550, 660].forEach((f, i) => tone(f, 0.1, { type: 'triangle', gain: 0.13, delay: i * 0.06 }));
}
export function sfxDash() {
  tone(300, 0.35, { type: 'sawtooth', sweep: 600, gain: 0.15 });
  noise(0.3, { gain: 0.08, filterFreq: 2200, delay: 0.05 });
}
export function sfxNearMiss() { noise(0.09, { gain: 0.1, filterFreq: 3000 }); }
export function sfxSmash() {
  noise(0.2, { gain: 0.18, filterFreq: 700 });
  tone(180, 0.18, { type: 'square', sweep: -80, gain: 0.12 });
}
export function sfxMissionDone() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.14, delay: i * 0.11 }));
}

// ---- どんぐりラン BGM(こちらも外部音源なしで合成・ループ生成) ----
const BGM_VOLUME = 0.16;
const BGM_STEP_SEC = 0.19;
// ベース(4小節ループ、C-Am-F-G進行)+ 5音音階の明るいメロディ
const BGM_BASS = [
  130.81, 0, 130.81, 0, 130.81, 0, 130.81, 0,
  110.00, 0, 110.00, 0, 110.00, 0, 110.00, 0,
  87.31, 0, 87.31, 0, 87.31, 0, 87.31, 0,
  98.00, 0, 98.00, 0, 98.00, 0, 98.00, 0,
];
const BGM_MELODY = [
  659.25, 0, 587.33, 0, 523.25, 0, 587.33, 0,
  659.25, 0, 783.99, 0, 659.25, 0, 587.33, 0,
  523.25, 0, 587.33, 0, 659.25, 0, 523.25, 0,
  493.88, 0, 587.33, 0, 523.25, 0, 440.00, 0,
];

let bgmGain = null;
let bgmPlaying = false;
let bgmStepIndex = 0;
let bgmNextTime = 0;
let bgmTimer = null;

function ensureBgmGain(c) {
  if (!bgmGain) {
    bgmGain = c.createGain();
    bgmGain.gain.value = muted ? 0 : BGM_VOLUME;
    bgmGain.connect(c.destination);
  }
  return bgmGain;
}

function bgmNote(c, master, freq, t0, dur, type, gainScale) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.5 * gainScale, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function bgmKick(c, master, t0) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.1);
  g.gain.setValueAtTime(0.55, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.15);
}

function bgmHat(c, master, t0) {
  const dur = 0.05;
  const bufSize = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 6500;
  const g = c.createGain();
  g.gain.setValueAtTime(0.22, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function scheduleBgm() {
  let c;
  try { c = getCtx(); } catch { return; }
  const master = ensureBgmGain(c);
  while (bgmNextTime < c.currentTime + 0.25) {
    const i = bgmStepIndex % BGM_BASS.length;
    const bf = BGM_BASS[i];
    if (bf) bgmNote(c, master, bf, bgmNextTime, BGM_STEP_SEC * 3.4, 'triangle', 0.5);
    const mf = BGM_MELODY[i];
    if (mf) bgmNote(c, master, mf, bgmNextTime, BGM_STEP_SEC * 0.9, 'sine', 0.85);
    // ドラム:キックは1拍ごと・ハイハットは裏拍で走る疾走感を出す
    if (i % 4 === 0) bgmKick(c, master, bgmNextTime);
    if (i % 2 === 1) bgmHat(c, master, bgmNextTime);
    bgmNextTime += BGM_STEP_SEC;
    bgmStepIndex++;
  }
}

/** ゲーム開始(カウントダウン完了)で呼ぶ。すでに再生中なら何もしない */
export function startBgm() {
  if (bgmPlaying) return;
  let c;
  try { c = getCtx(); } catch { return; }
  bgmPlaying = true;
  const master = ensureBgmGain(c);
  master.gain.cancelScheduledValues(c.currentTime);
  master.gain.setValueAtTime(muted ? 0 : BGM_VOLUME, c.currentTime);
  bgmStepIndex = 0;
  bgmNextTime = c.currentTime + 0.05;
  scheduleBgm();
  bgmTimer = setInterval(scheduleBgm, 120);
}

/** ゲームオーバー・一時停止・閉じるで呼ぶ */
export function stopBgm() {
  if (!bgmPlaying) return;
  bgmPlaying = false;
  clearInterval(bgmTimer);
  bgmTimer = null;
  if (bgmGain) {
    try { bgmGain.gain.setTargetAtTime(0, getCtx().currentTime, 0.08); } catch { /* noop */ }
  }
}
