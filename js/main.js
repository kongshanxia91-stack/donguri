// ============================================================
// main.js — 起動・タブ・ホーム画面・毎日起動したくなる仕掛け
// ============================================================
import * as DB from './db.js';
import * as Game from './game.js';
import { SquirrelScene } from './squirrel.js';
import { $, $$, esc, toast, celebrate, flyAcorn, say, greeting, patReaction, cheer, confirmDialog, download } from './ui.js';
import { initTasks, render as renderTasks, freqLabel } from './tasks.js';
import { initGoals, render as renderGoals } from './goals.js';
import { render as renderCollection } from './collection.js';
import { initStats, render as renderStats } from './stats.js';

let scene = null;
let profile = null;
let noteTaskId = null;

// ---------- 起動 ----------
async function boot() {
  await DB.openDB();
  profile = await DB.getProfile();
  applyPrefs();

  // 3Dシーン
  scene = new SquirrelScene($('#scene'));
  scene.setLevel(Game.levelForAcorns(profile.totalAcorns).lv);
  scene.onTap(() => say(patReaction(), 3000));

  // タブ
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.goto)));

  // 各画面の初期化
  initTasks(refreshHeader);
  initGoals(refreshHeader, handleEvents);
  initStats();
  initSettings();
  initNoteModal();

  // ストリーク整合(未達成のまま日付が変わっていたらリセット・6.4)
  profile = await Game.reconcileStreak();

  await refreshHeader();
  await renderHome();

  if (!profile.onboarded) {
    showOnboarding();
  } else {
    await dailyWelcome();
  }

  // Service Worker(オフライン対応)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------- 毎日起動したくなる仕掛け:デイリー演出 ----------
async function dailyWelcome() {
  const today = DB.dateKey();
  if (profile.lastOpenDate !== today) {
    const gap = profile.lastOpenDate ? Game.daysBetween(profile.lastOpenDate, today) : 0;
    profile.lastOpenDate = today;
    // ログインボーナス:1日1回どんぐり+1
    profile.totalAcorns += 1;
    await DB.saveProfile(profile);
    await refreshHeader();
    scene.happy();
    if (gap >= 4) {
      say(`おかえりなさい!また会えてうれしいな。今日からまた一緒にはじめよう🌰`, 5500);
    } else {
      say(`${greeting()} きょうのごほうびどんぐり+1🌰`, 5000);
    }
  } else {
    say(greeting(), 4500);
  }
}

// ---------- タブ切り替え ----------
async function switchView(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.add('hidden'));
  $(`#view-${name}`).classList.remove('hidden');
  if (name === 'home') await renderHome();
  if (name === 'tasks') await renderTasks();
  if (name === 'goals') await renderGoals();
  if (name === 'collection') await renderCollection();
  if (name === 'stats') await renderStats();
}

// ---------- ヘッダー ----------
async function refreshHeader() {
  profile = await DB.getProfile();
  const now = new Date();
  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  $('#chip-date').textContent = `${now.getMonth() + 1}/${now.getDate()}(${wd})`;
  $('#chip-streak').innerHTML = `🔥 <b>${profile.currentStreak}</b>日`;
  $('#chip-acorns').innerHTML = `🌰 <b>${profile.totalAcorns}</b>`;
  const lv = Game.levelForAcorns(profile.totalAcorns);
  $('#level-tag').textContent = `Lv.${lv.lv} ${esc(profile.squirrelName)}`;
  scene?.setLevel(lv.lv);
}

// ---------- ホーム:今日のタスク ----------
async function renderHome() {
  const tasks = await DB.getTasks();
  const today = DB.dateKey();
  const due = tasks.filter(t => Game.isDueToday(t));
  const logs = await DB.getLogsByDate(today);
  const doneMap = new Map(logs.filter(l => l.completed).map(l => [l.taskId, l]));

  const list = $('#today-list');
  list.innerHTML = '';
  $('#today-empty').classList.toggle('hidden', due.length > 0);

  let doneCount = 0;
  for (const t of due) {
    const log = doneMap.get(t.id);
    if (log) doneCount++;
    const li = document.createElement('li');
    li.className = 'task-check' + (log ? ' done' : '');
    li.innerHTML = `
      <button class="check-circle" aria-label="${log ? '完了を取り消す' : '完了にする'}">${log ? '✓' : ''}</button>
      <div class="task-body">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-meta">
          ${t.category ? `<span>🍃 ${esc(t.category)}</span>` : ''}
          <span>${freqLabel(t)}</span>
          ${log?.note ? `<span>📝 ${esc(log.note)}</span>` : ''}
        </div>
      </div>
      <button class="note-btn" aria-label="今日のメモ">✏️</button>`;
    li.querySelector('.check-circle').addEventListener('click', (e) => toggleTask(t, e.currentTarget));
    li.querySelector('.note-btn').addEventListener('click', () => openNote(t));
    list.appendChild(li);
  }

  $('#today-progress').textContent = due.length ? `${doneCount} / ${due.length} 完了` : '';
  $('#all-done-banner').classList.toggle('hidden', !(due.length > 0 && doneCount === due.length));
  scene?.setStash(doneCount);
}

