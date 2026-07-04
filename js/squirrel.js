// ============================================================
// squirrel.js — three.js 製のかわいいリス(ふわふわ案 採用)
//   ・手作りの3Dリス(まばたき・呼吸・しっぽの揺れ・首かしげ・耳ぴこぴこ)
//   ・現実の時刻で空が変わる(朝焼け/昼/夕焼け/星空)
//   ・現実の季節で地面・木・お花・パーティクル(花びら/落ち葉/雪/ほたる)が変わる
//   ・蝶々が舞う(昼・雪以外)/木漏れ日(昼間)
//   ・なでると喜んでカメラがぽよんとズーム/タスク完了でジャンプ/全達成でどんぐりの雨
//   ・ときどきぴょこぴょこお散歩
//   ・タスク完了でどんぐりが3Dの貯蔵山に飛んでいく
//   ・レベルに応じてマフラー・冠が出現
// ============================================================
import * as THREE from '../vendor/three.module.js';

// ふわふわ案(B):まんまる毛玉・クリーム多め
const V = {
  fur: 0xE3B98C, furD: 0xCE9F6E, cream: 0xFFF8E8, blush: 0xF2B49E,
  headScale: 1.16, headY: 1.42, eyeR: 0.09, bodyW: 1.14, bodyH: 1.0,
  tailFluff: 1.28, earR: 0.14, extraFluff: true, muzzle: 0.16,
};

const DARK    = 0x3E2A1C;  // 目・鼻
const ACORN_B = 0xB07B4F;  // どんぐり本体
const ACORN_C = 0x6E4A2F;  // どんぐり傘

