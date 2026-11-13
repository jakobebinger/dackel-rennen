// Der Dackel: Snake-Körper aus Segmenten, die dem Pfad des Kopfes folgen.
// Körper, Beine, Pfoten und Krallen sind InstancedMeshes (wenige Draw-Calls,
// auch bei 200+ Segmenten). Kopf und Schwanz sind normale Gruppen.
import * as THREE from 'three';

export const SPACING = 0.34; // Abstand der Segmente entlang des Pfades
export const START_SEG = 7;
export const MAX_SEG = 260;
const BODY_H = 0.72; // Körpermitte über den Füßen
const MAX_LEGS = 64;
const MAX_MID_PAIRS = (MAX_LEGS - 4) / 2;
const PATH_STEP = 0.08;
const GRAVITY = 24;
const JUMP_V = 8.6;
const WALK = 5.4;
const SPRINT = 8.8;
const STEP_UP = 0.45; // höhere Kanten blockieren

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();

// Fellfarben: Spieler 1 = Original, danach Schwarz-Rot, Blond, Grau, Rot, Creme, Schoko, Blau (Online-Modus, max. 8)
export const FUR_COLORS = [
  { name: 'Braun', css: '#a4511f', fur: 0xa4511f, saddle: 0x8a3d19, light: 0xd99450, chest: 0xecc08a, ear: 0x6e2e12, paw: 0x93461b },
  { name: 'Schwarz', css: '#2f2522', fur: 0x2f2522, saddle: 0x1c1513, light: 0xb5712f, chest: 0xc98a44, ear: 0x1c1513, paw: 0x3d2d25 },
  { name: 'Blond', css: '#d9b06a', fur: 0xd9b06a, saddle: 0xc49a52, light: 0xeed9a8, chest: 0xf6e9c8, ear: 0xb98b45, paw: 0xc9a05f },
  { name: 'Grau', css: '#7d7f85', fur: 0x7d7f85, saddle: 0x5a5c63, light: 0xa8aab0, chest: 0xd0d2d6, ear: 0x4a4c52, paw: 0x6b6d73 },
  { name: 'Rot', css: '#b8341c', fur: 0xb8341c, saddle: 0x922613, light: 0xe0764a, chest: 0xf0a77e, ear: 0x7a1d0e, paw: 0xa12d18 },
  { name: 'Creme', css: '#efe4cc', fur: 0xefe4cc, saddle: 0xddcfb0, light: 0xfaf4e6, chest: 0xfffaf0, ear: 0xcdb98f, paw: 0xe3d6b8 },
  { name: 'Schoko', css: '#5a3522', fur: 0x5a3522, saddle: 0x43261a, light: 0x9c6a45, chest: 0xb98a62, ear: 0x341d13, paw: 0x4e2e1e },
  { name: 'Blau', css: '#4f6684', fur: 0x4f6684, saddle: 0x3c4f69, light: 0x8ca0bc, chest: 0xb9c7da, ear: 0x2f3f55, paw: 0x465b77 },
];

export class Dog {
  constructor(scene, colors = FUR_COLORS[0]) {
    this.scene = scene;
    this.objects = []; // alles, was in der Szene hängt (zum Verstecken/Entfernen)
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
    this.mat = {
      fur: std(colors.fur, { roughness: 0.8 }),
      saddle: std(colors.saddle, { roughness: 0.85 }),
      light: std(colors.light, { roughness: 0.8 }),
      chest: std(colors.chest, { roughness: 0.85 }),
      ear: std(colors.ear, { roughness: 0.85 }),
      paw: std(colors.paw, { roughness: 0.85 }),
      black: std(0x151010, { roughness: 0.3 }),
      white: std(0xffffff, { roughness: 0.2 }),
      claw: std(0x2e2622, { roughness: 0.45 }),
      tongue: std(0xe0707a, { roughness: 0.45 }),
    };
    this.sph = new THREE.SphereGeometry(1, 24, 16);

    const inst = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      this.objects.push(m);
      return m;
    };
    // Körper = glatte Röhre: Kugeln an den Gelenken + Zylinder dazwischen
    const tube = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    tube.rotateZ(-Math.PI / 2); // Achse entlang +X
    this.bodyMesh = inst(this.sph, this.mat.fur, MAX_SEG);
    this.tubeMesh = inst(tube, this.mat.fur, MAX_SEG);
    this.saddleMesh = inst(this.sph, this.mat.saddle, MAX_SEG);
    this.saddleTube = inst(tube, this.mat.saddle, MAX_SEG);
    this.legMesh = inst(new THREE.CylinderGeometry(0.105, 0.09, 0.42, 9), this.mat.fur, MAX_LEGS);
    this.pawMesh = inst(this.sph, this.mat.paw, MAX_LEGS);
    const clawGeo = new THREE.ConeGeometry(1, 1, 5);
    clawGeo.rotateZ(-Math.PI / 2); // Spitze zeigt nach vorne (+X)
    this.clawMesh = inst(clawGeo, this.mat.claw, MAX_LEGS * 3);

