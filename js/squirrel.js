// ============================================================
// squirrel.js — three.js 製のかわいいリス
//   ・プリミティブから手作りしたローポリのリス(外部モデル不要)
//   ・現実の時刻で空が変わる(朝焼け/昼/夕焼け/星空)
//   ・現実の季節で地面・木・服装が変わる
//   ・タップでなでられて喜ぶ/タスク完了でジャンプ/全達成でどんぐりの雨
//   ・レベルに応じてマフラー・どんぐり山・冠が出現
// ============================================================
import * as THREE from '../vendor/three.module.js';

const FUR    = 0xC98A52;  // 毛
const FUR_D  = 0xA96F3E;  // 毛(濃)
const CREAM  = 0xF6E7C8;  // おなか
const DARK   = 0x3E2A1C;  // 目・鼻
const ACORN_B= 0xB07B4F;  // どんぐり本体
const ACORN_C= 0x6E4A2F;  // どんぐり傘

export class SquirrelScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.mixerT = 0;
    this.state = 'idle';        // idle | happy | jump | sleep
    this.stateT = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.rain = [];             // どんぐりの雨
    this.level = 1;
    this._onTap = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
    this.camera.position.set(0, 2.1, 7.2);
    this.camera.lookAt(0, 1.05, 0);

    this._buildLights();
    this._buildGround();
    this._buildTree();
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

  _buildSquirrel() {
    const g = new THREE.Group();
    const fur = new THREE.MeshToonMaterial({ color: FUR });
    const furD = new THREE.MeshToonMaterial({ color: FUR_D });
    const cream = new THREE.MeshToonMaterial({ color: CREAM });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: .4 });

    // 胴体(まるっと)
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 20), fur);
    body.scale.set(1, 1.12, 0.92); body.position.y = 0.68; body.castShadow = true;
    g.add(body);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 16), cream);
    belly.scale.set(0.82, 1, 0.6); belly.position.set(0, 0.62, 0.26);
    g.add(belly);

    // 頭
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), fur);
    skull.scale.set(1, 0.94, 0.95); skull.castShadow = true;
    head.add(skull);
    // ほっぺ
    for (const s of [-1, 1]) {
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), cream);
      cheek.position.set(0.2 * s, -0.14, 0.34);
      head.add(cheek);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12),
        new THREE.MeshBasicMaterial({ color: 0xe8927c, transparent: true, opacity: 0.7 }));
      blush.position.set(0.3 * s, -0.03, 0.415);
      blush.lookAt(0.9 * s, 0.1, 3);
      head.add(blush);
    }
    // マズル&鼻
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), cream);
    muzzle.position.set(0, -0.1, 0.4); muzzle.scale.set(1.15, 0.8, 0.8);
    head.add(muzzle);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), dark);
    nose.position.set(0, -0.04, 0.5);
    head.add(nose);
    // 目(まばたき用に保持)
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), dark);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      glint.position.set(0.025, 0.03, 0.055);
      eye.add(ball, glint);
      eye.position.set(0.17 * s, 0.08, 0.4);
      head.add(eye); this.eyes.push(eye);
    }
    // 耳
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 10), fur);
      ear.position.set(0.26 * s, 0.42, 0.02); ear.rotation.z = -0.25 * s;
      head.add(ear);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 8), cream);
      inner.position.set(0.255 * s, 0.4, 0.06); inner.rotation.z = -0.25 * s;
      head.add(inner);
    }
    head.position.set(0, 1.45, 0.1);
    g.add(head);
    this.head = head;

    // うで(どんぐりを抱える)
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 6, 10), furD);
      arm.position.set(0.3 * s, 0.86, 0.42); arm.rotation.set(1.2, 0, -0.7 * s);
      arm.castShadow = true;
      g.add(arm);
    }
    this.heldAcorn = makeAcorn(0.2);
    this.heldAcorn.position.set(0, 0.83, 0.58);
    g.add(this.heldAcorn);

    // あし
    for (const s of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), furD);
      foot.scale.set(1, 0.55, 1.5); foot.position.set(0.3 * s, 0.1, 0.28);
      foot.castShadow = true;
      g.add(foot);
    }

    // しっぽ(球の連なりでS字のふさふさ)
    this.tail = new THREE.Group();
    const pts = [
      [0, 0.35, -0.5, 0.28], [0, 0.75, -0.72, 0.36], [0, 1.2, -0.78, 0.42],
      [0, 1.65, -0.66, 0.44], [0, 2.0, -0.4, 0.4], [0, 2.2, -0.08, 0.3],
    ];
    this.tailSegs = [];
    for (const [x, y, z, r] of pts) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 14), fur);
      seg.position.set(x, y, z); seg.castShadow = true;
      this.tail.add(seg); this.tailSegs.push(seg);
    }
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), cream);
    tip.position.set(0, 2.32, 0.05);
    this.tail.add(tip);
    g.add(this.tail);

    // ---- レベル演出パーツ(最初は非表示) ----
    // Lv3: マフラー
    this.scarf = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.11, 10, 22),
      new THREE.MeshToonMaterial({ color: 0xc25b4e }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.12;
    const tail1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.3, 6, 10),
      new THREE.MeshToonMaterial({ color: 0xc25b4e }));
    tail1.position.set(0.18, 0.88, 0.42); tail1.rotation.z = 0.2;
    this.scarf.add(ring, tail1); this.scarf.visible = false;
    g.add(this.scarf);
    // Lv4: どんぐりの山
    this.hoard = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const a = makeAcorn(0.17);
      a.position.set(1.35 + (i % 3) * 0.24 - 0.2, 0.14 + Math.floor(i / 3) * 0.2, 0.5 + (i % 2) * 0.18);
      this.hoard.add(a);
    }
    this.hoard.visible = false;
    g.add(this.hoard);
    // Lv5: 葉っぱの冠
    this.crown = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6),
        new THREE.MeshToonMaterial({ color: 0xe0a85c }));
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.24, 0.55, Math.sin(a) * 0.24);
      leaf.rotation.x = 0.3;
      this.crown.add(leaf);
    }
    this.crown.visible = false;
    head.add(this.crown);

    g.position.set(0.4, 0, 0.6);
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

    // 季節:地面・葉の色
    let ground, leaf, grass;
    if (m >= 3 && m <= 5)      { ground = 0x92b56e; leaf = 0xf4b8c8; grass = 0x7aa85e; } // 春:桜色の木
    else if (m >= 6 && m <= 8) { ground = 0x7fae5d; leaf = 0x4e8a3f; grass = 0x5f9a48; } // 夏:濃い緑
    else if (m >= 9 && m <= 11){ ground = 0xb99a5e; leaf = 0xd88c3c; grass = 0xa8853f; } // 秋:紅葉
    else                       { ground = 0xe8ecef; leaf = 0xd8e4ea; grass = 0xc8d4da; } // 冬:雪
    this.groundMat.color.set(ground);
    this.leafMat.color.set(leaf);
    this.grassMat.color.set(grass);
  }

  // ---------- レベル反映 ----------
  setLevel(lv) {
    this.level = lv;
    const tailScale = 1 + Math.min(lv - 1, 3) * 0.08; // レベルでしっぽが立派に
    this.tail.scale.setScalar(tailScale);
    this.scarf.visible = lv >= 3;
    this.hoard.visible = lv >= 4;
    this.crown.visible = lv >= 5;
  }

  // ---------- アクション ----------
  happy()  { this.state = 'happy'; this.stateT = 0; }
  jump()   { this.state = 'jump';  this.stateT = 0; }
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
    // リス付近のタップで喜ぶ(簡易ヒット:画面中央下半分)
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x > 0.25 && x < 0.85 && y > 0.3) {
      this.happy();
      if (this._onTap) this._onTap();
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

    // 呼吸(からだ全体がふわふわ)
    const breathe = 1 + Math.sin(t * 2.2) * 0.018;
    this.squirrel.scale.set(1, breathe, 1);

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

    // 状態アニメ
    if (this.state === 'happy') {
      const p = this.stateT;
      this.squirrel.position.y = Math.abs(Math.sin(p * 9)) * 0.14 * Math.max(0, 1 - p / 1.4);
      this.head.rotation.z = Math.sin(p * 10) * 0.16 * Math.max(0, 1 - p / 1.4);
      if (p > 1.4) { this.state = 'idle'; this.squirrel.position.y = 0; }
    } else if (this.state === 'jump') {
      const p = this.stateT / 0.9;
      if (p < 1) {
        this.squirrel.position.y = Math.sin(Math.PI * Math.min(p * 1.4, 1)) * 0.55;
        this.squirrel.rotation.y = -0.25 + Math.sin(p * Math.PI) * 0.5;
      } else { this.state = 'idle'; this.squirrel.position.y = 0; this.squirrel.rotation.y = -0.25; }
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

    this.renderer.render(this.scene, this.camera);
  }
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
