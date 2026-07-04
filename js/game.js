// ============================================================
// game.js — ゲーミフィケーション(仕様書6章)
// どんぐり獲得 / リス成長レベル / バッジ / ストリーク
// ============================================================
import * as DB from './db.js';

// ---- リス成長段階(6.2) ----
export const LEVELS = [
  { lv: 1, need: 0,   name: 'こどもリス',   icon: '🐿️' },
  { lv: 2, need: 30,  name: 'わかばリス',   icon: '🐿️' },
  { lv: 3, need: 100, name: '冬支度リス',   icon: '🧣' },
  { lv: 4, need: 300, name: '貯蔵庫リス',   icon: '🏡' },
  { lv: 5, need: 600, name: 'ベテランリス', icon: '👑' },
];
export function levelForAcorns(n) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (n >= l.need) cur = l;
  return cur;
}
export function nextLevel(lv) { return LEVELS.find(l => l.lv === lv + 1) ?? null; }

// ---- バッジ定義(6.3) ----
export const BADGES = [
  { key: 'first_step',  icon: '🌱', title: 'はじめの一歩',   cond: '初めてタスクを1件完了する' },
  { key: 'streak_7',    icon: '🍂', title: '1週間コツコツ',  cond: '7日連続でタスクを達成する' },
  { key: 'streak_30',   icon: '🍁', title: '1ヶ月継続',      cond: '30日連続でタスクを達成する' },
  { key: 'streak_100',  icon: '🌟', title: '100日の道のり',  cond: '100日連続でタスクを達成する' },
  { key: 'goal_first',  icon: '🎯', title: '目標達成',       cond: '設定した目標を1つ達成する' },
  { key: 'acorn_100',   icon: '🌰', title: 'どんぐり100個',  cond: '累計どんぐり数が100個に到達' },
  { key: 'acorn_600',   icon: '🪵', title: 'どんぐり長者',   cond: '累計どんぐり数が600個に到達' },
  { key: 'comeback',    icon: '🌤️', title: 'カムバック',     cond: '3日以上空いた後にタスクを再開する' },
];

// ---- とくべつなどんぐり(レアコレクション) ----
export const RARE_ACORNS = [
  { key: 'rare_7',   icon: '🥉', title: 'つやどんぐり',   cond: 'ストリーク7日で獲得' },
  { key: 'rare_30',  icon: '🥈', title: '銀のどんぐり',   cond: 'ストリーク30日で獲得' },
  { key: 'rare_100', icon: '🥇', title: '金のどんぐり',   cond: 'ストリーク100日で獲得' },
  { key: 'rare_all', icon: '✨', title: 'コンプどんぐり', cond: '1日の全タスク達成で獲得(初回)' },
];

export async function getUnlocked() {
  const rows = await DB.all('achievements');
  const map = {};
  for (const r of rows) map[r.key] = r;
  return map;
}

async function unlock(key) {
  const exists = await DB.get('achievements', key);
  if (exists) return null;
  const def = [...BADGES, ...RARE_ACORNS].find(b => b.key === key);
  if (!def) return null;
  const row = { key, title: def.title, condition: def.cond, unlockedAt: new Date().toISOString() };
  await DB.put('achievements', row);
  return { ...def, ...row };
}

/** タスクが「今日実施すべきか」判定(6.4) */
export function isDueToday(task, date = new Date()) {
  if (task.isArchived) return false;
  if (task.frequency === 'daily') return true;
  if (task.frequency === 'weekdays') return (task.weekdays ?? []).includes(date.getDay());
  return true; // timesPerWeek は毎日候補として表示(週◯回の自由裁量)
}

/**
 * タスク完了時の処理。獲得どんぐり数と新規解除(バッジ等)、イベントを返す。
 */
export async function onTaskCompleted() {
  const profile = await DB.getProfile();
  const events = [];
  let gained = 1; // 1タスク=どんぐり1個(6.1)

  const prevLevel = levelForAcorns(profile.totalAcorns).lv;
  profile.totalAcorns += 1;

  // カムバック判定:前回完了から4日以上あいて再開
  if (profile.lastCompletedDate) {
    const gap = daysBetween(profile.lastCompletedDate, DB.dateKey());
    if (gap >= 4) {
      const b = await unlock('comeback');
      if (b) events.push({ type: 'badge', badge: b });
      events.push({ type: 'comeback', gap });
    }
  }
  profile.lastCompletedDate = DB.dateKey();

  // 初完了バッジ
  const b1 = await unlock('first_step');
  if (b1) events.push({ type: 'badge', badge: b1 });

  await DB.saveProfile(profile);

  // どんぐり数バッジ
  if (profile.totalAcorns >= 100) { const b = await unlock('acorn_100'); if (b) events.push({ type: 'badge', badge: b }); }
  if (profile.totalAcorns >= 600) { const b = await unlock('acorn_600'); if (b) events.push({ type: 'badge', badge: b }); }

  // レベルアップ
  const newLevel = levelForAcorns(profile.totalAcorns);
  if (newLevel.lv > prevLevel) {
    profile.squirrelLevel = newLevel.lv;
    await DB.saveProfile(profile);
    events.push({ type: 'levelup', level: newLevel });
  }

  return { gained, events, profile };
}

