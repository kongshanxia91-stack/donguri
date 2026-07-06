// ============================================================
// video.js — リハビリ動画ログ機能
//   ・登録したYouTube動画から「今日の1本」を日替わりで自動選択
//   ・視聴終了(ENDED)または80%以上視聴でその日の記録を解放
//   ・開始前/終了後の痛みレベル+メモを記録、継続状況を表示
//   ・どんぐり・ストリーク・レベルなど既存の報酬システムには影響しない
// ============================================================
import * as DB from './db.js';
import { $, $$, esc, toast, confirmDialog } from './ui.js';
import { createPlayer } from './youtube.js';

const EPOCH_UTC = Date.UTC(2024, 0, 1);

let videos = [];
let todaysVideo = null;
let todayLog = null;
let playerHandle = null;
let mountedForKey = null; // どの動画/日付でプレイヤーがマウント済みか(再訪問での多重生成・競合書き込み防止)
let mountToken = 0;       // 多重マウント時、古い方のコールバックを無効化するための世代番号
let editingId = null;   // 動画モーダル:nullなら新規、idなら編集
let forceEditMode = false; // 「記録を編集する」で状態Aへ強制的に戻す
let painBefore = null;
let painAfter = null;

// ---------- 「今日の動画」ローテーション ----------
function dayIndexSinceEpoch(d = new Date()) {
  // ローカルの年月日からUTCタイムスタンプを作ってから割るのでDSTのズレを回避する
  const localMidnightAsUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((localMidnightAsUTC - EPOCH_UTC) / 86400000);
}
function pickTodaysVideo(list) {
  const active = list.filter(v => !v.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!active.length) return null;
  // 開始日を保存せず日付とアクティブ動画数だけで決まる式。
  // 動画の追加・削除・非表示でローテーションの対応先が動くのは仕様上のトレードオフ。
  const idx = ((dayIndexSinceEpoch() % active.length) + active.length) % active.length;
  return active[idx];
}

