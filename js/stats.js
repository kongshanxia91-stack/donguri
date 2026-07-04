// ============================================================
// stats.js — 統計・履歴画面(仕様書4.7)
// カレンダーヒートマップ / 週次グラフ / タスク別達成率 / 書き出し
// ============================================================
import * as DB from './db.js';
import * as Game from './game.js';
import { $, esc, toast, download } from './ui.js';

let viewYear, viewMonth; // 表示中の月(0始まり)

export function initStats() {
  const now = new Date();
  viewYear = now.getFullYear(); viewMonth = now.getMonth();
  $('#cal-prev').addEventListener('click', () => { shiftMonth(-1); });
  $('#cal-next').addEventListener('click', () => { shiftMonth(1); });
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#btn-export-json').addEventListener('click', exportJSON);
}
function shiftMonth(d) {
  viewMonth += d;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
}

export async function render() {
  await renderHeatmap();
  await renderWeekly();
  await renderTaskRates();
}

/** その日の達成率(実施すべきタスクのうち完了した割合) */
async function dailyRateMap(fromKey, toKey) {
  const tasks = await DB.getTasks({ includeArchived: true });
  const logs = await DB.getLogsInRange(fromKey, toKey);
  const byDate = new Map();
  for (const l of logs) {
    if (!byDate.has(l.date)) byDate.set(l.date, new Set());
    if (l.completed) byDate.get(l.date).add(l.taskId);
  }
  const map = new Map();
  const d = Game.parseKey(fromKey);
  const end = Game.parseKey(toKey);
  while (d <= end) {
    const key = DB.dateKey(d);
    const due = tasks.filter(t => !t.isArchived && Game.isDueToday(t, d));
    const doneSet = byDate.get(key) ?? new Set();
    const done = due.filter(t => doneSet.has(t.id)).length;
    map.set(key, { due: due.length, done, rate: due.length ? done / due.length : null });
    d.setDate(d.getDate() + 1);
  }
  return map;
}

async function renderHeatmap() {
  $('#cal-month').textContent = `${viewYear}年${viewMonth + 1}月`;
  const first = new Date(viewYear, viewMonth, 1);
  const last = new Date(viewYear, viewMonth + 1, 0);
  const map = await dailyRateMap(DB.dateKey(first), DB.dateKey(last));
  const todayKey = DB.dateKey();

  const hm = $('#heatmap');
  hm.innerHTML = ['日', '月', '火', '水', '木', '金', '土']
    .map(w => `<div class="hm-cell head">${w}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) hm.innerHTML += '<div class="hm-cell blank"></div>';
  for (let day = 1; day <= last.getDate(); day++) {
    const key = DB.dateKey(new Date(viewYear, viewMonth, day));
    const info = map.get(key);
    let cls = '';
    if (info && info.rate !== null && info.done > 0) {
      cls = info.rate >= 1 ? 'l4' : info.rate >= 0.75 ? 'l3' : info.rate >= 0.5 ? 'l2' : 'l1';
    }
    const isToday = key === todayKey ? ' today' : '';
    const title = info && info.due ? `${info.done}/${info.due} 完了` : '対象なし';
    hm.innerHTML += `<div class="hm-cell ${cls}${isToday}" title="${title}">${day}</div>`;
  }
}

async function renderWeekly() {
  // 直近6週間の週次達成率
  const now = new Date();
  const weeks = [];
  for (let w = 5; w >= 0; w--) {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay() - w * 7); // 週の日曜
    const end = new Date(start); end.setDate(start.getDate() + 6);
    weeks.push({ start, end });
  }
  const from = DB.dateKey(weeks[0].start), to = DB.dateKey(weeks.at(-1).end);
  const map = await dailyRateMap(from, to);

  const chart = $('#weekly-chart');
  chart.innerHTML = '';
  for (const { start, end } of weeks) {
    let due = 0, done = 0;
    const d = new Date(start);
    while (d <= end) {
      const info = map.get(DB.dateKey(d));
      if (info) { due += info.due; done += info.done; }
      d.setDate(d.getDate() + 1);
    }
    const pct = due ? Math.round(done / due * 100) : 0;
    chart.innerHTML += `
      <div class="bar-col">
        <span class="bar-val">${due ? pct + '%' : '–'}</span>
        <div class="bar" style="height:${Math.max(3, pct)}%"></div>
        <span class="bar-label">${start.getMonth() + 1}/${start.getDate()}〜</span>
      </div>`;
  }
}

async function renderTaskRates() {
  const tasks = await DB.getTasks();
  const now = new Date();
  const from = new Date(now); from.setDate(now.getDate() - 29);
  const logs = await DB.getLogsInRange(DB.dateKey(from), DB.dateKey(now));

  const wrap = $('#task-rates');
  wrap.innerHTML = '';
  if (!tasks.length) { wrap.innerHTML = '<p class="hint">タスクがまだありません</p>'; return; }

  for (const t of tasks) {
    // このタスクの「実施すべき日」数と完了数
    let due = 0;
    const d = new Date(from);
    while (d <= now) { if (Game.isDueToday(t, d)) due++; d.setDate(d.getDate() + 1); }
    const done = logs.filter(l => l.taskId === t.id && l.completed).length;
    const pct = due ? Math.min(100, Math.round(done / due * 100)) : 0;
    wrap.innerHTML += `
      <div class="rate-row">
        <span class="rate-name">${esc(t.title)}</span>
        <div class="rate-bar"><div class="rate-fill" style="width:${pct}%"></div></div>
        <span class="rate-pct">${pct}%</span>
      </div>`;
  }
}

// ---------- 書き出し(仕様書4.7・8章) ----------
async function exportCSV() {
  const logs = await DB.all('logs');
  const tasks = await DB.getTasks({ includeArchived: true });
  const nameOf = id => tasks.find(t => t.id === id)?.title ?? '(削除済みタスク)';
  const rows = [['日付', 'タスク名', '完了', '完了時刻', 'メモ']];
  logs.sort((a, b) => a.date.localeCompare(b.date));
  for (const l of logs) {
    rows.push([l.date, nameOf(l.taskId), l.completed ? '○' : '', l.completedAt ?? '', l.note ?? '']);
  }
  const csv = '\uFEFF' + rows.map(r =>
    r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`donguri-rehab_${DB.dateKey()}.csv`, csv, 'text/csv');
  toast('CSVを書き出しました');
}

async function exportJSON() {
  const data = await DB.exportAll();
  download(`donguri-rehab_${DB.dateKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('JSONを書き出しました');
}
