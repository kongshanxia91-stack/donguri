// ============================================================
// minigame.js — どんぐりラン(Temple Run風の3レーン・エンドレスランナー)
//   ・自宅の3Dリス(squirrel.jsと共通モデル)を操作して森を走る
//   ・スワイプ/矢印キーで レーン変更・ジャンプ・スライディング
//   ・木の丸太(ジャンプ)・低い枝(スライディング)・岩(レーン変更)を回避
//   ・どんぐりを集めてスコアアップ、コンボで倍率アップ
//   ・✨金のどんぐり=ラッキータイム(スコア倍)/💠シールド=1回だけ衝突を無効化
//   ・カウントダウンスタート・一時停止・効果音つき
//   ・ハイスコアは端末内にのみ保存。本編のどんぐり総数・レベル・実績には一切影響しない
// ============================================================
import * as THREE from '../vendor/three.module.js';
import { buildSquirrelModel, makeAcorn } from './squirrel.js';
import { $ } from './ui.js';
import * as Sound from './sound.js';

const LANES = [-1.4, 0, 1.4];
const BEST_KEY = 'donguri-run-best';
const MISSION_KEY = 'donguri-run-missions';
const HISTORY_KEY = 'donguri-run-history';
const ROW_GAP = 7;          // 障害物・どんぐりの行の間隔(ワールド距離)
const SPAWN_Z = -60;        // 生成位置(奥)
const DESPAWN_Z = 6;        // これを超えたら消す(手前)
const COMBO_STEP = 5;       // これだけ連続で取ると倍率アップ
const ROLLER_SPEED = 3.2;   // 転がる丸太がこちらへ迫ってくる追加速度
const PLAYER_SCALE = 0.72;  // 前方の視界を確保するためホーム画面より小さめに表示

// きょうのミッション(端末内のみ・毎日3つ抽選。本編のどんぐりには影響しない)
const MISSION_POOL = [
  { id: 'acorn30', icon: '🌰', text: '1回のランでどんぐりを30個あつめる', check: s => s.acornsGot >= 30 },
  { id: 'dist500', icon: '🏃', text: '1回のランで500m走る', check: s => s.distance >= 500 },
  { id: 'combo10', icon: '🔥', text: 'どんぐりコンボを10連続', check: s => s.maxCombo >= 10 },
  { id: 'jump15', icon: '🐇', text: '1回のランでジャンプを15回', check: s => s.jumps >= 15 },
  { id: 'near5', icon: '😎', text: 'ナイス回避を5回きめる', check: s => s.nearMisses >= 5 },
  { id: 'smash3', icon: '⭐', text: 'ダッシュで障害物を3個こわす', check: s => s.smashed >= 3 },
  { id: 'golden3', icon: '✨', text: '金のどんぐりを3個とる', check: s => s.goldenGot >= 3 },
];

// 距離に応じて移り変わる風景テーマ(昼の森→夕方の紅葉→夜の森)
const THEMES = [
  { sky: 0xaed9e8, ground: 0x8fae6b, leaf: 0x5f8a4a, trunk: 0x6e4a2f, sun: 1.3, hemi: 1.0 },
  { sky: 0xf0b27a, ground: 0xb99a5e, leaf: 0xd88c3c, trunk: 0x7a5236, sun: 1.1, hemi: 0.85 },
  { sky: 0x2a3555, ground: 0x55684f, leaf: 0x3a5a44, trunk: 0x4a3a2c, sun: 0.65, hemi: 0.55 },
];
const THEME_SPAN = 400;     // この距離ごとに次のテーマへ

export class MiniGame {
  constructor(root) {
    this.root = root;
    this.canvas = $('#game-canvas', root);
    this.hudScore = $('#game-score', root);
    this.hudBest = $('#game-best', root);
    this.startPanel = $('#game-start', root);
    this.overPanel = $('#game-over', root);
    this.overScore = $('#game-over-score', root);
    this.overCombo = $('#game-over-combo', root);
    this.overBest = $('#game-over-best', root);
    this.pausePanel = $('#game-pause-panel', root);
    this.comboEl = $('#game-combo', root);
    this.countdownEl = $('#game-countdown', root);
    this.powerEl = $('#game-power', root);
    this.missionsEl = $('#game-missions', root);
    this.overMissionsEl = $('#game-over-missions', root);
    this.historyEl = $('#game-history', root);
    this.rankEl = $('#game-rank', root);

    this.best = Number(localStorage.getItem(BEST_KEY) || 0);
    this.missions = this._loadMissions();
    this.state = 'ready'; // ready | countdown | playing | paused | over
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);

    this._buildWorld();
    this._buildPlayer();
    this._resetRun();

    this._bindControls();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(root);
    this._resize();

