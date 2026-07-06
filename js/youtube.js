// ============================================================
// youtube.js — YouTube IFrame Player APIの薄いラッパー
//   ・ENDED、または視聴率80%以上への到達をアンロック条件として検知
//   ・タブが非表示のあいだはポーリングを止めてバッテリーを節約
//   ・IndexedDBと違い端末外(YouTube)と通信する唯一の箇所
// ============================================================

const UNLOCK_RATIO = 0.8;
const POLL_MS = 1000;

let apiPromise = null;

/** iframe_api を一度だけ注入し、準備できたら window.YT を返す */
export function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevReady?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return apiPromise;
}

/**
 * プレイヤーを生成する。視聴進捗・アンロック・再生エラーをコールバックで通知する。
 * @param {string} elId - プレイヤーに置き換えられる要素のid(呼び出し側が毎回新しく用意すること)
 * @param {string} videoId
 * @param {{initialRatio?:number, onProgress?:Function, onUnlock?:Function, onError?:Function}} opts
 *   initialRatio: リロード後の再開用に、これまでの最大視聴率(0..1)を渡すと引き継がれる(再生位置のシークはしない)
 *   onProgress(ratio) は0..1で継続的に呼ばれる。onUnlock(reason:'ended'|'threshold', ratio) は一度だけ呼ばれる
 * @returns {Promise<{destroy:Function}>} 破棄用ハンドル
 */
export async function createPlayer(elId, videoId, opts = {}) {
  const { initialRatio = 0, onProgress, onUnlock, onError } = opts;
  const YT = await loadYouTubeAPI();
  let furthestRatio = initialRatio;
  let unlocked = initialRatio >= UNLOCK_RATIO;
  let pollTimer = null;
  let player = null;

  function stopPoll() {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      if (!player || typeof player.getDuration !== 'function') return;
      const dur = player.getDuration();
      if (!dur) return;
      const ratio = Math.min(1, player.getCurrentTime() / dur);
      if (ratio > furthestRatio) furthestRatio = ratio;
      onProgress?.(furthestRatio);
      if (!unlocked && furthestRatio >= UNLOCK_RATIO) {
        unlocked = true;
        onUnlock?.('threshold', furthestRatio);
      }
    }, POLL_MS);
  }
  function onVisibility() {
    if (document.hidden) {
      stopPoll();
    } else if (player?.getPlayerState?.() === YT.PlayerState.PLAYING) {
      startPoll();
    }
  }
  document.addEventListener('visibilitychange', onVisibility);

  player = new YT.Player(elId, {
    videoId,
    playerVars: { rel: 0, playsinline: 1 },
    events: {
      onStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) {
          startPoll();
        } else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.BUFFERING) {
          stopPoll();
        } else if (e.data === YT.PlayerState.ENDED) {
          stopPoll();
          furthestRatio = 1;
          onProgress?.(1);
          if (!unlocked) { unlocked = true; onUnlock?.('ended', 1); }
        }
      },
      onError(e) { onError?.(e.data); },
    },
  });

  return {
    destroy() {
      stopPoll();
      document.removeEventListener('visibilitychange', onVisibility);
      try { player?.destroy(); } catch { /* 破棄済みは無視 */ }
      player = null;
    },
  };
}
