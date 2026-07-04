// ============================================================
// collection.js — コレクション画面(仕様書4.6)
// ============================================================
import * as DB from './db.js';
import * as Game from './game.js';
import { $, esc } from './ui.js';

export async function render() {
  const profile = await DB.getProfile();
  const unlocked = await Game.getUnlocked();

  // レベルカード
  const cur = Game.levelForAcorns(profile.totalAcorns);
  const next = Game.nextLevel(cur.lv);
  $('#col-level-icon').textContent = cur.icon;
  $('#col-level-name').textContent = `Lv.${cur.lv} ${cur.name}(${esc(profile.squirrelName)})`;
  if (next) {
    const span = next.need - cur.need;
    const got = profile.totalAcorns - cur.need;
    $('#col-level-next').textContent = `次のレベルまで あと ${next.need - profile.totalAcorns} 個 🌰`;
    $('#col-level-fill').style.width = `${Math.min(100, Math.round(got / span * 100))}%`;
  } else {
    $('#col-level-next').textContent = '最終形態です!いつもありがとう🌰';
    $('#col-level-fill').style.width = '100%';
  }
  $('#col-level-steps').innerHTML = Game.LEVELS.map(l =>
    `<span>${l.need}</span>`).join('');

  // バッジ
  $('#badge-grid').innerHTML = Game.BADGES.map(b => badgeCard(b, unlocked[b.key])).join('');
  // レアどんぐり
  $('#rare-grid').innerHTML = Game.RARE_ACORNS.map(b => badgeCard(b, unlocked[b.key])).join('');
}

function badgeCard(def, row) {
  const got = !!row;
  const date = got ? new Date(row.unlockedAt) : null;
  return `
    <div class="badge ${got ? '' : 'locked'}">
      <div class="badge-icon">${got ? def.icon : '❓'}</div>
      <div class="badge-name">${got ? esc(def.title) : '???'}</div>
      <div class="badge-cond">${esc(def.cond)}</div>
      ${got ? `<div class="badge-date">${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} 獲得</div>` : ''}
    </div>`;
}