/**
 * 「その日の対象タスクをすべて完了」したときの処理(6.1, 6.4)。
 * コンプリートボーナス+ストリーク更新。今日まだ加算していなければ加算する。
 */
export async function onAllDone(dueCount) {
  const profile = await DB.getProfile();
  const today = DB.dateKey();
  const events = [];
  let bonus = 0;

  if (profile.lastStreakDate === today) return { bonus, events, profile }; // 加算済み

  // コンプリートボーナス:+2個
  bonus = 2;
  profile.totalAcorns += bonus;

  // ストリーク:昨日(またはスキップ日を挟んで)続いていれば+1、途切れていれば1から
  const cont = await streakContinues(profile.lastStreakDate, today);
  profile.currentStreak = cont ? profile.currentStreak + 1 : 1;
  profile.longestStreak = Math.max(profile.longestStreak, profile.currentStreak);
  profile.lastStreakDate = today;

  const prevLevel = levelForAcorns(profile.totalAcorns - bonus).lv;
  await DB.saveProfile(profile);

  events.push({ type: 'alldone', bonus, streak: profile.currentStreak, dueCount });

  const rAll = await unlock('rare_all');
  if (rAll) events.push({ type: 'rare', badge: rAll });

  // ストリーク系:バッジ+レアどんぐり(6.1「特別などんぐり」)
  const marks = [[7, 'streak_7', 'rare_7'], [30, 'streak_30', 'rare_30'], [100, 'streak_100', 'rare_100']];
  for (const [n, bk, rk] of marks) {
    if (profile.currentStreak >= n) {
      const b = await unlock(bk); if (b) events.push({ type: 'badge', badge: b });
      const r = await unlock(rk); if (r) { events.push({ type: 'rare', badge: r }); profile.totalAcorns += 3; }
    }
  }

  const newLevel = levelForAcorns(profile.totalAcorns);
  if (newLevel.lv > prevLevel) {
    profile.squirrelLevel = newLevel.lv;
    events.push({ type: 'levelup', level: newLevel });
  }
  await DB.saveProfile(profile);
  return { bonus, events, profile };
}

/** 目標達成時 */
export async function onGoalAchieved() {
  const events = [];
  const b = await unlock('goal_first');
  if (b) events.push({ type: 'badge', badge: b });
  const profile = await DB.getProfile();
  profile.totalAcorns += 5; // 目標達成ボーナス
  const prevLevel = levelForAcorns(profile.totalAcorns - 5).lv;
  const newLevel = levelForAcorns(profile.totalAcorns);
  if (newLevel.lv > prevLevel) { profile.squirrelLevel = newLevel.lv; events.push({ type: 'levelup', level: newLevel }); }
  await DB.saveProfile(profile);
  return { events, profile };
}

/**
 * ストリークが継続しているか:間の日がすべて「実施すべきタスクが無い日(スキップ)」なら継続。
 */
async function streakContinues(lastKey, todayKey) {
  if (!lastKey) return false;
  const gap = daysBetween(lastKey, todayKey);
  if (gap <= 0) return false;
  if (gap === 1) return true;
  const tasks = await DB.getTasks({ includeArchived: true });
  const d = parseKey(lastKey);
  for (let i = 1; i < gap; i++) {
    d.setDate(d.getDate() + 1);
    const due = tasks.some(t => !t.isArchived && isDueToday(t, d));
    if (due) return false; // 対象タスクがあったのに未達成 → 途切れ
  }
  return true; // すべてスキップ日
}

/** 起動時整合:未達成のまま日付が変わっていたらストリークを0に(6.4) */
export async function reconcileStreak() {
  const profile = await DB.getProfile();
  if (!profile.lastStreakDate) return profile;
  const today = DB.dateKey();
  if (profile.lastStreakDate === today) return profile;
  const cont = await streakContinues(profile.lastStreakDate, today);
  if (!cont) {
    // きのうまでの分が途切れた(最長記録は保持)
    if (profile.currentStreak !== 0) {
      profile.currentStreak = 0;
      await DB.saveProfile(profile);
    }
  }
  return profile;
}

export function daysBetween(k1, k2) {
  return Math.round((parseKey(k2) - parseKey(k1)) / 86400000);
}
export function parseKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