export class SquirrelScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.mixerT = 0;
    this.state = 'idle';        // idle | happy | jump | hop
    this.stateT = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.earT = 3 + Math.random() * 4;
    this.hopT = 6 + Math.random() * 6;  // 次のお散歩まで
    this.rain = [];             // どんぐりの雨
    this.flying = [];           // 貯蔵山へ飛ぶどんぐり
    this.level = 1;
    this.zoomT = -1;            // カメラぽよんズーム
    this._onTap = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
    this.camHome = new THREE.Vector3(0, 2.1, 7.2);
    this.camera.position.copy(this.camHome);
    this.camera.lookAt(0, 1.05, 0);

    this._buildLights();
    this._buildGround();
    this._buildTree();
    this._buildStash();
    this._buildButterflies();
    this._buildSeasonParticles();
    this._buildSunShafts();
    this._buildSquirrel();
    this._applyTimeAndSeason();

    canvas.addEventListener('pointerdown', (e) => this._tap(e));
    this._resize();
    addEventListener('resize', () => this._resize());
    this._loop();
    // 空の色は1分ごとに追従
    setInterval(() => this._applyTimeAndSeason(), 60000);
  }

  onTap(fn) { this._onTap = fn; }

  // ---------- 構築 ----------
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x7a6a50, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(3, 6, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -6; this.sun.shadow.camera.right = 6;
    this.sun.shadow.camera.top = 6; this.sun.shadow.camera.bottom = -6;
    this.scene.add(this.sun);
  }

  _buildGround() {
    this.groundMat = new THREE.MeshToonMaterial({ color: 0x8fae6b });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 40), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // 散らばるどんぐり&草
    this.deco = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = makeAcorn(0.16);
      const ang = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 3;
      a.position.set(Math.cos(ang) * r, 0.13, Math.sin(ang) * r * 0.6 + 0.5);
      a.rotation.z = (Math.random() - 0.5);
      this.deco.add(a);
    }
    this.grassMat = new THREE.MeshToonMaterial({ color: 0x6f9a52 });
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.35, 5), this.grassMat);
      const ang = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 4;
      g.position.set(Math.cos(ang) * r, 0.17, Math.sin(ang) * r * 0.6);
      g.rotation.z = (Math.random() - 0.5) * 0.4;
      this.deco.add(g);
    }
    // お花(春夏だけ表示)
    this.flowers = new THREE.Group();
    const petalMat = new THREE.MeshToonMaterial({ color: 0xF3C6D8 });
    const centerMat = new THREE.MeshToonMaterial({ color: 0xF0D080 });
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Group();
      for (let p = 0; p < 5; p++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), petalMat);
        const a = (p / 5) * Math.PI * 2;
        petal.position.set(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
        petal.scale.set(1, 0.5, 1);
        f.add(petal);
      }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), centerMat);
      f.add(c);
      const ang = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3.5;
      f.position.set(Math.cos(ang) * r, 0.22, Math.sin(ang) * r * 0.6 + 0.3);
      this.flowers.add(f);
    }
    this.deco.add(this.flowers);
    this.scene.add(this.deco);
  }

  _buildTree() {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.45, 2.6, 8),
      new THREE.MeshToonMaterial({ color: 0x6e4a2f }));
    trunk.position.y = 1.3; trunk.castShadow = true;
    tree.add(trunk);
    this.leafMat = new THREE.MeshToonMaterial({ color: 0x5f8a4a });
    const sizes = [[0, 3.1, 0, 1.25], [-0.8, 2.6, 0.2, 0.85], [0.85, 2.7, -0.1, 0.9]];
    this.leaves = [];
    for (const [x, y, z, s] of sizes) {
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), this.leafMat);
      leaf.position.set(x, y, z); leaf.castShadow = true;
      tree.add(leaf); this.leaves.push(leaf);
    }
    tree.position.set(-2.9, 0, -2.2);
    this.scene.add(tree);
  }

  // ---------- どんぐり貯蔵山(タスク完了で増える) ----------
  _buildStash() {
    this.stashGroup = new THREE.Group();
    this.stashGroup.position.set(2.2, 0, -0.6);
    this.scene.add(this.stashGroup);
    this.stashCount = 0;
  }

  _stashSlot(i) {
    // らせん状に積み上がる座標
    const layer = Math.floor(i / 6);
    const idx = i % 6;
    const r = 0.34 * Math.max(0, 1 - layer * 0.3) + 0.08;
    const a = idx * (Math.PI * 2 / 6) + layer * 0.5;
    return [Math.cos(a) * r, 0.13 + layer * 0.22, Math.sin(a) * r * 0.9];
  }

  /** 貯蔵数を直接合わせる(取り消し・初期表示など) */
  setStash(n) {
    n = Math.min(Math.max(n, 0), 24);
    while (this.stashCount > n) {
      const c = this.stashGroup.children[this.stashGroup.children.length - 1];
      this.stashGroup.remove(c);
      this.stashCount--;
    }
    while (this.stashCount < n) {
      const a = makeAcorn(0.15);
      const [x, y, z] = this._stashSlot(this.stashCount);
      a.position.set(x, y, z);
      a.rotation.z = (Math.random() - 0.5) * 0.6;
      this.stashGroup.add(a);
      this.stashCount++;
    }
  }

  /** 画面上からどんぐりが飛んできて山に積まれる */
  stashAcorn() {
    if (this.stashCount >= 24) { this.happy(); return; }
    const a = makeAcorn(0.15);
    const [x, y, z] = this._stashSlot(this.stashCount);
    const target = new THREE.Vector3(x, y, z).add(this.stashGroup.position);
    a.position.set(0.2, 4.6, 1.2);
    a.userData = { target, t: 0, start: a.position.clone(), slot: [x, y, z] };
    this.scene.add(a);
    this.flying.push(a);
    this.stashCount++;
  }

  // ---------- 蝶々 ----------
  _buildButterflies() {
    this.butterflies = [];
    const colors = [0xF3B6CE, 0xF0D080, 0xA8C8E8];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: colors[i], side: THREE.DoubleSide });
      const wingGeo = new THREE.CircleGeometry(0.12, 8);
      const w1 = new THREE.Mesh(wingGeo, mat);
      const w2 = new THREE.Mesh(wingGeo, mat);
      w1.position.x = -0.09; w2.position.x = 0.09;
      const p1 = new THREE.Group(); p1.add(w1);
      const p2 = new THREE.Group(); p2.add(w2);
      b.add(p1, p2);
      b.userData = {
        p1, p2, phase: Math.random() * 10,
        cx: (Math.random() - 0.5) * 4, cz: (Math.random() - 0.5) * 2 - 0.5,
        ry: 1 + Math.random() * 1.4, speed: 0.25 + Math.random() * 0.2,
        h: 1.2 + Math.random() * 1.2,
      };
      this.scene.add(b);
      this.butterflies.push(b);
    }
  }

  // ---------- 季節パーティクル(花びら/葉/雪/ほたる) ----------
  _buildSeasonParticles() {
    this.particleMat = new THREE.MeshBasicMaterial({ color: 0xF3C6D8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.particles = [];
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(0.06, 6), this.particleMat);
      p.userData = {
        x: (Math.random() - 0.5) * 10, y: Math.random() * 6,
        z: (Math.random() - 0.5) * 5 - 1,
        vy: 0.3 + Math.random() * 0.4, ph: Math.random() * 10,
        vr: (Math.random() - 0.5) * 3,
      };
      p.position.set(p.userData.x, p.userData.y, p.userData.z);
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  // ---------- 木漏れ日 ----------
  _buildSunShafts() {
    this.shafts = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xFFF2C8, transparent: true, opacity: 0.13,
      side: THREE.DoubleSide, depthWrite: false,
    });
    for (const [x, w, r] of [[-2.2, 0.5, -0.4], [-1.2, 0.3, -0.5], [-3.4, 0.35, -0.32]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, 6), mat);
      s.position.set(x, 3, -1.5);
      s.rotation.z = r;
      this.shafts.add(s);
    }
    this.scene.add(this.shafts);
  }

  _buildSquirrel() {
    const g = new THREE.Group();
    const fur = new THREE.MeshToonMaterial({ color: V.fur });
    const furD = new THREE.MeshToonMaterial({ color: V.furD });
    const cream = new THREE.MeshToonMaterial({ color: V.cream });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: .4 });

    // 胴体
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 20), fur);
    body.scale.set(V.bodyW, 1.12 * V.bodyH, 0.92 * V.bodyW);
    body.position.y = 0.66; body.castShadow = true;
    g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 16), cream);
    belly.scale.set(0.82 * V.bodyW, V.bodyH, 0.6); belly.position.set(0, 0.6, 0.26 * V.bodyW);
    g.add(belly);
    // ふわふわ:毛玉の房
    for (const [x, y, z, r] of [[-0.42, 0.9, 0.1, 0.2], [0.42, 0.9, 0.1, 0.2], [0, 0.42, 0.42, 0.22], [-0.3, 0.45, -0.35, 0.24], [0.3, 0.45, -0.35, 0.24]]) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), fur);
      tuft.position.set(x, y, z);
      g.add(tuft);
    }

    // 頭(ちび頭ベース)
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), fur);
    skull.scale.set(1.04, 0.96, 0.95); skull.castShadow = true;
    head.add(skull);
    // ほっぺ(まるく大きく)+チーク
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 12), cream);
      cheek.position.set(0.21 * s, -0.16, 0.33);
      head.add(cheek);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.085, 12),
        new THREE.MeshBasicMaterial({ color: V.blush, transparent: true, opacity: 0.75 }));
      blush.position.set(0.31 * s, -0.04, 0.41);
      blush.lookAt(0.95 * s, 0.05, 3);
      head.add(blush);
    }
    // マズル・鼻
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(V.muzzle, 14, 12), cream);
    muzzle.position.set(0, -0.11, 0.4); muzzle.scale.set(1.15, 0.8, 0.8);
    head.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x8A5B44, roughness: .5 }));
    nose.position.set(0, -0.04, 0.51);
    head.add(nose);
    // にっこり口(トーラスの下半分)
    this.mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI),
      new THREE.MeshBasicMaterial({ color: DARK }));
    this.mouth.position.set(0, -0.13, 0.49);
    this.mouth.rotation.z = Math.PI;
    head.add(this.mouth);
    // おおきな目 + ダブルハイライト
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(V.eyeR, 14, 12), dark);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(V.eyeR * 0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(V.eyeR * 0.34, V.eyeR * 0.4, V.eyeR * 0.72);
      const glint2 = new THREE.Mesh(new THREE.SphereGeometry(V.eyeR * 0.16, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint2.position.set(-V.eyeR * 0.38, -V.eyeR * 0.3, V.eyeR * 0.75);
      eye.add(ball, glint, glint2);
      eye.position.set(0.17 * s, 0.09, 0.4);
      head.add(eye); this.eyes.push(eye);
    }
    // 耳(ぴこぴこ動かすので保持)
    this.ears = [];
    for (const s of [-1, 1]) {
      const earG = new THREE.Group();
      const ear = new THREE.Mesh(new THREE.ConeGeometry(V.earR, V.earR * 2, 10), fur);
      ear.position.y = V.earR;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(V.earR * 0.55, V.earR * 1.2, 8), cream);
      inner.position.set(0, V.earR * 0.9, 0.04);
      earG.add(ear, inner);
      earG.position.set(0.26 * s, 0.38, 0.02);
      earG.rotation.z = -0.25 * s;
      head.add(earG); this.ears.push(earG);
    }
    head.scale.setScalar(V.headScale);
    head.position.set(0, V.headY, 0.12);
    g.add(head);
    this.head = head;

    // うで+どんぐり
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 6, 10), furD);
      arm.position.set(0.3 * s, 0.84, 0.42); arm.rotation.set(1.2, 0, -0.7 * s);
      arm.castShadow = true;
      g.add(arm);
    }
    this.heldAcorn = makeAcorn(0.2);
    this.heldAcorn.position.set(0, 0.8, 0.56);
    g.add(this.heldAcorn);

    // あし
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), furD);
      foot.scale.set(1, 0.55, 1.5); foot.position.set(0.3 * s, 0.1, 0.28);
      foot.castShadow = true;
      g.add(foot);
    }

    // しっぽ(ふさ数を増やしてもっとふわふわ)
    this.tail = new THREE.Group();
    const pts = [
      [0, 0.32, -0.5, 0.28], [0, 0.62, -0.72, 0.36], [0, 1.0, -0.8, 0.43],
      [0, 1.42, -0.78, 0.47], [0, 1.8, -0.62, 0.46], [0, 2.08, -0.34, 0.4],
      [0, 2.22, -0.02, 0.3],
    ];
    this.tailSegs = [];
    for (const [x, y, z, r] of pts) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r * V.tailFluff, 16, 14), fur);
      seg.position.set(x, y, z); seg.castShadow = true;
      this.tail.add(seg); this.tailSegs.push(seg);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.2 * V.tailFluff, 12, 10), cream);
    tip.position.set(0, 2.34, 0.1);
    this.tail.add(tip);
    g.add(this.tail);

    // ---- レベル演出パーツ(最初は非表示) ----
    // Lv3: マフラー
    this.scarf = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.11, 10, 22),
      new THREE.MeshToonMaterial({ color: 0xc25b4e }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.1;
    const tail1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 6, 10),
      new THREE.MeshToonMaterial({ color: 0xc25b4e }));
    tail1.position.set(0.18, 0.86, 0.42); tail1.rotation.z = 0.2;
    this.scarf.add(ring, tail1); this.scarf.visible = false;
    g.add(this.scarf);
    // Lv5: 葉っぱの冠
    this.crown = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6),
        new THREE.MeshToonMaterial({ color: 0xe0a85c }));
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.24, 0.52, Math.sin(a) * 0.24);
      leaf.rotation.x = 0.3;
      this.crown.add(leaf);
    }
    this.crown.visible = false;
    head.add(this.crown);

    // 位置(お散歩の基準点)
    this.homeSpot = { x: 0.4, z: 0.6 };
    g.position.set(this.homeSpot.x, 0, this.homeSpot.z);
    g.rotation.y = -0.25;
    this.squirrel = g;
    this.scene.add(g);
  }

  // ---------- 時刻・季節 ----------
  _applyTimeAndSeason() {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    const m = now.getMonth() + 1;

    // 空:朝焼け→昼→夕焼け→夜
    let sky, sunColor, sunInt, hemiInt;
    if (h < 5)        { sky = 0x1b2440; sunColor = 0x9ab0ff; sunInt = 0.35; hemiInt = 0.35; }
    else if (h < 7)   { sky = 0xf2b28c; sunColor = 0xffc490; sunInt = 1.0;  hemiInt = 0.7; }
    else if (h < 16)  { sky = 0xaed9e8; sunColor = 0xfff6e0; sunInt = 1.5;  hemiInt = 0.95; }
    else if (h < 18.5){ sky = 0xf0a06a; sunColor = 0xffb070; sunInt = 1.1;  hemiInt = 0.7; }
    else if (h < 20)  { sky = 0x5a4a78; sunColor = 0xc0a8ff; sunInt = 0.6;  hemiInt = 0.5; }
    else              { sky = 0x1b2440; sunColor = 0x9ab0ff; sunInt = 0.35; hemiInt = 0.35; }
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 10, 22);
    this.sun.color.set(sunColor); this.sun.intensity = sunInt;
    this.hemi.intensity = hemiInt;

    const day = (h >= 7 && h < 16);
    this.shafts.visible = day;

    // 星(夜だけ)
    const night = (h < 5 || h >= 20);
    if (night && !this.stars) {
      const geo = new THREE.BufferGeometry();
      const pos = [];
      for (let i = 0; i < 120; i++) {
        pos.push((Math.random() - 0.5) * 30, 4 + Math.random() * 8, -6 - Math.random() * 8);
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff6d8, size: 0.07 }));
      this.scene.add(this.stars);
    }
    if (this.stars) this.stars.visible = night;

    // 季節:地面・葉の色・お花・パーティクル
    let ground, leaf, grass;
    if (m >= 3 && m <= 5)      { ground = 0x92b56e; leaf = 0xf4b8c8; grass = 0x7aa85e; this.season = 'spring'; }
    else if (m >= 6 && m <= 8) { ground = 0x7fae5d; leaf = 0x4e8a3f; grass = 0x5f9a48; this.season = 'summer'; }
    else if (m >= 9 && m <= 11){ ground = 0xb99a5e; leaf = 0xd88c3c; grass = 0xa8853f; this.season = 'autumn'; }
    else                       { ground = 0xe8ecef; leaf = 0xd8e4ea; grass = 0xc8d4da; this.season = 'winter'; }
    this.groundMat.color.set(ground);
    this.leafMat.color.set(leaf);
    this.grassMat.color.set(grass);
    this.flowers.visible = (this.season === 'spring' || this.season === 'summer');

    // 季節パーティクルの見た目
    if (this.season === 'spring') { this.particleMat.color.set(0xF6C8D8); this.particleMode = 'fall'; }
    else if (this.season === 'summer') {
      if (night) { this.particleMat.color.set(0xD8F0A0); this.particleMode = 'firefly'; }
      else { this.particleMat.color.set(0xBFE08A); this.particleMode = 'fall'; }
    }
    else if (this.season === 'autumn') { this.particleMat.color.set(0xE0983C); this.particleMode = 'fall'; }
    else { this.particleMat.color.set(0xFFFFFF); this.particleMode = 'snow'; }
    // 蝶は昼・雪以外
    const showB = !night && this.season !== 'winter';
    this.butterflies.forEach(b => b.visible = showB);
  }

  // ---------- レベル反映 ----------
  setLevel(lv) {
    this.level = lv;
    const tailScale = 1 + Math.min(lv - 1, 3) * 0.08; // レベルでしっぽが立派に
    this.tail.scale.setScalar(tailScale);
    this.scarf.visible = lv >= 3;
    this.crown.visible = lv >= 5;
  }

  // ---------- アクション ----------
  happy() { this.state = 'happy'; this.stateT = 0; }
  jump()  { this.state = 'jump';  this.stateT = 0; }

  /** どんぐりの雨(全達成のお祝い) */
  acornRain(n = 14) {
    for (let i = 0; i < n; i++) {
      const a = makeAcorn(0.16 + Math.random() * 0.08);
      a.position.set((Math.random() - 0.5) * 5, 5 + Math.random() * 3, (Math.random() - 0.5) * 3 + 0.5);
      a.userData.vy = 0;
      a.userData.vr = (Math.random() - 0.5) * 6;
      a.userData.landed = false;
      a.userData.life = 6 + Math.random() * 2;
      this.scene.add(a);
      this.rain.push(a);
    }
  }

  _tap(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    // リス付近:喜ぶ+カメラぽよんズーム
    if (x > 0.25 && x < 0.85 && y > 0.3) {
      this.happy();
      this.zoomT = 0;
      if (this._onTap) this._onTap();
    } else {
      // 風景タップ:蝶がふわっと寄ってくる
      this.butterflies.forEach(b => { b.userData.excite = 2.5; });
    }
  }

  // ---------- ループ ----------
  _resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.mixerT += dt;
    this.stateT += dt;
    const t = this.mixerT;
    const g = this.squirrel;

    // 呼吸(からだ全体がふわふわ)
    const breathe = 1 + Math.sin(t * 2.2) * 0.02;
    g.scale.set(1, breathe, 1);

    // しっぽの揺れ
    this.tailSegs.forEach((seg, i) => {
      seg.position.x = Math.sin(t * 1.6 + i * 0.55) * 0.06 * (i + 1) / 3;
    });
    this.tail.rotation.z = Math.sin(t * 1.6) * 0.05;

    // 頭のかたむき
    this.head.rotation.z = Math.sin(t * 0.7) * 0.05;
    this.head.rotation.y = Math.sin(t * 0.45) * 0.12;

    // まばたき
    this.blinkT -= dt;
    const blink = this.blinkT < 0.12 ? Math.max(0.1, Math.abs(this.blinkT - 0.06) / 0.06) : 1;
    if (this.blinkT <= 0) this.blinkT = 2 + Math.random() * 3.5;
    this.eyes.forEach(e => e.scale.y = blink);

    // 耳ぴこぴこ(ときどき)
    this.earT -= dt;
    if (this.earT < 0.5 && this.earT > 0) {
      const w = Math.sin(this.earT * 28) * 0.28 * (this.earT / 0.5);
      this.ears[0].rotation.z = -0.25 + w;
      this.ears[1].rotation.z = 0.25 - w;
    } else if (this.earT <= 0) {
      this.ears[0].rotation.z = -0.25; this.ears[1].rotation.z = 0.25;
      this.earT = 3 + Math.random() * 5;
    }

    // 状態アニメ(ぽよん系:squash & stretch)
    if (this.state === 'happy') {
      const p = this.stateT;
      const fade = Math.max(0, 1 - p / 1.4);
      const bounce = Math.abs(Math.sin(p * 9));
      g.position.y = bounce * 0.16 * fade;
      g.scale.y = breathe * (1 + bounce * 0.08 * fade);
      g.scale.x = g.scale.z = 1 - bounce * 0.05 * fade;
      this.head.rotation.z = Math.sin(p * 10) * 0.18 * fade;
      this.mouth.scale.setScalar(1 + bounce * 0.6 * fade);
      if (p > 1.4) { this.state = 'idle'; g.position.y = 0; this.mouth.scale.setScalar(1); }
    } else if (this.state === 'jump') {
      const p = this.stateT / 0.9;
      if (p < 1) {
        const jp = Math.sin(Math.PI * Math.min(p * 1.4, 1));
        g.position.y = jp * 0.6;
        g.rotation.y = -0.25 + Math.sin(p * Math.PI) * 0.5;
        g.scale.y = breathe * (1 + jp * 0.1);
        g.scale.x = g.scale.z = 1 - jp * 0.06;
      } else { this.state = 'idle'; g.position.y = 0; g.rotation.y = -0.25; }
    } else if (this.state === 'hop') {
      // お散歩:目的地までぴょこぴょこ3ホップ
      const d = this.hopData;
      d.p += dt / d.dur;
      const p = Math.min(d.p, 1);
      g.position.x = d.x0 + (d.x1 - d.x0) * p;
      g.position.z = d.z0 + (d.z1 - d.z0) * p;
      g.position.y = Math.abs(Math.sin(p * Math.PI * d.hops)) * 0.22;
      const sq = Math.abs(Math.cos(p * Math.PI * d.hops));
      g.scale.y = breathe * (1 - sq * 0.06);
      g.rotation.y = d.face;
      if (p >= 1) {
        this.state = 'idle'; g.position.y = 0; g.rotation.y = -0.25;
      }
    } else {
      // idle:ときどきお散歩
      this.hopT -= dt;
      if (this.hopT <= 0) {
        this.hopT = 7 + Math.random() * 8;
        const spots = [[0.4, 0.6], [-1.2, 0.2], [1.3, 1.0], [-0.4, 1.3]];
        const cur = [g.position.x, g.position.z];
        const s = spots[Math.floor(Math.random() * spots.length)];
        if (Math.hypot(s[0] - cur[0], s[1] - cur[1]) > 0.3) {
          this.state = 'hop';
          this.hopData = {
            x0: cur[0], z0: cur[1], x1: s[0], z1: s[1],
            p: 0, dur: 1.4, hops: 3,
            face: Math.atan2(s[0] - cur[0], s[1] - cur[1]),
          };
        }
      }
    }

    // カメラぽよんズーム
    if (this.zoomT >= 0) {
      this.zoomT += dt;
      const zt = this.zoomT;
      let k;
      if (zt < 0.5) k = this._easeOutBack(zt / 0.5);        // 寄る
      else if (zt < 1.3) k = 1;                              // キープ
      else if (zt < 2.0) k = 1 - this._easeInOut((zt - 1.3) / 0.7); // 戻る
      else { k = 0; this.zoomT = -1; }
      const target = new THREE.Vector3(g.position.x * 0.55, 1.9, 5.4);
      this.camera.position.lerpVectors(this.camHome, target, k);
      this.camera.lookAt(g.position.x * 0.55 * k, 1.05 + 0.1 * k, 0);
    }

    // 蝶々
    for (const b of this.butterflies) {
      if (!b.visible) continue;
      const u = b.userData;
      u.phase += dt * u.speed * (u.excite > 0 ? 3 : 1);
      if (u.excite > 0) u.excite -= dt;
      const flap = Math.sin(t * 14 + u.phase * 7) * 1.0;
      u.p1.rotation.y = flap; u.p2.rotation.y = -flap;
      b.position.set(
        u.cx + Math.cos(u.phase) * u.ry,
        u.h + Math.sin(u.phase * 2.3) * 0.3,
        u.cz + Math.sin(u.phase) * u.ry * 0.5
      );
      b.rotation.y = -u.phase + Math.PI / 2;
    }

    // 季節パーティクル
    for (const p of this.particles) {
      const u = p.userData;
      if (this.particleMode === 'firefly') {
        u.ph += dt;
        p.position.set(
          u.x + Math.sin(u.ph * 0.7) * 1.2,
          0.8 + (u.y % 2) + Math.sin(u.ph * 1.3) * 0.4,
          u.z * 0.5 + Math.cos(u.ph * 0.5) * 0.8);
        p.scale.setScalar(0.5 + Math.abs(Math.sin(u.ph * 2)) * 0.5);
        p.lookAt(this.camera.position);
      } else {
        const speed = this.particleMode === 'snow' ? u.vy * 0.6 : u.vy;
        p.position.y -= speed * dt;
        u.ph += dt;
        p.position.x = u.x + Math.sin(u.ph * 1.2) * 0.5;
        p.rotation.z += u.vr * dt;
        p.rotation.x = Math.sin(u.ph) * 0.6;
        if (p.position.y < 0.05) { p.position.y = 5.5 + Math.random() * 1.5; u.x = (Math.random() - 0.5) * 10; }
      }
    }

    // 貯蔵山へ飛ぶどんぐり
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const a = this.flying[i];
      const u = a.userData;
      u.t += dt / 0.75;
      const p = Math.min(u.t, 1);
      const e = this._easeInOut(p);
      a.position.lerpVectors(u.start, u.target, e);
      a.position.y += Math.sin(p * Math.PI) * 1.2; // 山なり
      a.rotation.z += dt * 6;
      if (p >= 1) {
        a.rotation.z = (Math.random() - 0.5) * 0.6;
        a.position.set(...u.slot);
        this.scene.remove(a);
        this.stashGroup.add(a);
        this.flying.splice(i, 1);
        // 着地でぽよん
        this.stashGroup.scale.set(1.12, 0.9, 1.12);
        setTimeout(() => this.stashGroup.scale.set(1, 1, 1), 120);
      }
    }

    // どんぐりの雨
    for (let i = this.rain.length - 1; i >= 0; i--) {
      const a = this.rain[i];
      a.userData.life -= dt;
      if (!a.userData.landed) {
        a.userData.vy -= 9.8 * dt;
        a.position.y += a.userData.vy * dt;
        a.rotation.z += a.userData.vr * dt;
        if (a.position.y <= 0.14) {
          a.position.y = 0.14;
          if (Math.abs(a.userData.vy) > 1.5) a.userData.vy = -a.userData.vy * 0.35; // ぽよん
          else a.userData.landed = true;
        }
      }
      if (a.userData.life <= 0) {
        a.scale.multiplyScalar(0.86);
        if (a.scale.x < 0.05) { this.scene.remove(a); this.rain.splice(i, 1); }
      }
    }

    // 木がそよぐ
    this.leaves.forEach((l, i) => { l.rotation.z = Math.sin(t * 0.8 + i) * 0.04; });

    this.renderer.render(this.scene, this.camera);
  }

  _easeOutBack(x) { const c = 1.4; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  _easeInOut(x) { return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
}

/** どんぐりを1個つくる(本体+傘+ちょこんとした柄) */
function makeAcorn(size = 0.2) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(size, 14, 12),
    new THREE.MeshToonMaterial({ color: ACORN_B }));
  body.scale.set(0.85, 1.1, 0.85);
  body.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.92, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshToonMaterial({ color: ACORN_C }));
  cap.position.y = size * 0.42;
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.1, size * 0.14, size * 0.3, 6),
    new THREE.MeshToonMaterial({ color: ACORN_C }));
  stem.position.y = size * 0.95;
  g.add(body, cap, stem);
  return g;
}
