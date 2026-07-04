// ============================================================
// goals.js — 目標設定画面(仕様書4.5)
// ============================================================
import * as DB from './db.js';
import * as Game from './game.js';
import { $, esc, toast, celebrate, confirmDialog } from './ui.js';

let editingId = null;
let onChange = () => {};
let notifySquirrel = () => {};

export function initGoals(refreshApp, squirrelHook) {
  onChange = refreshApp;
  notifySquirrel = squirrelHook;
  $('#btn-add-goal').addEventListener('click', () => openModal(null));
  $('#gm-cancel').addEventListener('click', closeModal);
  $('#gm-save').addEventListener('click', save);
  $('#gm-delete').addEventListener('click', remove);
  $('#gm-type').addEventListener('change', syncTypeUI);
}

export async function render() {
  const goals = await DB.all('goals');
  goals.sort((a, b) => (a.achievedAt ? 1 : 0) - (b.achievedAt ? 1 : 0));
  $('#goals-empty').classList.toggle('hidden', goals.length > 0);
  const wrap = $('#goal-list');
  wrap.innerHTML = '';

  for (const g of goals) {
    const card = document.createElement('div');
    card.className = 'card goal-card' + (g.achievedAt ? ' achieved' : '');
    const pct = await progressOf(g);
    card.innerHTML = `
      ${g.achievedAt ? '<span class="achieved-stamp">🏅</span>' : ''}
      <span class="goal-type">${g.type === 'habit' ? '習慣目標' : '数値目標'}</span>
      <h3>${esc(g.title)}</h3>
      <div class="goal-dates">${g.startDate} 〜 ${g.endDate ?? '期限なし'}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct.pct}%"></div></div>
      <div class="progress-num">${pct.label}</div>
      ${g.type === 'numeric' && !g.achievedAt ? `
        <div class="numeric-update">
          <input type="number" step="any" value="${g.currentValue ?? ''}" placeholder="現在値" data-cur="${g.id}">
          <span>${esc(g.unit || '')}</span>
          <button class="btn ghost small" data-update="${g.id}">更新</button>
        </div>` : ''}
      <div class="btn-row"><button class="btn ghost small" data-edit="${g.id}">編集</button></div>`;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', async () => openModal(await DB.get('goals', b.dataset.edit))));
  wrap.querySelectorAll('[data-update]').forEach(b =>
    b.addEventListener('click', () => updateNumeric(b.dataset.update)));
}

async function progressOf(g) {
  if (g.type === 'numeric') {
    const cur = g.currentValue ?? 0, tgt = g.targetValue ?? 1;
    const pct = Math.max(0, Math.min(100, Math.round((cur / tgt) * 100)));
    return { pct, label: `${cur} / ${tgt} ${esc(g.unit || '')}(${pct}%)` };
  }
  // 習慣目標:紐付くタスクの完了日数 ÷ 期間(期限なしは開始からの経過日)
  const logs = await DB.all('logs');
  const tasks = await DB.getTasks({ includeArchived: true });
  const linked = tasks.filter(t => t.goalId === g.id).map(t => t.id);
  const doneDays = new Set(
    logs.filter(l => l.completed && l.date >= g.startDate &&
      (linked.length === 0 || linked.includes(l.taskId))).map(l => l.date)).size;
  if (g.endDate) {
    const total = Math.max(1, Game.daysBetween(g.startDate, g.endDate) + 1);
    const pct = Math.min(100, Math.round((doneDays / total) * 100));
    return { pct, label: `${doneDays} / ${total} 日 達成(${pct}%)` };
  }
  return { pct: Math.min(100, doneDays * 3), label: `${doneDays} 日 達成` };
}

async function updateNumeric(id) {
  const g = await DB.get('goals', id);
  const input = document.querySelector(`[data-cur="${id}"]`);
  const val = parseFloat(input.value);
  if (isNaN(val)) { toast('数値を入力してください'); return; }
  g.currentValue = val;
  const reached = g.targetValue != null && val >= g.targetValue && !g.achievedAt;
  if (reached) g.achievedAt = new Date().toISOString();
  await DB.put('goals', g);
  if (reached) {
    const { events } = await Game.onGoalAchieved();
    await celebrate('🎯', '目標達成!', `「${g.title}」を達成しました!どんぐり+5🌰`);
    notifySquirrel('goal', events);
  } else {
    toast('現在値を更新しました');
  }
  await render();
  onChange();
}

// ---------- モーダル ----------
function openModal(goal) {
  editingId = goal?.id ?? null;
  $('#goal-modal-title').textContent = goal ? '目標を編集' : '目標を追加';
  $('#gm-title').value = goal?.title ?? '';
  $('#gm-type').value = goal?.type ?? 'habit';
  $('#gm-target').value = goal?.targetValue ?? '';
  $('#gm-current').value = goal?.currentValue ?? '';
  $('#gm-unit').value = goal?.unit ?? '';
  $('#gm-start').value = goal?.startDate ?? DB.dateKey();
  $('#gm-end').value = goal?.endDate ?? '';
  $('#gm-danger').classList.toggle('hidden', !goal);
  syncTypeUI();
  $('#goal-modal').classList.remove('hidden');
}
function closeModal() { $('#goal-modal').classList.add('hidden'); }
function syncTypeUI() {
  $('#gm-numeric-wrap').classList.toggle('hidden', $('#gm-type').value !== 'numeric');
}

async function save() {
  const title = $('#gm-title').value.trim();
  if (!title) { toast('目標名を入力してください'); return; }
  const data = {
    title,
    type: $('#gm-type').value,
    targetValue: $('#gm-target').value ? parseFloat($('#gm-target').value) : null,
    currentValue: $('#gm-current').value ? parseFloat($('#gm-current').value) : null,
    unit: $('#gm-unit').value.trim(),
    startDate: $('#gm-start').value || DB.dateKey(),
    endDate: $('#gm-end').value || null,
  };
  if (editingId) {
    const g = await DB.get('goals', editingId);
    await DB.put('goals', { ...g, ...data });
    toast('目標を更新しました');
  } else {
    await DB.put('goals', DB.newGoal(data));
    toast('目標を追加しました 🎯');
  }
  closeModal();
  await render();
  onChange();
}

async function remove() {
  const g = await DB.get('goals', editingId);
  if (!confirmDialog(`「${g.title}」を削除しますか?`)) return;
  await DB.del('goals', editingId);
  closeModal();
  await render();
  onChange();
}
