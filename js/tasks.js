// ============================================================
// tasks.js — タスク管理画面(仕様書4.3・4.4)
// ============================================================
import * as DB from './db.js';
import { $, $$, esc, toast, confirmDialog } from './ui.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
let editingId = null;
let showArchived = false;
let onChange = () => {};

export function initTasks(refreshApp) {
  onChange = refreshApp;
  $('#btn-add-task').addEventListener('click', () => openModal(null));
  $('#tm-cancel').addEventListener('click', closeModal);
  $('#tm-save').addEventListener('click', save);
  $('#tm-archive').addEventListener('click', archive);
  $('#tm-delete').addEventListener('click', remove);
  $('#tm-frequency').addEventListener('change', syncFreqUI);
  $$('#tm-weekdays button').forEach(b =>
    b.addEventListener('click', () => b.classList.toggle('on')));
  $('#btn-show-archived').addEventListener('click', async () => {
    showArchived = !showArchived;
    $('#btn-show-archived').textContent = showArchived ? '休止中のタスクを隠す' : '休止中のタスクを表示';
    await render();
  });
}

export async function render() {
  const tasks = await DB.getTasks({ includeArchived: true });
  const active = tasks.filter(t => !t.isArchived);
  const archived = tasks.filter(t => t.isArchived);

  $('#tasks-empty').classList.toggle('hidden', active.length > 0);

  // カテゴリごとにグループ表示
  const groups = new Map();
  for (const t of active) {
    const cat = t.category || 'その他';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  }
  const wrap = $('#task-groups');
  wrap.innerHTML = '';
  for (const [cat, list] of groups) {
    const g = document.createElement('div');
    g.className = 'cat-group';
    g.innerHTML = `<div class="cat-label">🍃 ${esc(cat)}</div>`;
    for (const t of list) g.appendChild(taskRow(t));
    wrap.appendChild(g);
  }

  // 休止中
  const arcWrap = $('#archived-list');
  arcWrap.classList.toggle('hidden', !showArchived);
  arcWrap.innerHTML = '';
  if (showArchived) {
    for (const t of archived) arcWrap.appendChild(taskRow(t, true));
    if (!archived.length) arcWrap.innerHTML = '<p class="hint" style="text-align:center">休止中のタスクはありません</p>';
  }
}

function taskRow(t, isArchived = false) {
  const el = document.createElement('div');
  el.className = 'task-row' + (isArchived ? ' archived' : '');
  el.draggable = !isArchived;
  el.dataset.id = t.id;
  el.innerHTML = `
    <span class="drag" aria-hidden="true">⠿</span>
    <div class="task-body">
      <div class="task-title">${esc(t.title)}</div>
      <div class="task-meta"><span>${freqLabel(t)}</span>${t.memo ? `<span>📝 ${esc(t.memo)}</span>` : ''}</div>
    </div>
    <span class="edit-hint">›</span>`;
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('drag')) return;
    openModal(t);
  });
  // ドラッグ&ドロップ並び替え
  el.addEventListener('dragstart', () => el.classList.add('dragging'));
  el.addEventListener('dragend', async () => {
    el.classList.remove('dragging');
    await persistOrder();
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = $('.task-row.dragging');
    if (!dragging || dragging === el) return;
    const rect = el.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    el.parentElement.insertBefore(dragging, before ? el : el.nextSibling);
  });
  return el;
}

async function persistOrder() {
  const ids = $$('#task-groups .task-row').map(r => r.dataset.id);
  const tasks = await DB.getTasks({ includeArchived: true });
  for (const t of tasks) {
    const idx = ids.indexOf(t.id);
    if (idx >= 0) { t.sortOrder = idx; await DB.put('tasks', t); }
  }
  onChange();
}

export function freqLabel(t) {
  if (t.frequency === 'daily') return '毎日';
  if (t.frequency === 'weekdays') return (t.weekdays ?? []).map(d => WD[d]).join('・') || '曜日未設定';
  return `週${t.timesPerWeek ?? 3}回`;
}

// ---------- モーダル ----------
async function openModal(task) {
  editingId = task?.id ?? null;
  $('#task-modal-title').textContent = task ? 'タスクを編集' : 'タスクを追加';
  $('#tm-title').value = task?.title ?? '';
  $('#tm-category').value = task?.category ?? '';
  $('#tm-frequency').value = task?.frequency ?? 'daily';
  $('#tm-times').value = task?.timesPerWeek ?? 3;
  $('#tm-memo').value = task?.memo ?? '';
  $$('#tm-weekdays button').forEach(b =>
    b.classList.toggle('on', (task?.weekdays ?? [1, 2, 3, 4, 5]).includes(+b.dataset.d)));
  $('#tm-danger').classList.toggle('hidden', !task);
  $('#tm-archive').textContent = task?.isArchived ? '再開する' : '休止する';
  syncFreqUI();

  // カテゴリのサジェスト(過去入力値)
  const tasks = await DB.getTasks({ includeArchived: true });
  const cats = [...new Set(tasks.map(t => t.category).filter(Boolean))];
  $('#category-suggest').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');

  // 目標セレクト
  const goals = await DB.all('goals');
  $('#tm-goal').innerHTML = '<option value="">なし</option>' +
    goals.filter(g => !g.achievedAt).map(g => `<option value="${g.id}">${esc(g.title)}</option>`).join('');
  $('#tm-goal').value = task?.goalId ?? '';

  $('#task-modal').classList.remove('hidden');
  if (!task) $('#tm-title').focus();
}

function closeModal() { $('#task-modal').classList.add('hidden'); }

function syncFreqUI() {
  const f = $('#tm-frequency').value;
  $('#tm-weekdays').classList.toggle('hidden', f !== 'weekdays');
  $('#tm-times-wrap').classList.toggle('hidden', f !== 'timesPerWeek');
}

async function save() {
  const title = $('#tm-title').value.trim();
  if (!title) { toast('タスク名を入力してください'); $('#tm-title').focus(); return; }
  const data = {
    title,
    category: $('#tm-category').value.trim(),
    frequency: $('#tm-frequency').value,
    weekdays: $$('#tm-weekdays button.on').map(b => +b.dataset.d),
    timesPerWeek: +$('#tm-times').value,
    goalId: $('#tm-goal').value || null,
    memo: $('#tm-memo').value.trim(),
  };
  if (editingId) {
    const t = await DB.get('tasks', editingId);
    await DB.put('tasks', { ...t, ...data });
    toast('タスクを更新しました');
  } else {
    await DB.put('tasks', DB.newTask(data));
    toast('タスクを追加しました 🌰');
  }
  closeModal();
  await render();
  onChange();
}

async function archive() {
  const t = await DB.get('tasks', editingId);
  t.isArchived = !t.isArchived;
  await DB.put('tasks', t);
  toast(t.isArchived ? 'タスクを休止しました' : 'タスクを再開しました');
  closeModal();
  await render();
  onChange();
}

async function remove() {
  const t = await DB.get('tasks', editingId);
  if (!confirmDialog(`「${t.title}」を削除します。\n過去の記録も見えなくなります。よろしいですか?`)) return;
  await DB.del('tasks', editingId);
  toast('タスクを削除しました');
  closeModal();
  await render();
  onChange();
}