// ---------- URL/ID解析 ----------
export function parseVideoId(input) {
  const s = (input || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const patterns = [/[?&]v=([\w-]{11})/, /youtu\.be\/([\w-]{11})/, /embed\/([\w-]{11})/, /shorts\/([\w-]{11})/];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---------- 痛みレベル(0〜10のボタン行) ----------
function buildPainScale(container, onChange) {
  container.innerHTML = '';
  for (let i = 0; i <= 10; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i);
    b.dataset.v = String(i);
    b.addEventListener('click', () => {
      $$('button', container).forEach(x => x.classList.toggle('on', x === b));
      onChange(i);
    });
    container.appendChild(b);
  }
}
function setPainScaleValue(container, value) {
  $$('button', container).forEach(b => b.classList.toggle('on', Number(b.dataset.v) === value));
}

// ---------- 初期化(静的な要素のイベント配線は一度だけ) ----------
export function initVideo() {
  buildPainScale($('#vs-pain-before-scale'), v => { painBefore = v; });
  buildPainScale($('#vs-pain-after-scale'), v => { painAfter = v; });

  $('#vs-start').addEventListener('click', onStart);
  $('#vs-record').addEventListener('click', onRecordClick);
  $('#vs-save').addEventListener('click', onSaveAfter);
  $('#vs-edit').addEventListener('click', () => { forceEditMode = true; renderSession(); });

  $('#btn-add-video').addEventListener('click', () => openVideoModal(null));
  $('#vm-cancel').addEventListener('click', () => $('#video-modal').classList.add('hidden'));
  $('#vm-save').addEventListener('click', onSaveVideo);
  $('#vm-archive').addEventListener('click', onArchiveVideo);
  $('#vm-delete').addEventListener('click', onDeleteVideo);
}

/** タブ表示のたびに呼ぶ */
export async function render() {
  videos = await DB.getVideos({ includeArchived: true });
  todaysVideo = pickTodaysVideo(videos);
  todayLog = todaysVideo ? await DB.getVideoLog(DB.dateKey()) : null;

  renderSession();
  await renderContinuity();
  renderVideoList();
  await renderHistory();
}

/** タブを離れる時に呼ぶ(プレイヤー破棄・ポーリング停止) */
export function teardown() {
  teardownPlayerIfAny();
}

// ---------- 今日のセッション ----------
function renderSession() {
  if (!todaysVideo) {
    $('#video-empty').classList.remove('hidden');
    $('#video-session').classList.add('hidden');
    teardownPlayerIfAny();
    return;
  }
  $('#video-empty').classList.add('hidden');
  $('#video-session').classList.remove('hidden');
  $('#vs-title').textContent = todayLog?.videoTitle || todaysVideo.title || '(無題の動画)';

  $('#vs-before').classList.add('hidden');
  $('#vs-watch').classList.add('hidden');
  $('#vs-done').classList.add('hidden');

  const showBefore = !todayLog || forceEditMode;
  if (showBefore) {
    teardownPlayerIfAny();
    $('#vs-before').classList.remove('hidden');
    const prefill = todayLog?.painBefore ?? null;
    painBefore = prefill;
    setPainScaleValue($('#vs-pain-before-scale'), prefill);
  } else if (todayLog.painAfter == null) {
    $('#vs-watch').classList.remove('hidden');
    $('#vs-record').classList.remove('hidden');
    $('#vs-record').disabled = !todayLog.completed;
    $('#vs-afterform').classList.add('hidden');
    $('#vs-watch-hint').textContent = todayLog.completed
      ? '記録できます。'
      : '最後まで見るか、80%視聴すると記録できるようになります。';
    // 同じ動画で既にプレイヤーがマウント済みなら再生成しない
    // (タブを行き来するたびに再生が中断されたり、ポーリングが二重に走って書き込みが競合するのを防ぐ)
    const key = `${DB.dateKey()}:${todayLog.videoId}`;
    if (mountedForKey !== key) mountPlayer(key);
  } else {
    teardownPlayerIfAny();
    $('#vs-done').classList.remove('hidden');
    renderDoneSummary();
  }
}

async function onStart() {
  if (painBefore == null) { toast('痛みレベルを選んでください'); return; }
  todayLog = await DB.setVideoLog(DB.dateKey(), {
    videoId: todaysVideo.videoId,
    videoTitle: todaysVideo.title,
    painBefore, painAfter: null, memo: '',
    watchRatio: 0, completed: false,
  });
  forceEditMode = false;
  renderSession();
}

async function mountPlayer(key) {
  teardownPlayerIfAny();
  const myToken = ++mountToken;
  const dateAtMount = DB.dateKey();
  mountedForKey = key;
  $('#video-embed-wrap').innerHTML = '<div id="vs-player"></div>';
  updateProgressUI(todayLog.watchRatio || 0);
  try {
    const handle = await createPlayer('vs-player', todayLog.videoId, {
      initialRatio: todayLog.watchRatio || 0,
      onProgress: (ratio) => {
        if (myToken !== mountToken) return; // 破棄済み/差し替え済みなら無視(競合書き込み防止)
        todayLog.watchRatio = Math.max(todayLog.watchRatio || 0, ratio);
        updateProgressUI(todayLog.watchRatio);
        DB.setVideoLog(dateAtMount, { watchRatio: todayLog.watchRatio });
      },
      onUnlock: async (reason, ratio) => {
        if (myToken !== mountToken) return;
        todayLog.completed = true;
        todayLog.watchRatio = Math.max(todayLog.watchRatio || 0, ratio);
        todayLog = await DB.setVideoLog(dateAtMount, { completed: true, watchRatio: todayLog.watchRatio });
        if (myToken !== mountToken) return;
        $('#vs-record').disabled = false;
        $('#vs-watch-hint').textContent = reason === 'ended' ? '視聴おつかれさまでした!記録できます。' : '80%以上視聴しました!記録できます。';
        toast('記録できるようになりました');
      },
      onError: () => toast('動画を読み込めませんでした。「動画の管理」から確認してください'),
    });
    if (myToken !== mountToken) { handle.destroy(); return; } // 待っている間に差し替えられていた
    playerHandle = handle;
  } catch {
    if (myToken === mountToken) toast('動画プレイヤーを読み込めませんでした(通信環境をご確認ください)');
  }
}
function updateProgressUI(ratio) {
  $('#vs-progress').textContent = `視聴: ${Math.round((ratio || 0) * 100)}%`;
}
function teardownPlayerIfAny() {
  mountToken++; // 進行中のコールバック(onProgress/onUnlock)を無効化
  mountedForKey = null;
  playerHandle?.destroy();
  playerHandle = null;
}

function onRecordClick() {
  if (!todayLog?.completed) return;
  $('#vs-record').classList.add('hidden');
  $('#vs-afterform').classList.remove('hidden');
  painAfter = todayLog.painAfter ?? null;
  setPainScaleValue($('#vs-pain-after-scale'), painAfter);
  $('#vs-memo').value = todayLog.memo || '';
}

async function onSaveAfter() {
  if (painAfter == null) { toast('痛みレベルを選んでください'); return; }
  const memo = $('#vs-memo').value.trim();
  // 先にポーリングを止めてから保存する(視聴率の自動保存と競合して上書きされるのを防ぐ)
  teardownPlayerIfAny();
  todayLog = await DB.setVideoLog(DB.dateKey(), { painAfter, memo, datetime: new Date().toISOString() });
  toast('記録しました🌰');
  renderSession();
  await renderContinuity();
  await renderHistory();
}

function renderDoneSummary() {
  const l = todayLog;
  $('#vs-summary').innerHTML = `
    <div class="row2"><span>痛み ${l.painBefore ?? '-'} → ${l.painAfter ?? '-'}</span><span>${l.completed ? '✅ 視聴完了' : ''}</span></div>
    ${l.memo ? `<p class="hint">📝 ${esc(l.memo)}</p>` : ''}`;
}

// ---------- 継続状況 ----------
async function renderContinuity() {
  const logs = await DB.getAllVideoLogs(); // 新しい順
  const card = $('#video-continuity');
  if (!logs.length) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  // ストリーク:今日(未記録なら直近の記録日)から遡って連続している日数
  const byDate = new Set(logs.map(l => l.date));
  let streak = 0;
  const cursor = new Date();
  if (!byDate.has(DB.dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (byDate.has(DB.dateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  $('#vc-streak').innerHTML = `🔥 <b>${streak}</b>日`;

  const recent = logs.slice(0, 14).filter(l => l.painBefore != null && l.painAfter != null).reverse();
  if (recent.length) {
    const avgDelta = recent.reduce((s, l) => s + (l.painBefore - l.painAfter), 0) / recent.length;
    $('#vc-avgdelta').innerHTML = `${avgDelta >= 0 ? '📉' : '📈'} 平均${avgDelta >= 0 ? '-' : '+'}${Math.abs(avgDelta).toFixed(1)}`;
  } else {
    $('#vc-avgdelta').textContent = '';
  }
  renderPainTrendSvg(recent);
}

function renderPainTrendSvg(entries) {
  const wrap = $('#vc-trend');
  if (!entries.length) { wrap.innerHTML = ''; return; }
  const barW = 14, gap = 8, h = 60, max = 10;
  const svgW = entries.length * (barW * 2 + gap) + gap;
  let bars = '';
  entries.forEach((l, i) => {
    const x = gap + i * (barW * 2 + gap);
    const hb = Math.max(2, (l.painBefore / max) * h);
    const ha = Math.max(2, (l.painAfter / max) * h);
    bars += `<rect x="${x}" y="${h - hb}" width="${barW}" height="${hb}" style="fill:var(--moss);opacity:.45"/>`;
    bars += `<rect x="${x + barW}" y="${h - ha}" width="${barW}" height="${ha}" style="fill:var(--moss-deep)"/>`;
  });
  wrap.innerHTML = `<svg viewBox="0 0 ${svgW} ${h}" style="width:100%;height:${h}px;display:block">${bars}</svg>`;
}

// ---------- 動画管理 ----------
function renderVideoList() {
  const list = $('#video-list');
  list.innerHTML = '';
  const sorted = [...videos].sort((a, b) => a.sortOrder - b.sortOrder);
  sorted.forEach((v, i) => {
    const li = document.createElement('li');
    li.className = 'video-list-item' + (v.archived ? ' archived' : '');
    li.innerHTML = `
      <div class="video-list-title">${esc(v.title || v.videoId)}${v.archived ? ' <span class="hint">(非表示)</span>' : ''}</div>
      <div class="video-list-actions">
        <button class="icon-btn small" data-act="up" aria-label="上へ">▲</button>
        <button class="icon-btn small" data-act="down" aria-label="下へ">▼</button>
        <button class="icon-btn small" data-act="edit" aria-label="編集">✏️</button>
      </div>`;
    li.querySelector('[data-act="up"]').addEventListener('click', () => moveVideo(sorted, i, -1));
    li.querySelector('[data-act="down"]').addEventListener('click', () => moveVideo(sorted, i, 1));
    li.querySelector('[data-act="edit"]').addEventListener('click', () => openVideoModal(v));
    list.appendChild(li);
  });
}

async function moveVideo(sorted, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= sorted.length) return;
  const a = sorted[i], b = sorted[j];
  [a.sortOrder, b.sortOrder] = [b.sortOrder, a.sortOrder];
  await DB.put('videos', a);
  await DB.put('videos', b);
  await render();
}

function openVideoModal(v) {
  editingId = v?.id ?? null;
  $('#video-modal-title').textContent = v ? '動画を編集' : '動画を追加';
  $('#vm-url').value = v ? `https://youtu.be/${v.videoId}` : '';
  $('#vm-title').value = v?.title ?? '';
  $('#vm-danger').classList.toggle('hidden', !v);
  $('#vm-archive').textContent = v?.archived ? '表示する' : '非表示にする';
  $('#video-modal').classList.remove('hidden');
}

async function onSaveVideo() {
  const parsed = parseVideoId($('#vm-url').value);
  if (!parsed) { toast('YouTubeのURLまたは動画IDを確認してください'); return; }
  const title = $('#vm-title').value.trim() || parsed;
  if (editingId) {
    const v = videos.find(x => x.id === editingId);
    v.videoId = parsed; v.title = title;
    await DB.put('videos', v);
  } else {
    await DB.put('videos', DB.newVideo({ videoId: parsed, title }));
  }
  $('#video-modal').classList.add('hidden');
  toast('保存しました');
  await render();
}

async function onArchiveVideo() {
  const v = videos.find(x => x.id === editingId);
  v.archived = !v.archived;
  await DB.put('videos', v);
  $('#video-modal').classList.add('hidden');
  toast(v.archived ? '非表示にしました' : '表示するようにしました');
  await render();
}

async function onDeleteVideo() {
  if (!confirmDialog('この動画を削除しますか?(過去の記録は残ります)')) return;
  await DB.del('videos', editingId);
  $('#video-modal').classList.add('hidden');
  toast('削除しました');
  await render();
}

// ---------- これまでの記録 ----------
async function renderHistory() {
  const logs = await DB.getAllVideoLogs();
  const wrap = $('#video-history');
  if (!logs.length) { wrap.innerHTML = '<p class="hint">まだ記録がありません。</p>'; return; }
  wrap.innerHTML = `<ul class="video-history-list">${logs.slice(0, 60).map(l => `
    <li>
      <span class="video-history-date">${l.date}</span>
      <span class="video-history-title">${esc(l.videoTitle || '')}</span>
      <span class="video-history-pain">${l.painBefore ?? '-'}→${l.painAfter ?? '-'}</span>
      <span>${l.completed ? '✅' : ''}</span>
    </li>`).join('')}</ul>`;
}