    this.clock = new THREE.Clock();
    this._raf = null;
    this._countdownTimer = null;
  }

  // ---------- 表示・非表示 ----------
  open() {
    this.root.classList.remove('hidden');
    this._resize();
    this._resetRun();
    this._showStart();
    this.clock.getDelta(); // 経過リセット
    if (!this._raf) this._loop();
  }
  close() {
    this.root.classList.add('hidden');
    clearTimeout(this._countdownTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    Sound.stopBgm();
  }

  _showStart() {
    this.state = 'ready';
    this.overPanel.classList.add('hidden');
    this.pausePanel.classList.add('hidden');
    this.countdownEl.classList.add('hidden');
    this.powerEl.classList.add('hidden');
    this.startPanel.classList.remove('hidden');
    this.hudBest.textContent = this.best ? `ベスト 🌰${this.best}` : '';
    for (const m of this.missions.list) m.justDone = false;
    this._renderMissions(this.missionsEl);
  }

  // ---------- きょうのミッション ----------
  _loadMissions() {
    const today = new Date().toISOString().slice(0, 10);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(MISSION_KEY)); } catch { /* 壊れていたら作り直す */ }
    if (!saved || saved.date !== today || !Array.isArray(saved.ids)) {
      const pool = [...MISSION_POOL];
      const ids = [];
      while (ids.length < 3 && pool.length) {
        ids.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
      }
      saved = { date: today, ids, done: {} };
      localStorage.setItem(MISSION_KEY, JSON.stringify(saved));
    }
    return {
      date: saved.date,
      list: saved.ids.map(id => MISSION_POOL.find(m => m.id === id)).filter(Boolean),
      done: saved.done || {},
    };
  }

  _saveMissions() {
    localStorage.setItem(MISSION_KEY, JSON.stringify({
      date: this.missions.date,
      ids: this.missions.list.map(m => m.id),
      done: this.missions.done,
    }));
  }

  _renderMissions(el) {
    el.innerHTML = '<div class="hint" style="text-align:left;margin:0 0 2px">きょうのミッション</div>' +
      this.missions.list.map(m => {
        const done = !!this.missions.done[m.id];
        return `<div class="mission-item${done ? ' done' : ''}${m.justDone ? ' just-done' : ''}">` +
          `<span class="mission-mark">${done ? '🏅' : m.icon}</span>` +
          `<span>${m.text}${m.justDone ? ' — 達成!' : ''}</span></div>`;
      }).join('');
  }

  // ---------- ワールド構築(地面・レーン・木・空) ----------
  _buildWorld() {
    // 空の色はテーマ変化でなめらかに移り変わるので、背景と霧で同じColorを共有する
    this.skyColor = new THREE.Color(THEMES[0].sky);
    this.scene.background = this.skyColor;
    this.scene.fog = new THREE.Fog(THEMES[0].sky, 20, 55);
    this.scene.fog.color = this.skyColor;
    this._tmpColor = new THREE.Color();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7a6a50, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sun.position.set(4, 8, 6);
    this.scene.add(this.sun);

    this.groundMat = new THREE.MeshToonMaterial({ color: THEMES[0].ground });
    const ground = new THREE.Mesh(
      // コースが左右にカーブしても地面からはみ出さないよう幅広めに
      new THREE.PlaneGeometry(34, 400),
      this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -150);
    this.scene.add(ground);

    // 雲(ゆっくり流れて奥行き感を出す)
    this.clouds = [];
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 4; i++) {
      const cloud = new THREE.Group();
      for (let p = 0; p < 3; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.8 + Math.random() * 0.5, 10, 8), cloudMat);
        puff.position.set(p * 1.1 - 1.1, Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
        puff.scale.y = 0.55;
        cloud.add(puff);
      }
      cloud.position.set((Math.random() - 0.5) * 24, 7 + Math.random() * 3, -30 - i * 14);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }

    // レーンの境界ライン(飾り)
    this.laneMarks = [];
    for (let i = 0; i < 14; i++) {
      const mark = new THREE.Group();
      for (const lx of [-0.7, 0.7]) {
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.02, 1.1),
          new THREE.MeshBasicMaterial({ color: 0xFFF8E8 }));
        bar.position.set(lx, 0.011, 0);
        mark.add(bar);
      }
      mark.position.z = SPAWN_Z + i * (-SPAWN_Z * 2 / 14);
      mark.userData = { pathPos: -mark.position.z };
      this.scene.add(mark);
      this.laneMarks.push(mark);
    }

    // 両脇の木(奥行き感・スピード感)— 葉と幹はテーマ変化で色が変わるので共有マテリアル
    this.treeLeafMat = new THREE.MeshToonMaterial({ color: THEMES[0].leaf });
    this.treeTrunkMat = new THREE.MeshToonMaterial({ color: THEMES[0].trunk });
    this.sideTrees = [];
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.32, 2.0, 7),
        this.treeTrunkMat);
      trunk.position.y = 1.0;
      tree.add(trunk);
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.9, 0),
        this.treeLeafMat);
      leaf.position.y = 2.2;
      tree.add(leaf);
      const baseX = side * (4.2 + Math.random() * 1.3);
      tree.position.set(baseX, 0, -i * 8);
      tree.userData = { side, baseX, pathPos: i * 8 };
      this.scene.add(tree);
      this.sideTrees.push(tree);
    }

    this.obstacles = [];
    this.acorns = [];
    this.obstacleGroup = new THREE.Group();
    this.acornGroup = new THREE.Group();
    this.scene.add(this.obstacleGroup, this.acornGroup);

    // パーティクル(回収キラキラ・走りの土ぼこり・スマッシュ破片)用の共有リソース
    this.fx = [];
    this.fxGroup = new THREE.Group();
    this.scene.add(this.fxGroup);
    this._fxGeo = new THREE.SphereGeometry(1, 6, 5);
    this._fxMats = new Map();
  }

  _fxMat(color) {
    if (!this._fxMats.has(color)) {
      this._fxMats.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
    }
    return this._fxMats.get(color);
  }

  /** 小さな粒がはじけるエフェクト */
  _burst(pos, color, n = 6, speed = 2.2) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this._fxGeo, this._fxMat(color));
      m.position.copy(pos);
      m.scale.setScalar(0.05 + Math.random() * 0.05);
      const a = Math.random() * Math.PI * 2;
      this.fx.push({
        mesh: m, life: 0.45 + Math.random() * 0.25,
        vx: Math.cos(a) * speed * (0.4 + Math.random() * 0.6),
        vy: 1.2 + Math.random() * speed,
        vz: Math.sin(a) * speed * (0.4 + Math.random() * 0.6),
      });
      this.fxGroup.add(m);
    }
  }

  // ---------- プレイヤー(squirrel.jsと共通モデル) ----------
  _buildPlayer() {
    const parts = buildSquirrelModel(THREE);
    this.player = parts;
    parts.group.scale.setScalar(PLAYER_SCALE);
    parts.group.rotation.y = Math.PI; // 奥(-z)を向く=カメラにはうしろ姿が見える
    // ホーム画面用のもふもふしっぽは高く前に張り出しすぎて前方の障害物を隠してしまうため、
    // ミニゲーム内でだけ低く・コンパクトに(ホーム画面の見た目には影響しない)
    parts.tail.scale.set(0.66, 0.44, 0.66);
    this.scene.add(parts.group);

    // シールド中に出る、ふわっと光るバブル
    const shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fe0f5, transparent: true, opacity: 0.28, depthWrite: false }));
    shieldMesh.position.y = 0.75;
    shieldMesh.visible = false;
    parts.group.add(shieldMesh);
    this.shieldMesh = shieldMesh;

    // ⭐ダッシュ中の金色オーラ
    const dashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd24c, transparent: true, opacity: 0.22, depthWrite: false }));
    dashMesh.position.y = 0.75;
    dashMesh.visible = false;
    parts.group.add(dashMesh);
    this.dashMesh = dashMesh;
  }

  // ---------- 状態リセット ----------
  _resetRun() {
    this.lane = 1;
    this.laneX = LANES[1];
    this.y = 0;
    this.vy = 0;
    this.jumping = false;
    this.sliding = false;
    this.slideT = 0;
    this.dead = false;
    this.tumbleT = 0;
    this.distance = 0;
    this.score = 0;
    this.acornScore = 0;
    this.acornsGot = 0;
    this.speed = 6.5;
    this.spawnAcc = ROW_GAP; // すぐ最初の行を出す

    this.rowStreak = 0;
    this.comboMult = 1;
    this.maxCombo = 0;
    this.shield = false;
    this.luckyT = 0;
    this.magnetT = 0;
    this.dashT = 0;
    this.nextMilestone = 100;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.dustAcc = 0;

    // ミッション用の1ラン統計
    this.jumps = 0;
    this.nearMisses = 0;
    this.smashed = 0;
    this.goldenGot = 0;

    // 風景はいつも昼の森からスタート
    this.skyColor.set(THEMES[0].sky);
    this.groundMat.color.set(THEMES[0].ground);
    this.treeLeafMat.color.set(THEMES[0].leaf);
    this.treeTrunkMat.color.set(THEMES[0].trunk);
    this.sun.intensity = THEMES[0].sun;
    this.hemi.intensity = THEMES[0].hemi;

    for (const f of this.fx) this.fxGroup.remove(f.mesh);
    this.fx = [];

    // コースの左右カーブ(distance=0 基準で作り直し、木・レーンラインの位置とも同期させる)
    this.curvePoints = [{ p: 0, x: 0 }];
    this._extendCurve(150);
    for (const t of this.sideTrees) t.userData.pathPos = -t.position.z;
    for (const m of this.laneMarks) m.userData.pathPos = -m.position.z;

    for (const o of this.obstacles) this.obstacleGroup.remove(o.mesh);
    for (const a of this.acorns) this.acornGroup.remove(a.mesh);
    this.obstacles = [];
    this.acorns = [];

    const g = this.player.group;
    g.position.set(this.laneX, 0, 0);
    g.rotation.z = 0; g.rotation.x = 0;
    this.shieldMesh.visible = false;
    this.dashMesh.visible = false;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this._updateHud();
  }

  start() {
    Sound.unlockAudio();
    this._resetRun();
    this.startPanel.classList.add('hidden');
    this.overPanel.classList.add('hidden');
    this._runCountdown();
  }

  _runCountdown() {
    this.state = 'countdown';
    clearTimeout(this._countdownTimer);
    const el = this.countdownEl;
    el.classList.remove('hidden');
    let n = 3;
    el.textContent = String(n);
    Sound.sfxCountdownTick();
    const step = () => {
      n--;
      if (n > 0) {
        el.textContent = String(n);
        Sound.sfxCountdownTick();
        this._countdownTimer = setTimeout(step, 550);
      } else {
        el.textContent = 'スタート!';
        Sound.sfxCountdownGo();
        Sound.startBgm();
        this._countdownTimer = setTimeout(() => {
          el.classList.add('hidden');
          this.state = 'playing';
        }, 450);
      }
    };
    this._countdownTimer = setTimeout(step, 550);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausePanel.classList.remove('hidden');
    Sound.stopBgm();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.pausePanel.classList.add('hidden');
    this.clock.getDelta(); // 一時停止中の経過を捨てる
    this.state = 'playing';
    Sound.startBgm();
  }

  _gameOver() {
    this.state = 'over';
    this.dead = true;
    this.tumbleT = 0;
    Sound.sfxGameOver();
    Sound.stopBgm();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.overScore.textContent = `🌰 ${this.score}(どんぐり ${this.acornsGot}個)`;
    this.overCombo.textContent = this.maxCombo >= COMBO_STEP ? `最大コンボ ${this.maxCombo}連続🌰` : '';
    this.overBest.textContent = `ベストスコア 🌰 ${this.best}`;
    this.powerEl.classList.add('hidden');

    // ランク評価
    const rank = this._rankFor(this.score);
    this.rankEl.className = `game-rank rank-${rank}`;
    this.rankEl.innerHTML = `<span class="rank-letter">${rank}</span> ランク`;

    // ハイスコア履歴(上位5件・端末内のみ)
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { /* 壊れていたら空から */ }
    hist.forEach(h => { delete h.now; });
    const d = new Date();
    hist.push({ s: this.score, d: `${d.getMonth() + 1}/${d.getDate()}`, now: true });
    hist.sort((a, b) => b.s - a.s);
    hist = hist.slice(0, 5);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.map(({ s, d: dd }) => ({ s, d: dd }))));
    this.historyEl.innerHTML = 'きろく' +
      `<ol>${hist.map((h, i) =>
        `<li class="${h.now ? 'current-run' : ''}"><span>${i + 1}. 🌰 ${h.s}</span><span>${h.d}</span></li>`).join('')}</ol>`;

    // ミッション判定
    const stats = {
      acornsGot: this.acornsGot, distance: this.distance, maxCombo: this.maxCombo,
      jumps: this.jumps, nearMisses: this.nearMisses, smashed: this.smashed, goldenGot: this.goldenGot,
    };
    let clearedAny = false;
    for (const m of this.missions.list) {
      m.justDone = false;
      if (!this.missions.done[m.id] && m.check(stats)) {
        this.missions.done[m.id] = true;
        m.justDone = true;
        clearedAny = true;
      }
    }
    if (clearedAny) {
      this._saveMissions();
      setTimeout(() => Sound.sfxMissionDone(), 700);
    }
    this._renderMissions(this.overMissionsEl);

    setTimeout(() => this.overPanel.classList.remove('hidden'), 550);
  }

  _rankFor(score) {
    if (score >= 2200) return 'SS';
    if (score >= 1200) return 'S';
    if (score >= 700) return 'A';
    if (score >= 300) return 'B';
    return 'C';
  }

  // ---------- 操作 ----------
  _bindControls() {
    let sx = 0, sy = 0, tracking = false;
    const startAt = (x, y) => { sx = x; sy = y; tracking = true; };
    const endAt = (x, y) => {
      if (!tracking) return;
      tracking = false;
      const dx = x - sx, dy = y - sy;
      this._handleGesture(dx, dy);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.state === 'ready') { this.start(); return; }
      startAt(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerup', (e) => endAt(e.clientX, e.clientY));
    this.canvas.addEventListener('pointercancel', () => { tracking = false; });

    this._keyHandler = (e) => {
      if (this.root.classList.contains('hidden')) return;
      if (this.state === 'ready' && (e.key === ' ' || e.key === 'Enter')) { this.start(); return; }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'playing') return;
      if (e.key === 'ArrowLeft') this._changeLane(-1);
      else if (e.key === 'ArrowRight') this._changeLane(1);
      else if (e.key === 'ArrowUp' || e.key === ' ') this._doJump();
      else if (e.key === 'ArrowDown') this._doSlide();
    };
    addEventListener('keydown', this._keyHandler);
  }

  _handleGesture(dx, dy) {
    if (this.state !== 'playing') return;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < 24 && ady < 24) return; // タップは無視(スワイプのみ)
    if (adx > ady) {
      this._changeLane(dx > 0 ? 1 : -1);
    } else if (dy < 0) {
      this._doJump();
    } else {
      this._doSlide();
    }
  }

  _changeLane(dir) {
    const prevLane = this.lane;
    this.lane = Math.min(2, Math.max(0, this.lane + dir));
    this.laneX = LANES[this.lane];
    if (this.lane !== prevLane) Sound.sfxLaneChange();
  }
  _doJump() {
    if (this.jumping || this.sliding) return;
    this.jumping = true;
    this.vy = 5.4;
    this.jumps++;
    Sound.sfxJump();
  }
  _doSlide() {
    if (this.sliding || this.jumping) return;
    this.sliding = true;
    this.slideT = 0;
    Sound.sfxSlide();
  }

  // ---------- コンボ・アイテム演出 ----------
  _popup(text, color = '#fff2c8') {
    const el = this.comboEl;
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('pop');
    void el.offsetWidth; // reflow でアニメを再始動
    el.classList.add('pop');
  }

  _shake(mag) {
    this.shakeT = 0.3;
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  _collectAcorn(a) {
    if (a.special === 'golden') {
      this.acornsGot++;
      this.goldenGot++;
      this.acornScore += 25;
      this.luckyT = 3;
      Sound.sfxGolden();
      this._popup('✨ラッキータイム!', '#ffcf4d');
      this._burst(a.mesh.position, 0xffd24c, 8);
    } else if (a.special === 'shield') {
      this.shield = true;
      this.shieldMesh.visible = true;
      Sound.sfxShieldGet();
      this._popup('💠シールド獲得!', '#7fe0f5');
      this._burst(a.mesh.position, 0x7fe0f5, 8);
    } else if (a.special === 'magnet') {
      this.magnetT = 6;
      Sound.sfxMagnet();
      this._popup('🧲マグネット!', '#f0907a');
      this._burst(a.mesh.position, 0xd05a4a, 8);
    } else if (a.special === 'star') {
      this.dashT = 2.6;
      Sound.sfxDash();
      this._popup('⭐ダッシュ!', '#ffd24c');
      this._burst(a.mesh.position, 0xffe27a, 10, 3);
    } else {
      this.acornsGot++;
      this.rowStreak++;
      this.maxCombo = Math.max(this.maxCombo, this.rowStreak);
      this.comboMult = 1 + Math.min(4, Math.floor(this.rowStreak / COMBO_STEP)) * 0.5;
      const gain = Math.round(5 * this.comboMult * (this.luckyT > 0 ? 2 : 1));
      this.acornScore += gain;
      Sound.sfxCollect(this.rowStreak);
      this._burst(a.mesh.position, this.luckyT > 0 ? 0xffd24c : 0xfff2c8, 4, 1.6);
      if (this.rowStreak > 0 && this.rowStreak % COMBO_STEP === 0) {
        this._popup(`コンボ x${this.comboMult}!`, '#fff2c8');
      }
    }
  }

  _missAcorn() {
    if (this.rowStreak >= COMBO_STEP) this._popup('コンボとぎれた…', '#ffffff');
    this.rowStreak = 0;
    this.comboMult = 1;
  }

  // ---------- コースのカーブ(テンプルラン風に道が左右にうねる) ----------
  // 「pathPos」は各オブジェクトが表すコース上の絶対位置(生成時の distance - z で固定)。
  // curvePoints はその位置ごとの中心線の左右オフセットで、手前(プレイヤー位置)からの
  // 相対値だけを描画に使うので、当たり判定(レーン番号・z距離)には一切影響しない。
  _extendCurve(targetP) {
    let last = this.curvePoints[this.curvePoints.length - 1];
    while (last.p < targetP) {
      const straight = Math.random() < 0.4;
      const segLen = straight ? (22 + Math.random() * 14) : (30 + Math.random() * 20);
      let dx = 0;
      if (!straight) {
        dx = 3 + Math.random() * 2.5;
        if (Math.random() < 0.5) dx = -dx;
        const nextX = last.x + dx;
        if (nextX > 7) dx = -Math.abs(dx);
        else if (nextX < -7) dx = Math.abs(dx);
      }
      last = { p: last.p + segLen, x: last.x + dx };
      this.curvePoints.push(last);
    }
  }

  _curveSegAt(p) {
    const pts = this.curvePoints;
    for (let i = pts.length - 2; i >= 0; i--) {
      if (p >= pts[i].p) return i;
    }
    return 0;
  }

  _curveX(p) {
    const pts = this.curvePoints;
    const i = this._curveSegAt(p);
    const a = pts[i], b = pts[i + 1] || a;
    if (b === a) return a.x;
    const t = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p)));
    const s = t * t * (3 - 2 * t); // smoothstep
    return a.x + (b.x - a.x) * s;
  }

  _curveHeading(p) {
    const pts = this.curvePoints;
    const i = this._curveSegAt(p);
    const a = pts[i], b = pts[i + 1] || a;
    if (b === a) return 0;
    const segLen = b.p - a.p;
    const t = Math.min(1, Math.max(0, (p - a.p) / segLen));
    const slope = (b.x - a.x) * (6 * t * (1 - t)) / segLen;
    return Math.atan(slope);
  }

  // ---------- 障害物・どんぐりの生成 ----------
  _spawnRow(z) {
    // 距離に応じた難易度ティア(障害物の種類・同時封鎖・中間行が段階的に増える)
    const d = this.distance;
    const tier = d < 150 ? 0 : d < 400 ? 1 : d < 800 ? 2 : 3;
    const kinds = ['log', 'branch', 'rock'];
    if (tier >= 1) kinds.push('roller');

    // 封鎖レーン(ティアが上がると2レーン同時封鎖の行が混ざる。3レーン封鎖はしない)
    const lanes = [0, 1, 2];
    const doubleP = [0, 0.18, 0.32, 0.45][tier];
    const rowKinds = {};
    const first = lanes[Math.floor(Math.random() * 3)];
    rowKinds[first] = kinds[Math.floor(Math.random() * kinds.length)];
    if (Math.random() < doubleP) {
      const rest = lanes.filter(l => l !== first);
      const second = rest[Math.floor(Math.random() * rest.length)];
      rowKinds[second] = kinds[Math.floor(Math.random() * kinds.length)];
    }
    for (const [lane, kind] of Object.entries(rowKinds)) this._spawnObstacle(Number(lane), z, kind);

    // ティア2以降は行間にも単発の障害物が混ざり、休みが減っていく
    if (tier >= 2 && Math.random() < 0.3) {
      const midLane = lanes[Math.floor(Math.random() * 3)];
      this._spawnObstacle(midLane, z - ROW_GAP / 2, kinds[Math.floor(Math.random() * kinds.length)]);
    }

    const openLanes = lanes.filter(lane => rowKinds[lane] !== 'rock' && rowKinds[lane] !== 'roller');

    // まれに特別アイテム(✨ラッキー/💠シールド/🧲マグネット/⭐ダッシュ)を1つ混ぜる
    let specialKind = null;
    if (d > 40) {
      const r = Math.random();
      if (r < 0.03 && !this.shield) specialKind = 'shield';
      else if (r < 0.055) specialKind = 'magnet';
      else if (r < 0.08) specialKind = 'star';
      else if (r < 0.15) specialKind = 'golden';
    }
    const specialLane = specialKind && openLanes.length ? openLanes[Math.floor(Math.random() * openLanes.length)] : -1;

    for (const lane of openLanes) {
      if (lane === specialLane || Math.random() < 0.7) {
        for (let i = 0; i < 3; i++) {
          const special = (lane === specialLane && i === 1) ? specialKind : null;
          this._spawnAcorn(lane, z - i * 1.1, special);
        }
      }
    }
  }

  _spawnObstacle(lane, z, kind) {
    let mesh;
    if (kind === 'log') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.28, 1.5, 10),
        new THREE.MeshToonMaterial({ color: 0x8a5a34 }));
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 0.28;
    } else if (kind === 'branch') {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.5, 8),
        new THREE.MeshToonMaterial({ color: 0x6e4a2f }));
      mesh.rotation.z = Math.PI / 2;
      mesh.position.y = 1.15;
    } else if (kind === 'roller') {
      // roller: こちらへ転がってくる丸太。ジャンプで回避(タイミングが普通の丸太よりシビア)
      mesh = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 1.5, 10),
        new THREE.MeshToonMaterial({ color: 0xa5713f }));
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      mesh.add(body);
      // 転がりが目に見えるように表面へこぶを付ける
      const bumpMat = new THREE.MeshToonMaterial({ color: 0x6e4a2f });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const bump = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), bumpMat);
        bump.position.set((i % 2 === 0 ? -0.4 : 0.4), Math.cos(a) * 0.3, Math.sin(a) * 0.3);
        mesh.add(bump);
      }
      mesh.position.y = 0.3;
    } else {
      // rock: レーン変更でのみ回避可能(ジャンプ・スライディングでは避けられない)
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.48, 0),
        new THREE.MeshToonMaterial({ color: 0x9a9186 }));
      mesh.position.y = 0.42;
    }
    mesh.castShadow = true;
    mesh.position.x = LANES[lane];
    mesh.position.z = z;
    this.obstacleGroup.add(mesh);
    this.obstacles.push({ mesh, lane, kind, pathPos: this.distance - z });
  }

  _spawnAcorn(lane, z, special = null) {
    let mesh;
    if (special === 'golden') {
      mesh = makeAcorn(0.2);
      mesh.traverse(o => { if (o.material) o.material.color.set(0xFFD24C); });
    } else if (special === 'shield') {
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22, 0),
        new THREE.MeshToonMaterial({ color: 0x6fd0e8 }));
      mesh.castShadow = true;
    } else if (special === 'magnet') {
      // 🧲 U字マグネット
      mesh = new THREE.Group();
      const u = new THREE.Mesh(
        new THREE.TorusGeometry(0.15, 0.055, 8, 14, Math.PI),
        new THREE.MeshToonMaterial({ color: 0xd05a4a }));
      mesh.add(u);
      const tipMat = new THREE.MeshToonMaterial({ color: 0xe8e4dc });
      for (const s of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.11), tipMat);
        tip.position.set(0.15 * s, -0.05, 0);
        mesh.add(tip);
      }
    } else if (special === 'star') {
      // ⭐ ダッシュ星(中心+放射状のとげ)
      mesh = new THREE.Group();
      const starMat = new THREE.MeshToonMaterial({ color: 0xffd24c });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), starMat);
      mesh.add(core);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), starMat);
        spike.position.set(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0);
        spike.rotation.z = a - Math.PI / 2;
        mesh.add(spike);
      }
    } else {
      mesh = makeAcorn(0.16);
    }
    mesh.position.set(LANES[lane], special ? 0.56 : 0.5, z);
    this.acornGroup.add(mesh);
    this.acorns.push({ mesh, lane, got: false, special, pathPos: this.distance - z });
  }

  // ---------- ループ ----------
  _resize() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _updateHud() {
    this.hudScore.textContent = `🌰 ${this.score}`;
    // パワーアップの残り秒数
    const bits = [];
    if (this.luckyT > 0) bits.push(`✨${Math.ceil(this.luckyT)}`);
    if (this.magnetT > 0) bits.push(`🧲${Math.ceil(this.magnetT)}`);
    if (this.dashT > 0) bits.push(`⭐${Math.ceil(this.dashT)}`);
    if (bits.length) {
      this.powerEl.innerHTML = bits.map(b => `<span>${b}</span>`).join('');
      this.powerEl.classList.remove('hidden');
    } else {
      this.powerEl.classList.add('hidden');
    }
  }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'playing') this._tickPlaying(dt);
    else if (this.state === 'over') this._tickGameOver(dt);
    this._tickAmbient(dt);

    this.renderer.render(this.scene, this.camera);
  }

  _tickPlaying(dt) {
    this.speed = Math.min(18, this.speed + dt * 0.13);
    // ⭐ダッシュ中はさらに加速(その間は無敵で障害物を粉砕できる)
    const effSpeed = this.speed + (this.dashT > 0 ? 6 : 0);
    this.distance += effSpeed * dt;
    if (this.luckyT > 0) this.luckyT = Math.max(0, this.luckyT - dt);
    if (this.magnetT > 0) this.magnetT = Math.max(0, this.magnetT - dt);
    if (this.dashT > 0) this.dashT = Math.max(0, this.dashT - dt);
    if (this.distance >= this.nextMilestone) {
      this.nextMilestone += 100;
      Sound.sfxMilestone();
      this._popup(`${Math.floor(this.distance)}m 突破!🔥`, '#ffd9a0');
    }
    this.score = Math.floor(this.distance) + this.acornScore;
    this._updateHud();

    // コースのカーブを先読み生成しつつ、使わなくなった過去の制御点は間引く
    this._extendCurve(this.distance + 90);
    while (this.curvePoints.length > 3 && this.curvePoints[1].p < this.distance - 40) this.curvePoints.shift();
    const curveHere = this._curveX(this.distance);
    const headingHere = this._curveHeading(this.distance);

    const g = this.player.group;
    // レーン移動(なめらかに追従)
    g.position.x += (this.laneX - g.position.x) * Math.min(1, dt * 10);
    g.rotation.z = (this.laneX - g.position.x) * -0.4;
    // カーブに合わせてほんの少し体を傾ける(テンプルラン風の「曲がってる感」)
    g.rotation.y = Math.PI + headingHere * 0.6;

    // ジャンプ
    if (this.jumping) {
      this.vy -= 16 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.jumping = false; Sound.sfxLand(); }
    }
    // スライディング
    if (this.sliding) {
      this.slideT += dt;
      if (this.slideT > 0.65) this.sliding = false;
    }
    g.position.y = this.y;
    g.scale.y = PLAYER_SCALE * (this.sliding ? 0.55 : 1) * (this.jumping ? 1.06 : 1);
    g.scale.x = g.scale.z = PLAYER_SCALE * (this.sliding ? 1.18 : 1);
    g.rotation.x = this.sliding ? -0.5 : 0;

    // 走りアニメ(跳ねる・耳/しっぽ)
    const run = this.distance * 3.2;
    if (!this.sliding) g.position.y = this.y + Math.abs(Math.sin(run)) * 0.09;
    this.player.tailSegs.forEach((seg, i) => {
      seg.position.x = Math.sin(run * 1.5 + i * 0.6) * 0.05;
    });
    this.player.head.rotation.y = Math.sin(run * 0.8) * 0.1;
    const blink = Math.sin(this.distance * 0.6) > 0.985 ? 0.1 : 1;
    this.player.eyes.forEach(e => e.scale.y = blink);

    // シールドの見た目
    if (this.shield) {
      this.shieldMesh.visible = true;
      this.shieldMesh.rotation.y += dt * 1.6;
      this.shieldMesh.scale.setScalar(1 + Math.sin(this.distance * 4) * 0.03);
    } else {
      this.shieldMesh.visible = false;
    }
    // ダッシュオーラの見た目
    if (this.dashT > 0) {
      this.dashMesh.visible = true;
      this.dashMesh.rotation.y -= dt * 3;
      this.dashMesh.scale.setScalar(1 + Math.sin(this.distance * 6) * 0.06);
    } else {
      this.dashMesh.visible = false;
    }

    // 風景テーマの移り変わり(昼→夕方→夜をなめらかにループ)
    this._tickTheme(dt);

    // 世界を手前へスクロール
    const dz = effSpeed * dt;
    for (const c of this.clouds) {
      c.position.z += dz * 0.25;
      if (c.position.z > 10) { c.position.z -= 70; c.position.x = (Math.random() - 0.5) * 24; }
    }
    for (const m of this.laneMarks) {
      m.position.z += dz;
      if (m.position.z > 8) { m.position.z -= (-SPAWN_Z * 2); m.userData.pathPos += (-SPAWN_Z * 2); }
      m.position.x = this._curveX(m.userData.pathPos) - curveHere;
    }
    for (const t of this.sideTrees) {
      t.position.z += dz;
      if (t.position.z > 8) { t.position.z -= 80; t.userData.pathPos += 80; }
      t.position.x = t.userData.baseX + (this._curveX(t.userData.pathPos) - curveHere);
    }

    // 障害物
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      // 転がる丸太は世界のスクロールに加えて自分でも迫ってくる
      const extra = o.kind === 'roller' ? ROLLER_SPEED * dt : 0;
      o.mesh.position.z += dz + extra;
      o.pathPos -= extra;
      if (o.kind === 'roller') o.mesh.rotation.x += (dz + extra) * 3;
      o.mesh.position.x = LANES[o.lane] + (this._curveX(o.pathPos) - curveHere);
      const z = o.mesh.position.z;
      if (Math.abs(z) < 0.55 && o.lane === this.lane) {
        const cleared =
          ((o.kind === 'log' || o.kind === 'roller') && (this.jumping || this.y > 0.32)) ||
          (o.kind === 'branch' && this.sliding);
        if (cleared) {
          o.safePass = true; // 通り抜けたらニアミスボーナス
        } else {
          if (this.dashT > 0) {
            // ⭐ダッシュ中は無敵:障害物を粉砕して加点
            this.smashed++;
            this.acornScore += 10;
            Sound.sfxSmash();
            this._shake(0.15);
            this._burst(o.mesh.position, 0xa5713f, 10, 3.2);
            this.obstacleGroup.remove(o.mesh);
            this.obstacles.splice(i, 1);
            continue;
          }
          if (this.shield) {
            this.shield = false;
            Sound.sfxShieldBreak();
            this._popup('シールドが守った!', '#7fe0f5');
            this._shake(0.2);
            this.obstacleGroup.remove(o.mesh);
            this.obstacles.splice(i, 1);
            continue;
          }
          Sound.sfxHit();
          this._shake(0.4);
          this._gameOver();
          break;
        }
      }
      // ジャンプ・スライディングでギリギリかわし切ったらニアミスボーナス
      if (o.safePass && !o.bonusGiven && z > 0.8) {
        o.bonusGiven = true;
        this.nearMisses++;
        this.acornScore += 3;
        Sound.sfxNearMiss();
        this._popup('ナイス回避!+3', '#c8f0ff');
      }
      if (z > DESPAWN_Z) {
        this.obstacleGroup.remove(o.mesh);
        this.obstacles.splice(i, 1);
      }
    }

    // どんぐり・アイテム回収
    for (let i = this.acorns.length - 1; i >= 0; i--) {
      const a = this.acorns[i];
      a.mesh.position.z += dz;
      // 🧲マグネット中は近くの普通どんぐりがプレイヤーへ吸い寄せられる
      if (this.magnetT > 0 && !a.special && !a.got && a.mesh.position.z > -9) a.magnet = true;
      if (a.magnet) {
        a.lane = this.lane;
        a.mesh.position.x += (g.position.x - a.mesh.position.x) * Math.min(1, dt * 12);
        a.mesh.position.y += ((0.5 + this.y) - a.mesh.position.y) * Math.min(1, dt * 10);
      } else {
        a.mesh.position.x = LANES[a.lane] + (this._curveX(a.pathPos) - curveHere);
      }
      a.mesh.rotation.y += dt * 4;
      const z = a.mesh.position.z;
      const catchRange = a.special ? 0.56 : 0.5;
      if (!a.got && Math.abs(z) < catchRange && a.lane === this.lane) {
        a.got = true;
        this._collectAcorn(a);
        this.acornGroup.remove(a.mesh);
        this.acorns.splice(i, 1);
        continue;
      }
      if (z > DESPAWN_Z) {
        if (!a.got && !a.special) this._missAcorn();
        this.acornGroup.remove(a.mesh);
        this.acorns.splice(i, 1);
      }
    }

    // 新しい行の生成(距離ベース)
    this.spawnAcc += dz;
    if (this.spawnAcc >= ROW_GAP) {
      this.spawnAcc -= ROW_GAP;
      this._spawnRow(SPAWN_Z);
    }

    // 走りの土ぼこり(地面にいる間だけ、後ろへぽふぽふ)
    this.dustAcc += dt;
    if (this.dustAcc > 0.13 && this.y <= 0.01 && !this.sliding) {
      this.dustAcc = 0;
      const m = new THREE.Mesh(this._fxGeo, this._fxMat(0xd8cbb0));
      m.position.set(g.position.x + (Math.random() - 0.5) * 0.3, 0.06, 0.4);
      m.scale.setScalar(0.05 + Math.random() * 0.04);
      this.fx.push({ mesh: m, life: 0.4, vx: (Math.random() - 0.5) * 0.5, vy: 0.6 + Math.random() * 0.4, vz: 2.2 });
      this.fxGroup.add(m);
    }

    // パーティクル更新(キラキラ・土ぼこり・破片)
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.life -= dt;
      f.vy -= 5 * dt;
      f.mesh.position.x += f.vx * dt;
      f.mesh.position.y += f.vy * dt;
      f.mesh.position.z += (f.vz + effSpeed * 0.4) * dt;
      f.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2.4));
      if (f.life <= 0 || f.mesh.scale.x < 0.01) {
        this.fxGroup.remove(f.mesh);
        this.fx.splice(i, 1);
      }
    }

    // カメラ(追走+カーブに応じた旋回・バンク+スピードでFOVが広がる+ヒット時のシェイク)
    // 少し先のカーブを先読みして首を振ることで、曲がる直前から「曲がる感」を出す
    const yaw = this._curveHeading(this.distance + 9) * 0.9;
    const upAxis = new THREE.Vector3(0, 1, 0);
    const camOffset = new THREE.Vector3(0, 2.9 + this.y * 0.3, 6.8).applyAxisAngle(upAxis, yaw);
    const camTarget = new THREE.Vector3(g.position.x * 0.4, 0, 0).add(camOffset);
    this.camera.position.lerp(camTarget, Math.min(1, dt * 6));
    const fovTarget = 50 + (this.speed - 6.5) * 0.7 + (this.dashT > 0 ? 9 : 0);
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 4);
    this.camera.updateProjectionMatrix();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeMag * Math.max(0, this.shakeT / 0.3);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    const lookOffset = new THREE.Vector3(0, 1.0 + this.y * 0.35, -3.4).applyAxisAngle(upAxis, yaw);
    const lookTarget = new THREE.Vector3(g.position.x * 0.4, 0, 0).add(lookOffset);
    this.camera.lookAt(lookTarget);
    this.camera.rotateZ(-yaw * 0.18); // カーブに傾くバンク
  }

  // ---------- 風景テーマの移り変わり ----------
  _tickTheme(dt) {
    const theme = THEMES[Math.floor(this.distance / THEME_SPAN) % THEMES.length];
    const k = Math.min(1, dt * 0.7);
    this.skyColor.lerp(this._tmpColor.set(theme.sky), k);
    this.groundMat.color.lerp(this._tmpColor.set(theme.ground), k);
    this.treeLeafMat.color.lerp(this._tmpColor.set(theme.leaf), k);
    this.treeTrunkMat.color.lerp(this._tmpColor.set(theme.trunk), k);
    this.sun.intensity += (theme.sun - this.sun.intensity) * k;
    this.hemi.intensity += (theme.hemi - this.hemi.intensity) * k;
  }

  _tickGameOver(dt) {
    this.tumbleT += dt;
    const g = this.player.group;
    if (this.tumbleT < 1) {
      g.rotation.x = Math.min(Math.PI / 2, this.tumbleT * 3.2);
      g.position.y = Math.max(0, this.y - this.tumbleT * 1.2);
    }
  }

  _tickAmbient(dt) {
    // 待機中もリスがまばたき・呼吸するように
    if (this.state !== 'over') {
      const t = performance.now() / 1000;
      const breathe = 1 + Math.sin(t * 2.2) * 0.02;
      if (this.state === 'ready' || this.state === 'countdown') {
        this.player.group.scale.set(PLAYER_SCALE, PLAYER_SCALE * breathe, PLAYER_SCALE);
      }
    }
  }

  destroy() {
    this._ro?.disconnect();
    removeEventListener('keydown', this._keyHandler);
    clearTimeout(this._countdownTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
    Sound.stopBgm();
  }
}

let instance = null;
export function initMinigame() {
  const root = $('#game-modal');
  $('#game-close', root).addEventListener('click', () => instance.close());
  $('#game-close2', root).addEventListener('click', () => instance.close());
  $('#game-tap-start', root).addEventListener('click', () => instance.start());
  $('#game-retry', root).addEventListener('click', () => instance.start());
  $('#game-pause', root).addEventListener('click', () => instance.pause());
  $('#game-resume', root).addEventListener('click', () => instance.resume());
  $('#game-quit', root).addEventListener('click', () => instance.close());
  const muteBtn = $('#game-mute', root);
  muteBtn.textContent = Sound.isMuted() ? '🔇' : '🔊';
  muteBtn.addEventListener('click', () => {
    const m = Sound.toggleMute();
    muteBtn.textContent = m ? '🔇' : '🔊';
  });
  instance = new MiniGame(root);
}
export function openMinigame() { instance?.open(); }
