// Garten-Welt: Boden, Teich, Rampen, Hundehütte, Zaun, Pflanzen, Licht.
// Liefert außerdem Bodenhöhe und einfache Kreis-/Box-Kollision.
import * as THREE from 'three';

export const HALF = 50; // Zaun bei ±50

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const RAMPS = [
  { x: -4, z: 16, rot: 0, len: 4.5, w: 3, h: 1.3, plat: 0.3, double: false },
  { x: -27, z: -18, rot: 0.6, len: 4, w: 3.2, h: 1.1, plat: 3, double: true },
  { x: 30, z: 22, rot: -2.4, len: 4.5, w: 3, h: 1.4, plat: 0.3, double: false },
  { x: -36, z: 10, rot: 1.9, len: 3.5, w: 2.8, h: 0.9, plat: 2.5, double: true },
  { x: 10, z: 36, rot: 3.0, len: 5, w: 3.4, h: 1.6, plat: 0.3, double: false },
  { x: 34, z: -36, rot: 2.2, len: 4, w: 3, h: 1.0, plat: 2, double: true },
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rnd = mulberry32(20261106);
    this.circles = []; // {x,z,r,h}
    this.boxes = []; // {x0,x1,z0,z1,h}
    this.foliage = []; // Baumkronen, damit die Kamera nicht im Laub steckt
    this.ramps = [];
    this.noBuild = [{ x: 0, z: 0, r: 8 }];
    this.pond = { x: 17, z: -15, rx: 10, rz: 7, depth: 0.55, waterY: -0.14 };
    this.clouds = [];
    this.lilies = [];
    this._res = { x: 0, z: 0, hit: false };

    this._lights();
    this._ramps();
    this._ground();
    this._water();
    this._doghouse();
    this._fence();
    this._vegetation();
    this._clouds();
  }

  // ---------- Abfragen ----------
  pondDist(x, z) {
    const p = this.pond;
    const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz;
    return Math.sqrt(dx * dx + dz * dz); // < 1 = im Teich
  }
  pondHeight(x, z) {
    return -this.pond.depth * smoothstep(1.0, 0.72, this.pondDist(x, z));
  }
  inWater(x, z) {
    return this.pondDist(x, z) < 0.9;
  }
  rampHeight(r, x, z) {
    const dx = x - r.x, dz = z - r.z;
    const lx = dx * r.c - dz * r.s;
    const lz = dx * r.s + dz * r.c;
    if (lz < -r.w / 2 || lz > r.w / 2 || lx < 0 || lx > r.total) return -Infinity;
    if (lx < r.len) return (r.h * lx) / r.len;
    if (lx <= r.len + r.plat) return r.h;
    return r.h * (1 - (lx - r.len - r.plat) / r.len);
  }
  heightAt(x, z) {
    let h = this.pondHeight(x, z);
    for (const r of this.ramps) {
      const v = this.rampHeight(r, x, z);
      if (v > h) h = v;
    }
    return h;
  }

  // Schiebt einen Kreis (Radius r, Fußhöhe y) aus Hindernissen heraus.
  resolve(x, z, y, r) {
    let hit = false;
    for (const c of this.circles) {
      if (y > c.h - 0.05) continue;
      const dx = x - c.x, dz = z - c.z, rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        x += (dx / d) * (rr - d);
        z += (dz / d) * (rr - d);
        hit = true;
      }
    }
    for (const b of this.boxes) {
      if (y > b.h) continue;
      const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          const l = x - b.x0, rt = b.x1 - x, t = z - b.z0, bt = b.z1 - z;
          const m = Math.min(l, rt, t, bt);
          if (m === l) x = b.x0 - r;
          else if (m === rt) x = b.x1 + r;
          else if (m === t) z = b.z0 - r;
          else z = b.z1 + r;
        }
        hit = true;
      }
    }
    const lim = HALF - 0.8;
    if (x < -lim) { x = -lim; hit = true; }
    if (x > lim) { x = lim; hit = true; }
    if (z < -lim) { z = -lim; hit = true; }
    if (z > lim) { z = lim; hit = true; }
    const o = this._res;
    o.x = x; o.z = z; o.hit = hit;
    return o;
  }

  // Liegt der Punkt in einer Baumkrone?
  inFoliage(x, z) {
    for (const f of this.foliage) {
      const dx = x - f.x, dz = z - f.z;
      if (dx * dx + dz * dz < f.r * f.r) return true;
    }
    return false;
  }

  // Freier Boden für Würste
  isFree(x, z, m) {
    if (Math.abs(x) > HALF - 3 || Math.abs(z) > HALF - 3) return false;
    if (this.pondDist(x, z) < 1.12) return false;
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z, rr = c.r + m;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    for (const b of this.boxes) {
      if (x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) return false;
    }
    return true;
  }

  _canBuild(x, z, r) {
    if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2) return false;
    if (this.pondDist(x, z) < 1.3) return false;
    for (const n of this.noBuild) {
      const dx = x - n.x, dz = z - n.z;
      if (dx * dx + dz * dz < (n.r + r) * (n.r + r)) return false;
    }
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z, rr = r + c.r + 1.6;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  }
  _place(r, tries = 80) {
    for (let i = 0; i < tries; i++) {
      const x = (this.rnd() * 2 - 1) * (HALF - 3);
      const z = (this.rnd() * 2 - 1) * (HALF - 3);
      if (this._canBuild(x, z, r)) return [x, z];
    }
    return null;
  }

  // ---------- Aufbau ----------
  _lights() {
    const s = this.scene;
    s.background = new THREE.Color(0xa9d9f2);
    s.fog = new THREE.Fog(0xa9d9f2, 50, 140);
    s.add(new THREE.HemisphereLight(0xe8f6ff, 0x5f7d3b, 0.72));
    const sun = new THREE.DirectionalLight(0xfff0d4, 0.95);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -26; c.right = 26; c.top = 26; c.bottom = -26; c.near = 1; c.far = 100;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    s.add(sun, sun.target);
    this.sun = sun;
    this.sunOffset = new THREE.Vector3(22, 36, 14);
  }
  followSun(p) {
    this.sun.position.set(p.x, 0, p.z).add(this.sunOffset);
    this.sun.target.position.set(p.x, 0, p.z);
    this.sun.target.updateMatrixWorld();
  }

  _ground() {
    const size = 180, seg = 130;
    let g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.pondHeight(pos.getX(i), pos.getZ(i)));
    g = g.toNonIndexed();
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      const d = this.pondDist(cx, cz);
      const n = (Math.sin(cx * 0.13) + Math.sin(cz * 0.11 + 1.3) + Math.sin((cx + cz) * 0.07)) / 3;
      const j = (this.rnd() - 0.5) * 0.035;
      if (d < 0.95) c.setHSL(0.09, 0.35, 0.24 + d * 0.06 + j);
      else if (d < 1.2) c.setHSL(0.11, 0.42, 0.55 + j);
      else if (Math.abs(cx) > HALF + 1 || Math.abs(cz) > HALF + 1) c.setHSL(0.2 + n * 0.02, 0.4, 0.36 + n * 0.04 + j);
      else c.setHSL(0.25 + n * 0.035, 0.5, 0.37 + n * 0.05 + j);
      for (let k = 0; k < 3; k++) c.toArray(col, (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  _water() {
    const p = this.pond;
    const geo = new THREE.CircleGeometry(1, 40);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x3d9fd2, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.1,
    }));
    water.scale.set(p.rx * 1.02, 1, p.rz * 1.02);
    water.position.set(p.x, p.waterY, p.z);
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;

    // Seerosen
    const padGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.04, 7);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x4f9a3a, flatShading: true });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xf6a8c8, flatShading: true });
    const flowerGeo = new THREE.IcosahedronGeometry(0.16, 0);
    for (let i = 0; i < 8; i++) {
      const a = this.rnd() * Math.PI * 2, rr = 0.25 + this.rnd() * 0.5;
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(p.x + Math.cos(a) * p.rx * rr, p.waterY + 0.03, p.z + Math.sin(a) * p.rz * rr);
      pad.rotation.y = this.rnd() * 6;
      pad.receiveShadow = true;
      if (this.rnd() < 0.5) {
        const f = new THREE.Mesh(flowerGeo, flowerMat);
        f.position.set(0.1, 0.1, 0);
        pad.add(f);
      }
      this.scene.add(pad);
      this.lilies.push({ m: pad, ph: this.rnd() * 6 });
    }

    // Schilf + Steine am Ufer
    const reedGeo = new THREE.CylinderGeometry(0.03, 0.05, 1.3, 4);
    reedGeo.translate(0, 0.65, 0);
    const reeds = new THREE.InstancedMesh(reedGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }), 90);
    const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
    const stones = new THREE.InstancedMesh(stoneGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }), 26);
    const d = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < 90; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = 0.9 + this.rnd() * 0.18;
      const x = p.x + Math.cos(a) * p.rx * rr, z = p.z + Math.sin(a) * p.rz * rr;
      d.position.set(x, this.pondHeight(x, z), z);
      d.rotation.set((this.rnd() - 0.5) * 0.3, 0, (this.rnd() - 0.5) * 0.3);
      d.scale.setScalar(0.6 + this.rnd() * 0.7);
      d.updateMatrix();
      reeds.setMatrixAt(i, d.matrix);
      reeds.setColorAt(i, c.setHSL(0.18 + this.rnd() * 0.08, 0.45, 0.35 + this.rnd() * 0.1));
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + this.rnd() * 0.2;
      const rr = 1.04 + this.rnd() * 0.08;
      const x = p.x + Math.cos(a) * p.rx * rr, z = p.z + Math.sin(a) * p.rz * rr;
      const s = 0.2 + this.rnd() * 0.25;
      d.position.set(x, 0.02, z);
      d.rotation.set(this.rnd() * 3, this.rnd() * 3, 0);
      d.scale.set(s, s * 0.6, s);
      d.updateMatrix();
      stones.setMatrixAt(i, d.matrix);
      stones.setColorAt(i, c.setHSL(0.08, 0.06, 0.55 + this.rnd() * 0.15));
    }
    for (const im of [reeds, stones]) { im.castShadow = true; im.frustumCulled = false; this.scene.add(im); }
  }

  _ramps() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc28a4e, flatShading: true, roughness: 0.85 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xf2e6c8, flatShading: true });
    for (const def of RAMPS) {
      const r = { ...def, c: Math.cos(def.rot), s: Math.sin(def.rot) };
      r.total = def.double ? 2 * def.len + def.plat : def.len + def.plat;
      this.ramps.push(r);
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.lineTo(r.len, r.h);
      sh.lineTo(r.len + r.plat, r.h);
      sh.lineTo(r.total, 0); // Doppelrampe: Abfahrt, Kicker: senkrechte Kante
      sh.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: r.w, bevelEnabled: false });
      g.translate(0, 0, -r.w / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(r.x, 0, r.z);
      m.rotation.y = r.rot;
      m.castShadow = m.receiveShadow = true;
      // Helle Kantenstreifen
      for (const sd of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(r.len, r.h), 0.06, 0.18), stripe);
        bar.position.set(r.len / 2, r.h / 2 + 0.03, sd * (r.w / 2 - 0.1));
        bar.rotation.z = Math.atan2(r.h, r.len);
        m.add(bar);
      }
      this.scene.add(m);
      const mid = r.total / 2;
      this.noBuild.push({ x: r.x + r.c * mid, z: r.z - r.s * mid, r: mid + 2 });
    }
  }

  _doghouse() {
    const X = -20, Z = 18;
    const grp = new THREE.Group();
    grp.position.set(X, 0, Z);
    const wall = new THREE.MeshStandardMaterial({ color: 0xbf4b34, flatShading: true, roughness: 0.85 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x5d4330, flatShading: true, roughness: 0.9 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf4ead8, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 1 });
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.castShadow = m.receiveShadow = true;
      grp.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(3, 2, 3.2), wall, 0, 1, 0);
    // Giebel (Dreiecksprisma)
    const tri = new THREE.Shape();
    tri.moveTo(-1.6, 0); tri.lineTo(1.6, 0); tri.lineTo(0, 1.1); tri.lineTo(-1.6, 0);
    const gg = new THREE.ExtrudeGeometry(tri, { depth: 3, bevelEnabled: false });
    gg.translate(0, 0, -1.5);
    gg.rotateY(Math.PI / 2);
    add(gg, wall, 0, 2, 0);
    for (const sd of [-1, 1]) add(new THREE.BoxGeometry(3.6, 0.16, 2.1), roof, 0, 2.62, sd * 0.84, sd * 0.6);
    add(new THREE.BoxGeometry(3.7, 0.18, 0.18), trim, 0, 3.15, 0);
    add(new THREE.BoxGeometry(0.06, 1.25, 1.1), dark, 1.51, 0.62, 0);
    add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16), dark, 1.51, 1.24, 0, 0, 0, Math.PI / 2);
    // Namensschild
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 80;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#f4ead8'; ctx.fillRect(0, 0, 256, 80);
    ctx.fillStyle = '#5d3a22'; ctx.font = 'bold 52px Georgia, serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('WALDI', 128, 44);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.38), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv) }));
    sign.position.set(1.54, 1.95, 0);
    sign.rotation.y = Math.PI / 2;
    grp.add(sign);
    // Napf + Knochen
    const bowl = add(new THREE.CylinderGeometry(0.38, 0.3, 0.2, 14), new THREE.MeshStandardMaterial({ color: 0xd8403a, roughness: 0.4 }), 2.6, 0.1, 1.3);
    const kib = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, flatShading: true });
    for (let i = 0; i < 6; i++) {
      const k = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), kib);
      k.position.set((this.rnd() - 0.5) * 0.4, 0.1, (this.rnd() - 0.5) * 0.4);
      bowl.add(k);
    }
    const bone = new THREE.Group();
    const bw = new THREE.MeshStandardMaterial({ color: 0xf7f1e3, roughness: 0.6 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), bw);
    shaft.rotation.z = Math.PI / 2;
    bone.add(shaft);
    for (const sx of [-0.3, 0.3]) for (const sz of [-0.07, 0.07]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bw);
      b.position.set(sx, 0, sz);
      bone.add(b);
    }
    bone.position.set(3.2, 0.1, -1.6);
    bone.rotation.y = 0.7;
    bone.traverse((o) => (o.castShadow = true));
    grp.add(bone);
    this.scene.add(grp);
    this.boxes.push({ x0: X - 1.6, x1: X + 1.6, z0: Z - 1.7, z1: Z + 1.7, h: 3.3 });
    this.noBuild.push({ x: X + 1, z: Z, r: 5 });
  }

  _fence() {
    const step = 0.6, perSide = Math.round((HALF * 2) / step);
    const n = perSide * 4;
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.8, flatShading: true });
    const picketGeo = new THREE.BoxGeometry(0.14, 1.05, 0.05);
    picketGeo.translate(0, 0.52, 0);
    const capGeo = new THREE.ConeGeometry(0.1, 0.18, 4);
    capGeo.rotateY(Math.PI / 4);
    capGeo.translate(0, 1.13, 0);
    const pickets = new THREE.InstancedMesh(picketGeo, mat, n);
    const caps = new THREE.InstancedMesh(capGeo, mat, n);
    const d = new THREE.Object3D();
    let i = 0;
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < perSide; k++) {
        const t = -HALF + (k + 0.5) * step;
        if (side === 0) d.position.set(t, 0, -HALF);
        if (side === 1) d.position.set(t, 0, HALF);
        if (side === 2) d.position.set(-HALF, 0, t);
        if (side === 3) d.position.set(HALF, 0, t);
        d.rotation.y = side < 2 ? 0 : Math.PI / 2;
        d.updateMatrix();
        pickets.setMatrixAt(i, d.matrix);
        caps.setMatrixAt(i, d.matrix);
        i++;
      }
    }
    for (const im of [pickets, caps]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.scene.add(im); }
    const railGeo = new THREE.BoxGeometry(HALF * 2, 0.1, 0.06);
    for (const y of [0.35, 0.8]) {
      for (let side = 0; side < 4; side++) {
        const r = new THREE.Mesh(railGeo, mat);
        const o = side < 2 ? 0 : Math.PI / 2;
        r.rotation.y = o;
        const off = 0.06;
        if (side === 0) r.position.set(0, y, -HALF + off);
        if (side === 1) r.position.set(0, y, HALF - off);
        if (side === 2) r.position.set(-HALF + off, y, 0);
        if (side === 3) r.position.set(HALF - off, y, 0);
        r.castShadow = true;
        this.scene.add(r);
      }
    }
  }

  _vegetation() {
    const rnd = this.rnd;
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const white = (o = {}) => new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9, ...o });

    // --- Bäume (rund + Tannen), innen mit Kollision, außen nur Deko
    const trees = [];
    const want = [];
    for (let i = 0; i < 30; i++) want.push('round');
    for (let i = 0; i < 14; i++) want.push('pine');
    for (const type of want) {
      const s = 0.8 + rnd() * 0.6;
      const at = this._place(0.5 * s);
      if (!at) continue;
      trees.push({ type, x: at[0], z: at[1], s });
      this.circles.push({ x: at[0], z: at[1], r: 0.42 * s + 0.08, h: 99 });
      this.foliage.push({ x: at[0], z: at[1], r: 1.9 * s });
    }
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, rr = HALF + 6 + rnd() * 28;
      trees.push({ type: rnd() < 0.5 ? 'round' : 'pine', x: Math.cos(a) * rr, z: Math.sin(a) * rr, s: 0.9 + rnd() * 0.8 });
    }
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const blobGeo = new THREE.IcosahedronGeometry(1, 0);
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    const nRound = trees.filter((t) => t.type === 'round').length;
    const nPine = trees.length - nRound;
    const trunks = new THREE.InstancedMesh(trunkGeo, white(), trees.length);
    const blobs = new THREE.InstancedMesh(blobGeo, white(), nRound * 3);
    const cones = new THREE.InstancedMesh(coneGeo, white(), nPine * 3);
    let ti = 0, bi = 0, ci = 0;
    for (const t of trees) {
      const s = t.s;
      const th = t.type === 'round' ? 2.0 * s : 1.3 * s;
      d.position.set(t.x, 0, t.z);
      d.rotation.set(0, rnd() * 6, 0);
      d.scale.set(s, th, s);
      d.updateMatrix();
      trunks.setMatrixAt(ti, d.matrix);
      trunks.setColorAt(ti++, c.setHSL(0.07, 0.4, 0.26 + rnd() * 0.06));
      if (t.type === 'round') {
        const hue = 0.24 + rnd() * 0.08;
        const parts = [[0, th + 0.9 * s, 0, 1.45 * s], [0.8 * s, th + 0.4 * s, 0.3 * s, 0.95 * s], [-0.6 * s, th + 0.55 * s, -0.5 * s, 1.0 * s]];
        for (const [ox, oy, oz, r] of parts) {
          d.position.set(t.x + ox, oy, t.z + oz);
          d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
          d.scale.set(r, r * 0.9, r);
          d.updateMatrix();
          blobs.setMatrixAt(bi, d.matrix);
          blobs.setColorAt(bi++, c.setHSL(hue + (rnd() - 0.5) * 0.02, 0.5, 0.33 + rnd() * 0.07));
        }
      } else {
        const hue = 0.3 + rnd() * 0.05;
        for (let k = 0; k < 3; k++) {
          const r = (1.5 - k * 0.38) * s;
          d.position.set(t.x, th + k * 0.85 * s, t.z);
          d.rotation.set(0, rnd() * 6, 0);
          d.scale.set(r, 1.6 * s, r);
          d.updateMatrix();
          cones.setMatrixAt(ci, d.matrix);
          cones.setColorAt(ci++, c.setHSL(hue, 0.42, 0.25 + k * 0.03 + rnd() * 0.03));
        }
      }
    }
    for (const im of [trunks, blobs, cones]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.scene.add(im); }

    // --- Büsche (überspringbar) mit Beeren
    const bushGeo = new THREE.IcosahedronGeometry(1, 1);
    const bushData = [];
    for (let i = 0; i < 26; i++) {
      const s = 0.7 + rnd() * 0.5;
      const at = this._place(s);
      if (!at) continue;
      bushData.push({ x: at[0], z: at[1], s });
      this.circles.push({ x: at[0], z: at[1], r: s * 0.92, h: 1.0 * s });
    }
    const bushes = new THREE.InstancedMesh(bushGeo, white(), bushData.length * 2);
    const berries = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.08, 0), white({ roughness: 0.4 }), bushData.length * 6);
    let k = 0, bk = 0;
    for (const b of bushData) {
      const hue = 0.26 + rnd() * 0.06;
      const berry = rnd() < 0.5 ? 0.98 : rnd() < 0.5 ? 0.13 : 0.75;
      for (let j = 0; j < 2; j++) {
        const ox = j ? (rnd() - 0.5) * b.s : 0, oz = j ? (rnd() - 0.5) * b.s : 0;
        const sc = j ? b.s * 0.7 : b.s;
        d.position.set(b.x + ox, 0.3 * sc, b.z + oz);
        d.rotation.set(0, rnd() * 6, 0);
        d.scale.set(sc, sc * 0.75, sc);
        d.updateMatrix();
        bushes.setMatrixAt(k, d.matrix);
        bushes.setColorAt(k++, c.setHSL(hue, 0.48, 0.3 + rnd() * 0.06));
      }
      for (let j = 0; j < 6; j++) {
        const a = rnd() * Math.PI * 2, el = 0.2 + rnd() * 0.9;
        d.position.set(b.x + Math.cos(a) * Math.cos(el) * b.s * 0.95, 0.3 * b.s + Math.sin(el) * b.s * 0.72, b.z + Math.sin(a) * Math.cos(el) * b.s * 0.95);
        d.scale.setScalar(1);
        d.updateMatrix();
        berries.setMatrixAt(bk, d.matrix);
        berries.setColorAt(bk++, c.setHSL(berry, 0.75, 0.55));
      }
    }
    for (const im of [bushes, berries]) { im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; this.scene.add(im); }

    // --- Felsen
    const rockData = [];
    for (let i = 0; i < 12; i++) {
      const s = 0.5 + rnd() * 0.5;
      const at = this._place(s);
      if (!at) continue;
      rockData.push({ x: at[0], z: at[1], s });
      this.circles.push({ x: at[0], z: at[1], r: s * 0.85, h: s * 0.8 });
    }
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), white(), rockData.length);
    rockData.forEach((r, i) => {
      d.position.set(r.x, 0.15 * r.s, r.z);
      d.rotation.set(rnd() * 0.5, rnd() * 6, rnd() * 0.5);
      d.scale.set(r.s, r.s * 0.65, r.s * 0.9);
      d.updateMatrix();
      rocks.setMatrixAt(i, d.matrix);
      rocks.setColorAt(i, c.setHSL(0.1, 0.05, 0.5 + rnd() * 0.15));
    });
    rocks.castShadow = rocks.receiveShadow = true;
    rocks.frustumCulled = false;
    this.scene.add(rocks);

    // --- Gras-Büschel und Blumen (ohne Kollision, ohne Schatten)
    const blade = new THREE.ConeGeometry(0.05, 0.34, 3);
    blade.translate(0, 0.17, 0);
    const NG = 3000;
    const grass = new THREE.InstancedMesh(blade, white(), NG);
    let gi = 0;
    while (gi < NG) {
      const x = (rnd() * 2 - 1) * (HALF + 20), z = (rnd() * 2 - 1) * (HALF + 20);
      if (this.pondDist(x, z) < 1.05) continue;
      const hue = 0.24 + rnd() * 0.07;
      for (let j = 0; j < 3 && gi < NG; j++) {
        d.position.set(x + (rnd() - 0.5) * 0.25, 0, z + (rnd() - 0.5) * 0.25);
        d.rotation.set((rnd() - 0.5) * 0.6, rnd() * 6, (rnd() - 0.5) * 0.6);
        d.scale.setScalar(0.7 + rnd() * 0.8);
        d.updateMatrix();
        grass.setMatrixAt(gi, d.matrix);
        grass.setColorAt(gi++, c.setHSL(hue, 0.5, 0.33 + rnd() * 0.12));
      }
    }
    grass.frustumCulled = false;
    this.scene.add(grass);

    const NF = 420;
    const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), white({ roughness: 0.6 }), NF);
    const hues = [[0.15, 0.9, 0.6], [0, 0, 0.95], [0.92, 0.7, 0.72], [0.75, 0.5, 0.65], [0.02, 0.8, 0.55]];
    let fi = 0;
    while (fi < NF) {
      const cx = (rnd() * 2 - 1) * (HALF - 4), cz = (rnd() * 2 - 1) * (HALF - 4);
      if (this.pondDist(cx, cz) < 1.3) continue;
      const hsl = hues[Math.floor(rnd() * hues.length)];
      for (let j = 0; j < 14 && fi < NF; j++) {
        const x = cx + (rnd() - 0.5) * 4, z = cz + (rnd() - 0.5) * 4;
        if (this.pondDist(x, z) < 1.2) continue;
        d.position.set(x, 0.2 + rnd() * 0.12, z);
        d.rotation.set(rnd() * 3, rnd() * 3, 0);
        d.scale.set(1, 0.6, 1);
        d.updateMatrix();
        flowers.setMatrixAt(fi, d.matrix);
        flowers.setColorAt(fi++, c.setHSL(hsl[0], hsl[1], hsl[2]));
      }
    }
    flowers.frustumCulled = false;
    this.scene.add(flowers);
  }

  _clouds() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(this.rnd() * 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(geo, mat);
        const s = 2 + this.rnd() * 2.5;
        m.scale.set(s * 1.3, s * 0.7, s);
        m.position.set(j * 2.6 - n * 1.3, this.rnd() * 1.2, (this.rnd() - 0.5) * 2);
        g.add(m);
      }
      g.position.set((this.rnd() * 2 - 1) * 110, 32 + this.rnd() * 14, (this.rnd() * 2 - 1) * 110);
      this.scene.add(g);
      this.clouds.push({ g, v: 0.6 + this.rnd() * 0.8 });
    }
  }

  update(t, dt) {
    for (const c of this.clouds) {
      c.g.position.x += c.v * dt;
      if (c.g.position.x > 120) c.g.position.x = -120;
    }
    for (const l of this.lilies) l.m.position.y = this.pond.waterY + 0.03 + Math.sin(t * 1.3 + l.ph) * 0.02;
    this.water.position.y = this.pond.waterY + Math.sin(t * 0.8) * 0.01;
  }
}
