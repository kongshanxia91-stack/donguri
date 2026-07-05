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
const ROW_GAP = 7;          // 障害物・どんぐりの行の間隔(ワールド距離)
const SPAWN_Z = -60;        // 生成位置(奥)
const DESPAWN_Z = 6;        // これを超えたら消す(手前)
const COMBO_STEP = 5;       // これだけ連続で取ると倍率アップ

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

    this.best = Number(localStorage.getItem(BEST_KEY) || 0);
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
  }

  _showStart() {
    this.state = 'ready';
    this.overPanel.classList.add('hidden');
    this.pausePanel.classList.add('hidden');
    this.countdownEl.classList.add('hidden');
    this.startPanel.classList.remove('hidden');
    this.hudBest.textContent = this.best ? `ベスト 🌰${this.best}` : '';
  }

  // ---------- ワールド構築(地面・レーン・木・空) ----------
  _buildWorld() {
    this.scene.background = new THREE.Color(0xaed9e8);
    this.scene.fog = new THREE.Fog(0xaed9e8, 20, 55);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x7a6a50, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(4, 8, 6);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 400),
      new THREE.MeshToonMaterial({ color: 0x8fae6b }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -150);
    this.scene.add(ground);

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
      this.scene.add(mark);
      this.laneMarks.push(mark);
    }

    // 両脇の木(奥行き感・スピード感)
    this.sideTrees = [];
    for (let i = 0; i < 10; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.32, 2.0, 7),
        new THREE.MeshToonMaterial({ color: 0x6e4a2f }));
      trunk.position.y = 1.0;
      tree.add(trunk);
      const leaf = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.9, 0),
        new THREE.MeshToonMaterial({ color: 0x5f8a4a }));
      leaf.position.y = 2.2;
      tree.add(leaf);
      tree.position.set(side * (3 + Math.random()), 0, -i * 8);
      tree.userData = { side };
      this.scene.add(tree);
      this.sideTrees.push(tree);
    }

    this.obstacles = [];
    this.acorns = [];
    this.obstacleGroup = new THREE.Group();
    this.acornGroup = new THREE.Group();
    this.scene.add(this.obstacleGroup, this.acornGroup);
  }

  // ---------- プレイヤー(squirrel.jsと共通モデル) ----------
  _buildPlayer() {
    const parts = buildSquirrelModel(THREE);
    this.player = parts;
    parts.group.scale.setScalar(0.85);
    parts.group.rotation.y = Math.PI; // 奥(-z)を向く=カメラにはうしろ姿が見える
    this.scene.add(parts.group);

    // シールド中に出る、ふわっと光るバブル
    const shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7fe0f5, transparent: true, opacity: 0.28, depthWrite: false }));
    shieldMesh.position.y = 0.75;
    shieldMesh.visible = false;
    parts.group.add(shieldMesh);
    this.shieldMesh = shieldMesh;
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
    this.nextMilestone = 100;
    this.shakeT = 0;
    this.shakeMag = 0;

    for (const o of this.obstacles) this.obstacleGroup.remove(o.mesh);
    for (const a of this.acorns) this.acornGroup.remove(a.mesh);
    this.obstacles = [];
    this.acorns = [];

    const g = this.player.group;
    g.position.set(this.laneX, 0, 0);
    g.rotation.z = 0; g.rotation.x = 0;
    this.shieldMesh.visible = false;
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
  }
  resume() {
    if (this.state !== 'paused') return;
    this.pausePanel.classList.add('hidden');
    this.clock.getDelta(); // 一時停止中の経過を捨てる
    this.state = 'playing';
  }

  _gameOver() {
    this.state = 'over';
    this.dead = true;
    this.tumbleT = 0;
    Sound.sfxGameOver();
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.overScore.textContent = `🌰 ${this.score}(どんぐり ${this.acornsGot}個)`;
    this.overCombo.textContent = this.maxCombo >= COMBO_STEP ? `最大コンボ ${this.maxCombo}連続🌰` : '';
    this.overBest.textContent = `ベストスコア 🌰 ${this.best}`;
    setTimeout(() => this.overPanel.classList.remove('hidden'), 550);
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
      this.acornScore += 25;
      this.luckyT = 3;
      Sound.sfxGolden();
      this._popup('✨ラッキータイム!', '#ffcf4d');
    } else if (a.special === 'shield') {
      this.shield = true;
      this.shieldMesh.visible = true;
      Sound.sfxShieldGet();
      this._popup('💠シールド獲得!', '#7fe0f5');
    } else {
      this.acornsGot++;
      this.rowStreak++;
      this.maxCombo = Math.max(this.maxCombo, this.rowStreak);
      this.comboMult = 1 + Math.min(4, Math.floor(this.rowStreak / COMBO_STEP)) * 0.5;
      const gain = Math.round(5 * this.comboMult * (this.luckyT > 0 ? 2 : 1));
      this.acornScore += gain;
      Sound.sfxCollect(this.rowStreak);
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

  // ---------- 障害物・どんぐりの生成 ----------
  _spawnRow(z) {
    const blockedLane = Math.floor(Math.random() * 3);
    const kinds = ['log', 'branch', 'rock'];
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    this._spawnObstacle(blockedLane, z, kind);

    const openLanes = [0, 1, 2].filter(lane => !(lane === blockedLane && kind === 'rock'));

    // まれに特別などんぐり(✨ラッキー or 💠シールド)を1つ混ぜる
    let specialKind = null;
    if (this.distance > 40) {
      const r = Math.random();
      if (r < 0.035 && !this.shield) specialKind = 'shield';
      else if (r < 0.10) specialKind = 'golden';
    }
    const specialLane = specialKind ? openLanes[Math.floor(Math.random() * openLanes.length)] : -1;

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
    this.obstacles.push({ mesh, lane, kind });
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
    } else {
      mesh = makeAcorn(0.16);
    }
    mesh.position.set(LANES[lane], special ? 0.56 : 0.5, z);
    this.acornGroup.add(mesh);
    this.acorns.push({ mesh, lane, got: false, special });
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
    this.speed = Math.min(16, this.speed + dt * 0.12);
    this.distance += this.speed * dt;
    if (this.luckyT > 0) this.luckyT = Math.max(0, this.luckyT - dt);
    if (this.distance >= this.nextMilestone) {
      this.nextMilestone += 100;
      Sound.sfxMilestone();
      this._popup(`${Math.floor(this.distance)}m 突破!🔥`, '#ffd9a0');
    }
    this.score = Math.floor(this.distance) + this.acornScore;
    this._updateHud();

    const g = this.player.group;
    // レーン移動(なめらかに追従)
    g.position.x += (this.laneX - g.position.x) * Math.min(1, dt * 10);
    g.rotation.z = (this.laneX - g.position.x) * -0.4;

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
    g.scale.y = 0.85 * (this.sliding ? 0.55 : 1) * (this.jumping ? 1.06 : 1);
    g.scale.x = g.scale.z = 0.85 * (this.sliding ? 1.18 : 1);
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

    // 世界を手前へスクロール
    const dz = this.speed * dt;
    for (const m of this.laneMarks) {
      m.position.z += dz;
      if (m.position.z > 8) m.position.z -= (-SPAWN_Z * 2);
    }
    for (const t of this.sideTrees) {
      t.position.z += dz;
      if (t.position.z > 8) t.position.z -= 80;
    }

    // 障害物
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.mesh.position.z += dz;
      const z = o.mesh.position.z;
      if (Math.abs(z) < 0.55 && o.lane === this.lane) {
        const cleared =
          (o.kind === 'log' && (this.jumping || this.y > 0.32)) ||
          (o.kind === 'branch' && this.sliding);
        if (!cleared) {
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
      if (z > DESPAWN_Z) {
        this.obstacleGroup.remove(o.mesh);
        this.obstacles.splice(i, 1);
      }
    }

    // どんぐり・アイテム回収
    for (let i = this.acorns.length - 1; i >= 0; i--) {
      const a = this.acorns[i];
      a.mesh.position.z += dz;
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

    // カメラ(追走+ヒット時のシェイク)
    this.camera.position.lerp(new THREE.Vector3(g.position.x * 0.4, 2.6, 6.2), Math.min(1, dt * 6));
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeMag * Math.max(0, this.shakeT / 0.3);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    this.camera.lookAt(g.position.x * 0.4, 1.1, -3);
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
        this.player.group.scale.set(0.85, 0.85 * breathe, 0.85);
      }
    }
  }

  destroy() {
    this._ro?.disconnect();
    removeEventListener('keydown', this._keyHandler);
    clearTimeout(this._countdownTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
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
