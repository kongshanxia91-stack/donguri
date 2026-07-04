// ============================================================
// ui.js — 共通UI(トースト・お祝い・どんぐり飛翔・セリフ)
// ============================================================

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/** 大きなお祝いオーバーレイ(レベルアップ・バッジ) */
export function celebrate(emoji, title, sub = '', ms = 2400) {
  return new Promise(resolve => {
    const el = $('#celebrate');
    $('#celebrate-emoji').textContent = emoji;
    $('#celebrate-title').textContent = title;
    $('#celebrate-sub').textContent = sub;
    el.classList.remove('hidden');
    const close = () => { el.classList.add('hidden'); el.removeEventListener('click', close); resolve(); };
    el.addEventListener('click', close);
    setTimeout(close, ms);
  });
}

/** チェックした場所からヘッダーのどんぐりカウンタへ飛ぶ演出 */
export function flyAcorn(fromEl) {
  const target = $('#chip-acorns');
  if (!fromEl || !target) return;
  const a = fromEl.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const fly = document.createElement('div');
  fly.className = 'fly-acorn';
  fly.textContent = '🌰';
  fly.style.left = `${a.left + a.width / 2 - 12}px`;
  fly.style.top = `${a.top + a.height / 2 - 12}px`;
  document.body.appendChild(fly);
  requestAnimationFrame(() => {
    fly.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.4)`;
    fly.style.opacity = '0.2';
  });
  setTimeout(() => {
    fly.remove();
    target.style.transform = 'scale(1.25)';
    target.style.transition = 'transform .15s';
    setTimeout(() => target.style.transform = '', 160);
  }, 780);
}

let speechTimer = null;
export function say(msg, ms = 4200) {
  const el = $('#speech');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---- リスのセリフ(毎日開きたくなるランダムひとこと) ----
const GREET_MORNING = [
  'おはよう!朝のからだは、ゆっくりほぐそうね',
  'おはよう!今日も一緒にどんぐり集めよう🌰',
  '朝だ〜!深呼吸してからはじめよっか',
];
const GREET_DAY = [
  'こんにちは!マイペースがいちばんだよ',
  '今日の分、1個だけでもえらいんだよ',
  'やあ!無理せずいこうね',
];
const GREET_EVENING = [
  'こんばんは!今日もおつかれさま',
  '夜のストレッチは気持ちいいよね〜',
  '寝る前に1個だけ、どう?',
];
const GREET_NIGHT = [
  'ふぁ…もう遅いね。できる分だけでいいよ',
  '夜ふかしリスさんだ!ぼちぼちいこう',
];
const PAT_REACTIONS = [
  'えへへ、くすぐったい!',
  'なでてくれてありがとう🌰',
  'きゅ〜ん…もっと!',
  '今日もきみが来てくれてうれしいな',
  'しっぽ、ふさふさでしょ?',
];
const CHEER_ON_DONE = [
  'いいね!どんぐりゲット🌰',
  'その調子その調子!',
  'コツコツがいちばん強いんだよ',
  'やった!1個ふえた!',
  'えらい!からだ、よろこんでるよ',
];

export function greeting(name) {
  const h = new Date().getHours();
  let pool;
  if (h >= 5 && h < 11) pool = GREET_MORNING;
  else if (h < 17) pool = GREET_DAY;
  else if (h < 22) pool = GREET_EVENING;
  else pool = GREET_NIGHT;
  return pick(pool);
}
export function patReaction() { return pick(PAT_REACTIONS); }
export function cheer() { return pick(CHEER_ON_DONE); }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** 確認ダイアログ(誤操作防止・仕様書9章) */
export function confirmDialog(msg) { return confirm(msg); }

export function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