    this.segPos = new Float32Array(MAX_SEG * 3);
    this.segCY = new Float32Array(MAX_SEG); // Mittelpunkt-Höhe inkl. Wippen
    this.segQ = [];
    this.tubeQ = [];
    for (let i = 0; i < MAX_SEG; i++) {
      this.segQ.push(new THREE.Quaternion());
      this.tubeQ.push(new THREE.Quaternion());
    }

    this.ears = [];
    this._buildFront();
    this._buildTail();

    this.pos = new THREE.Vector3();
    this.ev = { jumped: false, landed: false, splash: false, bumped: false, launch: false };
    this._prevHead = new THREE.Vector3();
    this._headVel = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this.reset(0, 0, 0);
  }

  _part(parent, mat, p, s, r) {
    const m = new THREE.Mesh(this.sph, mat);
    m.position.set(p[0], p[1], p[2]);
    m.scale.set(s[0], s[1], s[2]);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  _buildFront() {
    const M = this.mat;
    const f = new THREE.Group();
    this.front = f;
    this.scene.add(f);
    this.objects.push(f);
    this._part(f, M.chest, [0.24, -0.12, 0], [0.33, 0.28, 0.33]); // helle Brust
    this._part(f, M.fur, [0.4, 0.18, 0], [0.3, 0.31, 0.29]); // Hals

    const h = new THREE.Group();
    h.position.set(0.64, 0.42, 0);
    f.add(h);
    this.head = h;
    this.headBase = h.position.clone();
    this._part(h, M.fur, [0, 0, 0], [0.34, 0.3, 0.29]); // Schädel
    this._part(h, M.fur, [0.28, -0.07, 0], [0.3, 0.17, 0.185]); // Schnauze
    this._part(h, M.fur, [0.5, -0.09, 0], [0.16, 0.135, 0.145]); // runde Schnauzenspitze
    this._part(h, M.light, [0.36, -0.17, 0], [0.22, 0.07, 0.12]); // Kinn
    this._part(h, M.black, [0.645, -0.06, 0], [0.07, 0.06, 0.075]); // Nase
    this.tongue = this._part(h, M.tongue, [0.44, -0.22, 0], [0.11, 0.025, 0.075]);
    this.tongue.visible = false;
    for (const sd of [1, -1]) {
      this._part(h, M.white, [0.24, 0.08, 0.165 * sd], [0.065, 0.07, 0.05]);
      this._part(h, M.black, [0.28, 0.085, 0.18 * sd], [0.036, 0.046, 0.03]);
      this._part(h, M.white, [0.305, 0.105, 0.186 * sd], [0.012, 0.014, 0.01]);
      this._part(h, M.light, [0.24, 0.17, 0.14 * sd], [0.06, 0.028, 0.05], [0.25 * sd, 0, 0]); // Augenbrauen-Fleck
      const p = new THREE.Group();
      p.position.set(-0.05, 0.17, 0.24 * sd);
      h.add(p);
      this._part(p, M.ear, [0, -0.24, 0.035 * sd], [0.17, 0.3, 0.05], [0.12 * sd, 0, 0]);
      this.ears.push({ pivot: p, sd, rz: 0, vz: 0, rx: 0, vx: 0 });
    }
  }

  _buildTail() {
    const t = new THREE.Group();
    this.tail = t;
    this.scene.add(t);
    this.objects.push(t);
    const wag = new THREE.Group();
    t.add(wag);
    this.wag = wag;
    const g = new THREE.ConeGeometry(0.08, 0.78, 9);
    g.translate(0, 0.39, 0);
    const m = new THREE.Mesh(g, this.mat.fur);
    m.rotation.z = 0.95; // nach hinten-oben
    m.castShadow = true;
    wag.add(m);
    this.tailMesh = m;
  }

  reset(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.actualSpeed = 0;
    this.omega = 0;
    this.vy = 0;
    this.groundVy = 0;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.seg = START_SEG;
    this.targetSeg = START_SEG;
    this.stamina = 1;
    this.exhausted = false;
    this.regenDelay = 0;
    this.sprinting = false;
    this.boost = 0;
    this.wagBoost = 0;
    this.eatT = 0;
    this.gait = 0;
    this.amp = 0;
    this.gallop = 0;
    this.air = 0;
    this.squash = 0;
    this.wagPh = 0;
    this.inWater = false;
    this.dead = false;
    this.roll = 0;
    this.time = 0;
    this._headInit = false;
    for (const e of this.ears) e.rz = e.vz = e.rx = e.vx = 0;
    // Pfad: gerade Linie hinter dem Dackel
    this.path = [];
    const fx = Math.cos(heading), fz = -Math.sin(heading);
    const L = (START_SEG + 14) * SPACING;
    for (let d = L; d > 0; d -= PATH_STEP) this.path.push({ x: x - fx * d, y: 0, z: z - fz * d });
    this.nSeg = START_SEG;
    this._layout();
    this._render(0);
  }

  get lengthCm() {
    return Math.round(35 + this.seg * 5);
  }

  feed(type) {
    const grow = type === 'gold' ? 3 : 1;
    this.targetSeg = Math.min(MAX_SEG - 1, this.targetSeg + grow);
    this.wagBoost = 2.6;
    this.eatT = 0.35;
    if (type === 'chain') this.boost = 4;
  }

  knockOut() {
    this.dead = true;
  }

  setVisible(v) {
    for (const o of this.objects) o.visible = v;
  }

  // Aus der Szene entfernen (Mitspieler weg)
  dispose() {
    for (const o of this.objects) this.scene.remove(o);
    this.objects.length = 0;
  }

  // Kopf trifft den Körper eines anderen Dackels (ab dessen Segment 1)?
  checkOther(other) {
    const n = other.nSeg;
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
    const hx = this.pos.x + fx * 0.8, hy = this.pos.y + BODY_H + 0.35, hz = this.pos.z + fz * 0.8;
    const sp = other.segPos;
    const R = 0.62;
    for (let i = 1; i < n; i++) {
      const dx = sp[i * 3] - hx, dz = sp[i * 3 + 2] - hz;
      if (dx * dx + dz * dz > R * R) continue;
      const dy = other.segCY[i] - hy;
      if (dx * dx + dy * dy + dz * dz < R * R) return true;
    }
    return false;
  }

  // Online: Dackel eines Mitspielers aus dem Host-Zustand animieren (keine Physik)
  // s = { x, y, z, heading, speed, targetSeg, stamina, exhausted, boost, sprinting, onGround, inWater, dead }
  remoteUpdate(dt, s) {
    const ev = this.ev;
    ev.jumped = ev.landed = ev.splash = ev.bumped = ev.launch = false;
    this.time += dt;
    const p = this.pos;
    const ox = p.x, oz = p.z;
    const wasGround = this.onGround;
    p.set(s.x, s.y, s.z);
    const turned = wrapAngle(s.heading - this.heading);
    this.omega = lerp(this.omega, dt > 0 ? turned / dt : 0, 0.3);
    this.heading = s.heading;
    this.speed = s.speed;
    this.targetSeg = s.targetSeg;
    this.stamina = s.stamina;
    this.exhausted = s.exhausted;
    if (Math.abs(this.boost - s.boost) > 0.4) this.boost = s.boost;
    this.sprinting = s.sprinting;
    this.onGround = s.onGround;
    this.inWater = s.inWater;
    if (s.dead && !this.dead) this.dead = true;
    if (this.onGround && !wasGround) this.squash = 0.5;
    const moved = Math.hypot(p.x - ox, p.z - oz);
    this.actualSpeed = lerp(this.actualSpeed, Math.min(14, moved / Math.max(dt, 1e-3)), 1 - Math.exp(-dt * 12));
    this._animate(dt);
    return ev;
  }

  // Maulposition (zum Fressen)
  mouth(out) {
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
    return out.set(this.pos.x + fx * 1.15, this.pos.y + BODY_H + 0.33, this.pos.z + fz * 1.15);
  }

  // Kopf trifft eigenen Körper ab Segment 4? Gibt Index zurück oder -1.
  checkSelf() {
    const n = this.nSeg;
    if (n < 6) return -1;
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
    const hx = this.pos.x + fx * 0.8, hy = this.pos.y + BODY_H + 0.35, hz = this.pos.z + fz * 0.8;
    const sp = this.segPos;
    const R = 0.62;
    for (let i = 4; i < n; i++) {
      const dx = sp[i * 3] - hx, dz = sp[i * 3 + 2] - hz;
      if (dx * dx + dz * dz > R * R) continue;
      const dy = this.segCY[i] - hy;
      if (dx * dx + dy * dy + dz * dz < R * R) return i;
    }
    return -1;
  }

  update(dt, inp, world) {
    const ev = this.ev;
    ev.jumped = ev.landed = ev.splash = ev.bumped = ev.launch = false;
    this.time += dt;
    const p = this.pos;

    // --- Steuerung -> Zielgeschwindigkeit + Drehung
    let throttle = 0, turnCmd = 0;
    if (!this.dead) {
      if (inp.dirMag > 0.12) {
        const desired = Math.atan2(-inp.dirZ, inp.dirX);
        const diff = wrapAngle(desired - this.heading);
        turnCmd = clamp(diff * 3, -1, 1);
        throttle = Math.min(1, inp.dirMag) * (Math.abs(diff) > 2.3 ? 0.6 : 1);
      } else {
        turnCmd = inp.turn;
        throttle = inp.forward ? 1 : inp.brake ? 0 : inp.turn ? 0.45 : 0;
      }
    }
    const wantSprint = inp.sprint && !this.exhausted && this.stamina > 0.02 && throttle > 0.5;
    let maxV = wantSprint ? SPRINT : WALK;
    if (this.boost > 0) maxV *= 1.45;
    this.inWater = world.inWater(p.x, p.z) && p.y < 0.05;
    if (this.inWater) maxV *= 0.5;
    const targetV = maxV * throttle;
    const acc = this.onGround ? (targetV > this.speed ? 11 : 16) : 2.5;
    this.speed += clamp(targetV - this.speed, -acc * dt, acc * dt);

    const omegaMax = Math.min(4.2, 0.9 + this.speed * 0.6) * (this.onGround ? 1 : 0.6);
    this.omega = turnCmd * omegaMax;
    this.heading = wrapAngle(this.heading + this.omega * dt);
    const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);

    // --- Horizontale Bewegung + Kollision
    const ox = p.x, oz = p.z;
    let nx = p.x + fx * this.speed * dt;
    let nz = p.z + fz * this.speed * dt;
    let r = world.resolve(nx + fx * 0.75, nz + fz * 0.75, p.y, 0.32);
    let hit = r.hit;
    nx = r.x - fx * 0.75;
    nz = r.z - fz * 0.75;
    r = world.resolve(nx, nz, p.y, 0.42);
    hit = hit || r.hit;
    nx = r.x;
    nz = r.z;
    const gBlock = Math.max(world.heightAt(nx, nz), world.heightAt(nx + fx * 0.7, nz + fz * 0.7));
    if (gBlock - p.y > STEP_UP) {
      nx = ox; nz = oz;
      this.speed *= 0.4;
      hit = true;
    }
    if (hit && this.speed > 3) ev.bumped = true;
    p.x = nx;
    p.z = nz;

    // --- Vertikal: Boden folgen, Sprung, Schwerkraft
    const g = world.heightAt(nx, nz);
    // Sprung puffern: kurz vor dem Landen drücken zählt auch
    if (inp.jump && !this.dead) this.jumpBuf = 0.15;
    else this.jumpBuf -= dt;
    if (this.onGround) this.coyote = 0.1;
    else this.coyote -= dt;
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vy = JUMP_V + Math.max(0, this.groundVy);
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuf = 0;
      ev.jumped = true;
    }
    if (this.onGround) {
      if (g < p.y - 0.3) {
        this.onGround = false; // über die Kante -> fliegen
        this.vy = Math.max(0, this.groundVy) + (this.groundVy > 0.5 ? 1.5 : 0);
        if (this.vy > 1) ev.launch = true;
      } else {
        const slopeVy = (g - p.y) / Math.max(dt, 1e-3);
        this.groundVy = lerp(this.groundVy, slopeVy, 1 - Math.exp(-dt * 10));
        p.y = g;
        this.vy = 0;
      }
    }
    if (!this.onGround) {
      this.vy -= GRAVITY * dt;
      p.y += this.vy * dt;
      if (p.y <= g && this.vy <= 0) {
        if (this.vy < -6) ev.landed = true;
        this.squash = Math.min(1, -this.vy / 14);
        p.y = g;
        this.vy = 0;
        this.groundVy = 0;
        this.onGround = true;
        if (world.inWater(p.x, p.z)) ev.splash = true;
      }
    }
    const wasWater = this._wasWater;
    this._wasWater = world.inWater(p.x, p.z);
    if (this._wasWater && !wasWater && this.speed > 2) ev.splash = true;

    const moved = Math.hypot(p.x - ox, p.z - oz);
    this.actualSpeed = lerp(this.actualSpeed, moved / Math.max(dt, 1e-3), 1 - Math.exp(-dt * 12));

    // --- Ausdauer
    this.sprinting = wantSprint && this.actualSpeed > 2;
    if (this.sprinting) {
      this.stamina -= dt * 0.28;
      this.regenDelay = 0.7;
      if (this.stamina <= 0) { this.stamina = 0; this.exhausted = true; }
    } else {
      this.regenDelay -= dt;
      if (this.regenDelay <= 0) this.stamina = Math.min(1, this.stamina + dt * 0.2);
      if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    }

    this._animate(dt);
    return ev;
  }

  // Pfad, Wachsen, Timer, Gangart, dann Körper legen und zeichnen (lokal + online gleich)
  _animate(dt) {
    const p = this.pos;
    // --- Pfad aufzeichnen
    const last = this.path[this.path.length - 1];
    const dx = p.x - last.x, dy = p.y - last.y, dz = p.z - last.z;
    if (dx * dx + dy * dy + dz * dz > PATH_STEP * PATH_STEP) this.path.push({ x: p.x, y: p.y, z: p.z });

    // --- Wachsen, Timer
    this.seg = Math.min(this.targetSeg, this.seg + dt * 6);
    this.boost = Math.max(0, this.boost - dt);
    this.wagBoost = Math.max(0, this.wagBoost - dt);
    this.eatT = Math.max(0, this.eatT - dt);
    this.squash = Math.max(0, this.squash - dt * 4);
    if (this.dead) this.roll = Math.min(1.45, this.roll + dt * 4);

    // --- Gangart
    const v = this.actualSpeed;
    this.gallop = lerp(this.gallop, v > 6.6 ? 1 : 0, Math.min(1, dt * 5));
    this.gait += v * dt * lerp(2.9, 2.0, this.gallop);
    this.amp = lerp(this.amp, this.dead ? 0 : Math.min(1, v / 3.2), Math.min(1, dt * 8));
    this.air = lerp(this.air, this.onGround ? 0 : 1, Math.min(1, dt * 10));

    this._layout();
    this._render(dt);
  }

  // Segmente entlang des Pfades verteilen
  _layout() {
    const n = Math.min(MAX_SEG, Math.max(2, Math.ceil(this.seg)));
    this.nSeg = n;
    const P = this.path;
    const sp = this.segPos;
    let px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    sp[0] = px; sp[1] = py; sp[2] = pz;
    let idx = P.length - 1, acc = 0, i = 1;
    const lastDist = Math.max(SPACING * (n - 2) + 1e-4, (this.seg - 1) * SPACING);
    while (i < n) {
      const tgt = i === n - 1 ? lastDist : i * SPACING;
      if (idx < 0) {
        // Pfad zu kurz: gerade nach hinten verlängern
        const a = P[0], b = P[1] || { x: a.x + Math.cos(this.heading), y: a.y, z: a.z - Math.sin(this.heading) };
        let ex = a.x - b.x, ez = a.z - b.z;
        const l = Math.hypot(ex, ez) || 1;
        ex /= l; ez /= l;
        P.unshift({ x: a.x + ex * 2, y: a.y, z: a.z + ez * 2 });
        idx = 0;
      }
      const q = P[idx];
      const dx = q.x - px, dy = q.y - py, dz = q.z - pz;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L > 1e-6 && acc + L >= tgt) {
        const t = (tgt - acc) / L;
        sp[i * 3] = px + dx * t;
        sp[i * 3 + 1] = py + dy * t;
        sp[i * 3 + 2] = pz + dz * t;
        i++;
        continue;
      }
      acc += L;
      px = q.x; py = q.y; pz = q.z;
      idx--;
    }
    // Alten Pfad abschneiden (mit Reserve zum Wachsen)
    if (idx > 260) P.splice(0, idx - 130);

    // Ausrichtung pro Segment (Gier + Neigung, Roll beim Umfallen)
    const roll = this.roll;
    for (let k = 0; k < n; k++) {
      let dx, dy, dz;
      if (k === 0) {
        dx = Math.cos(this.heading);
        dz = -Math.sin(this.heading);
        dy = (sp[1] - sp[4]) / SPACING;
      } else {
        dx = sp[(k - 1) * 3] - sp[k * 3];
        dy = sp[(k - 1) * 3 + 1] - sp[k * 3 + 1];
        dz = sp[(k - 1) * 3 + 2] - sp[k * 3 + 2];
      }
      const yaw = Math.atan2(-dz, dx);
      const pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.7, 0.7);
      _e.set(roll, yaw, pitch, 'YZX');
      this.segQ[k].setFromEuler(_e);
    }
  }

  _render(dt) {
    const n = this.nSeg;
    const sp = this.segPos;
    const amp = this.amp, gal = this.gallop, ph = this.gait;
    const sq = this.squash;
    const breathe = Math.sin(this.time * 2.4) * 0.008;

    // Körper + dunklerer Rücken
    const R = 0.41 * (1 + sq * 0.06), RY = (0.41 + breathe) * (1 - sq * 0.12);
    for (let i = 0; i < n; i++) {
      const bob = Math.abs(Math.sin(ph)) * 0.035 * amp * (1 - gal) + Math.sin(ph - i * 0.35) * 0.07 * gal * amp;
      this.segCY[i] = sp[i * 3 + 1] + BODY_H + bob - sq * 0.08 - this.roll * 0.25;
    }
    for (let i = 0; i < n; i++) {
      const q = this.segQ[i];
      _v.set(sp[i * 3], this.segCY[i], sp[i * 3 + 2]);
      const big = i === 0 ? 1.05 : 1;
      _s.set(R * big, RY * big, R * big);
      _m.compose(_v, q, _s);
      this.bodyMesh.setMatrixAt(i, _m);
      if (i < n - 1) {
        // Zylinder von Segment i nach i+1
        const bx = sp[(i + 1) * 3], by = this.segCY[i + 1], bz = sp[(i + 1) * 3 + 2];
        _v2.set(_v.x - bx, _v.y - by, _v.z - bz);
        const len = _v2.length();
        _q.setFromUnitVectors(X_AXIS, _v2.divideScalar(len || 1));
        if (this.roll) _q.multiply(_q2.setFromAxisAngle(X_AXIS, this.roll));
        _v.set((_v.x + bx) / 2, (_v.y + by) / 2, (_v.z + bz) / 2);
        _s.set(len, RY, R);
        _m.compose(_v, _q, _s);
        this.tubeMesh.setMatrixAt(i, _m);
        _v2.set(0, 0.13, 0).applyQuaternion(_q).add(_v);
        _s.set(len, 0.3, 0.32);
        _m.compose(_v2, _q, _s);
        this.saddleTube.setMatrixAt(i, _m);
        this.tubeQ[i].copy(_q);
      }
    }
    // Rücken-Kugeln mit derselben Ausrichtung wie die Zylinder (sonst Flecken)
    for (let i = 0; i < n; i++) {
      const q = this.tubeQ[Math.min(i, n - 2)];
      _v.set(sp[i * 3], this.segCY[i], sp[i * 3 + 2]);
      _v2.set(0, 0.13, 0).applyQuaternion(q).add(_v);
      _s.set(0.32, 0.3, 0.32);
      _m.compose(_v2, q, _s);
      this.saddleMesh.setMatrixAt(i, _m);
    }
    for (const m of [this.bodyMesh, this.saddleMesh]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
    for (const m of [this.tubeMesh, this.saddleTube]) { m.count = n - 1; m.instanceMatrix.needsUpdate = true; }

    // Beinpaare: vorne, ggf. Mitte (ab 16 Segmenten), hinten
    const mid = clamp(Math.floor((n - 8) / 8), 0, MAX_MID_PAIRS);
    const pairs = this._pairs || (this._pairs = []);
    pairs.length = 0;
    pairs.push(0, 0.12);
    for (let k = 1; k <= mid; k++) pairs.push(Math.round((k * (n - 1)) / (mid + 1)), 0);
    pairs.push(n - 1, -0.04);
    const pairOff = lerp(Math.PI, 1.3, gal);
    const lrOff = lerp(Math.PI, 0.35, gal);
    const nPairs = pairs.length / 2;
    let li = 0;
    for (let k = 0; k < nPairs; k++) {
      const si = pairs[k * 2], off = pairs[k * 2 + 1];
      const q = this.segQ[si];
      const isFront = k === 0, isRear = k === nPairs - 1;
      for (const sd of [-1, 1]) {
        const phase = ph + k * pairOff + (sd > 0 ? lrOff : 0);
        let a = Math.sin(phase) * 0.62 * amp;
        // in der Luft: Vorderbeine nach vorn, Hinterbeine nach hinten
        const airPose = isFront ? 0.7 : isRear ? -0.7 : 0.2 * sd;
        a = lerp(a, airPose, this.air);
        if (this.dead) a = Math.sin(this.time * 3 + k + sd) * 0.15; // Beine zappeln leicht
        const lift = Math.max(0, Math.cos(phase)) * 0.09 * amp * (1 - this.air);
        _v.set(sp[si * 3], this.segCY[si], sp[si * 3 + 2]);
        _v2.set(off, -0.2, sd * 0.25).applyQuaternion(q);
        const hx = _v.x + _v2.x, hy = _v.y + _v2.y + lift, hz = _v.z + _v2.z;
        _q.setFromAxisAngle(Z_AXIS, a).premultiply(q);
        // Bein
        _v2.set(0, -0.21, 0).applyQuaternion(_q);
        _v.set(hx + _v2.x, hy + _v2.y, hz + _v2.z);
        _s.set(1, 1, 1);
        _m.compose(_v, _q, _s);
        this.legMesh.setMatrixAt(li, _m);
        // Pfote (vorne leicht nach außen gedreht)
        _v2.set(0.04, -0.43, 0).applyQuaternion(_q);
        _v.set(hx + _v2.x, hy + _v2.y, hz + _v2.z);
        _q2.setFromAxisAngle(THREE.Object3D.DefaultUp, isFront ? -sd * 0.28 : 0).premultiply(q);
        _s.set(0.15, 0.075, 0.12);
        _m.compose(_v, _q2, _s);
        this.pawMesh.setMatrixAt(li, _m);
        // Krallen
        for (let c = -1; c <= 1; c++) {
          _v2.set(0.13, -0.025, c * 0.05).applyQuaternion(_q2).add(_v);
          _s.set(0.065, 0.022, 0.022);
          _m.compose(_v2, _q2, _s);
          this.clawMesh.setMatrixAt(li * 3 + c + 1, _m);
        }
        li++;
      }
    }
    this.legMesh.count = li;
    this.pawMesh.count = li;
    this.clawMesh.count = li * 3;
    this.legMesh.instanceMatrix.needsUpdate = true;
    this.pawMesh.instanceMatrix.needsUpdate = true;
    this.clawMesh.instanceMatrix.needsUpdate = true;

    // Vorderteil + Kopf
    const f = this.front;
    f.position.set(sp[0], this.segCY[0], sp[2]);
    f.quaternion.copy(this.segQ[0]);
    const h = this.head;
    const idle = this.amp < 0.15 && !this.dead ? 1 : 0;
    const look = clamp(this.omega * 0.12, -0.35, 0.35) + Math.sin(this.time * 0.9) * 0.3 * idle;
    let nod = Math.sin(ph * 2) * 0.04 * amp + Math.sin(this.time * 6.5) * 0.03 * idle * Math.max(0, Math.sin(this.time * 0.6));
    if (this.eatT > 0) nod -= Math.sin((this.eatT / 0.35) * Math.PI) * 0.35;
    nod += this.air * 0.15;
    h.position.y = this.headBase.y + Math.sin(ph * 2) * 0.025 * amp;
    h.rotation.set(this.dead ? Math.sin(this.time * 9) * 0.15 : 0, look, nod);
    this.tongue.visible = this.eatT > 0 || this.sprinting;

    // Ohren: Feder-Physik, angetrieben von der Beschleunigung des Kopfes
    f.updateMatrixWorld(true);
    h.getWorldPosition(_v);
    if (!this._headInit || dt <= 0) {
      this._prevHead.copy(_v);
      this._headVel.set(0, 0, 0);
      this._acc.set(0, 0, 0);
      this._headInit = true;
    } else {
      _v2.copy(_v).sub(this._prevHead).divideScalar(dt);
      const ax = (_v2.x - this._headVel.x) / dt, ay = (_v2.y - this._headVel.y) / dt, az = (_v2.z - this._headVel.z) / dt;
      this._acc.set(clamp(ax, -80, 80), clamp(ay, -80, 80), clamp(az, -80, 80)).multiplyScalar(0.5).add(_s.copy(this._acc).multiplyScalar(0.5));
      this._headVel.copy(_v2);
      this._prevHead.copy(_v);
    }
    if (dt > 0) {
      h.getWorldQuaternion(_q).invert();
      _v2.set(-this._acc.x, -9.8 - this._acc.y, -this._acc.z).applyQuaternion(_q); // effektive Schwerkraft im Kopf-System
      const gy = -_v2.y;
      const lift = clamp((6 - gy) / 10, 0, 1) * 1.3;
      for (const e of this.ears) {
        const tz = clamp(Math.atan2(_v2.x, Math.max(gy, 3)), -1.2, 1.2);
        let tx = Math.atan2(-_v2.z, Math.max(gy, 3)) - e.sd * lift;
        tx = e.sd > 0 ? clamp(tx, -1.4, 0.1) : clamp(tx, -0.1, 1.4);
        const k = 140, c = 7;
        e.vz += (k * (tz - e.rz) - c * e.vz) * dt;
        e.vx += (k * (tx - e.rx) - c * e.vx) * dt;
        e.rz += e.vz * dt;
        e.rx += e.vx * dt;
        e.pivot.rotation.set(e.rx, 0, e.rz);
      }
    }

    // Schwanz am letzten Segment
    const L = n - 1;
    const qL = this.segQ[L];
    _v2.set(-0.42, 0.13, 0).applyQuaternion(qL);
    this.tail.position.set(sp[L * 3] + _v2.x, this.segCY[L] + _v2.y, sp[L * 3 + 2] + _v2.z);
    this.tail.quaternion.copy(qL);
    const happy = this.wagBoost > 0;
    const freq = this.dead ? 0 : happy ? 26 : this.amp > 0.2 ? 11 : 8;
    const wamp = this.dead ? 0 : happy ? 0.8 : 0.45;
    this.wagPh += dt * freq;
    this.wag.rotation.set(0, Math.sin(this.wagPh) * wamp, 0);
    this.tailMesh.rotation.z = this.dead ? 1.9 : lerp(0.95, 1.25, this.gallop) + this.air * 0.3;
  }
}