async function toggleTask(task, btnEl) {
  const today = DB.dateKey();
  const existing = await DB.getLog(task.id, today);
  const nowDone = !(existing?.completed);

  await DB.setLog(task.id, today, nowDone);

  if (nowDone) {
    // どんぐり獲得(6.1)
    const { events } = await Game.onTaskCompleted();
    flyAcorn(btnEl);
    scene.happy();
    scene.stashAcorn();
    say(cheer(), 3000);
    await handleEvents(null, events);

    // 全タスク完了チェック
    const tasks = await DB.getTasks();
    const due = tasks.filter(t => Game.isDueToday(t));
    const logs = await DB.getLogsByDate(today);
    const doneIds = new Set(logs.filter(l => l.completed).map(l => l.taskId));
    if (due.length > 0 && due.every(t => doneIds.has(t.id))) {
      const { bonus, events: e2 } = await Game.onAllDone(due.length);
      if (bonus > 0) {
        scene.jump();
        scene.acornRain();
        setTimeout(() => celebrate('🎉', '今日のタスク、ぜんぶ達成!',
          `コンプリートボーナス +${bonus}🌰 ストリーク${(e2.find(x => x.type === 'alldone'))?.streak ?? ''}日目`), 500);
      }
      await handleEvents(null, e2);
    }
  } else {
    toast('完了を取り消しました');
  }

  await refreshHeader();
  await renderHome();
}

/** バッジ・レベルアップなどのイベントを順番に演出 */
async function handleEvents(_ignored, events = []) {
  for (const ev of events ?? []) {
    if (ev.type === 'levelup') {
      scene.jump(); scene.acornRain(10);
      await celebrate(ev.level.icon, `レベルアップ!`, `Lv.${ev.level.lv} ${ev.level.name} になりました`);
      scene.setLevel(ev.level.lv);
    } else if (ev.type === 'badge') {
      await celebrate(ev.badge.icon, `バッジ獲得!`, ev.badge.title);
    } else if (ev.type === 'rare') {
      await celebrate(ev.badge.icon, 'とくべつなどんぐり!', ev.badge.title);
    } else if (ev.type === 'comeback') {
      say('また会えたね!休んだ分、からだは準備できてるよ🌤️', 5000);
    }
  }
  await refreshHeader();
}

// ---------- 実施メモ ----------
function initNoteModal() {
  $('#note-cancel').addEventListener('click', () => $('#note-modal').classList.add('hidden'));
  $('#note-save').addEventListener('click', async () => {
    const today = DB.dateKey();
    const existing = await DB.getLog(noteTaskId, today);
    await DB.setLog(noteTaskId, today, existing?.completed ?? false, $('#note-text').value.trim());
    $('#note-modal').classList.add('hidden');
    toast('メモを保存しました');
    await renderHome();
  });
}
async function openNote(task) {
  noteTaskId = task.id;
  const log = await DB.getLog(task.id, DB.dateKey());
  $('#note-modal-title').textContent = `「${task.title}」の今日のメモ`;
  $('#note-text').value = log?.note ?? '';
  $('#note-modal').classList.remove('hidden');
  $('#note-text').focus();
}

// ---------- オンボーディング ----------
function showOnboarding() {
  const ob = $('#onboarding');
  ob.classList.remove('hidden');
  ob.querySelector('[data-next]').addEventListener('click', () => {
    ob.querySelector('[data-step="1"]').classList.add('hidden');
    ob.querySelector('[data-step="2"]').classList.remove('hidden');
    $('#squirrel-name-input').focus();
  });
  ob.querySelector('[data-finish]').addEventListener('click', async () => {
    const name = $('#squirrel-name-input').value.trim() || 'くるみ';
    profile.squirrelName = name;
    await DB.saveProfile(profile);
    ob.querySelector('[data-step="2"]').classList.add('hidden');
    // PWAとして起動済みならA2HS案内はスキップ
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) { finishOnboarding(); }
    else { ob.querySelector('[data-step="3"]').classList.remove('hidden'); }
  });
  ob.querySelector('[data-done]').addEventListener('click', finishOnboarding);

  async function finishOnboarding() {
    profile.onboarded = true;
    await DB.saveProfile(profile);
    ob.classList.add('hidden');
    await refreshHeader();
    scene.happy();
    say(`はじめまして、${profile.squirrelName}だよ!一緒にどんぐり集めよう🌰`, 6000);
    await dailyWelcome();
  }
}

// ---------- 設定 ----------
function initSettings() {
  $('#btn-settings').addEventListener('click', async () => {
    profile = await DB.getProfile();
    $('#set-name').value = profile.squirrelName;
    $('#set-fontsize').value = profile.fontSize;
    $('#set-theme').value = profile.theme;
    $('#settings-modal').classList.remove('hidden');
  });
  $('#set-close').addEventListener('click', async () => {
    profile.squirrelName = $('#set-name').value.trim() || profile.squirrelName;
    profile.fontSize = $('#set-fontsize').value;
    profile.theme = $('#set-theme').value;
    await DB.saveProfile(profile);
    applyPrefs();
    await refreshHeader();
    $('#settings-modal').classList.add('hidden');
  });
  $('#set-export').addEventListener('click', async () => {
    const data = await DB.exportAll();
    download(`donguri-backup_${DB.dateKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('バックアップを書き出しました');
  });
  $('#set-import').addEventListener('click', () => $('#set-import-file').click());
  $('#set-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirmDialog('現在のデータをバックアップの内容で置き換えます。よろしいですか?')) return;
      await DB.importAll(data);
      toast('読み込みました');
      location.reload();
    } catch {
      toast('読み込めませんでした。ファイルを確認してください');
    }
  });
  $('#set-reset').addEventListener('click', async () => {
    if (!confirmDialog('すべての記録・タスク・バッジを消します。\nこの操作は取り消せません。よろしいですか?')) return;
    if (!confirmDialog('本当に消しますか?(最終確認)')) return;
    await DB.wipeAll();
    location.reload();
  });
}

function applyPrefs() {
  document.documentElement.dataset.theme = profile.theme ?? 'auto';
  document.documentElement.dataset.fontsize = profile.fontSize ?? 'normal';
}

boot();
