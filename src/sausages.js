// Würste: spawnen auf freiem Boden, schweben und drehen sich.
// normal (+1), gold (+3, selten), Wurstkette (+1 und Turbo).
import * as THREE from 'three';

const MIN_COUNT = 8;
const TARGET_COUNT = 11;
const MAX_LIST = 55;
const EAT_RADIUS = 1.05;
const ARC = 1.7;
const R = 0.42;

export class Sausages {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.list = [];
    this.timer = 0;
    this.nextId = 1;
    this.minCount = MIN_COUNT;
    this.targetCount = TARGET_COUNT;
    this.geo = {
      curve: new THREE.TorusGeometry(R, 0.12, 10, 18, ARC),
      ball: new THREE.SphereGeometry(1, 12, 10),
      straight: new THREE.CylinderGeometry(0.1, 0.1, 0.36, 10),
      ring: new THREE.TorusGeometry(0.8, 0.035, 6, 36),
      shadow: new THREE.CircleGeometry(0.55, 18),
    };
    this.geo.straight.rotateZ(Math.PI / 2);
    this.geo.shadow.rotateX(-Math.PI / 2);
    this.mat = {
      normal: new THREE.MeshStandardMaterial({ color: 0xb4432a, roughness: 0.38 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.22, metalness: 0.85, emissive: 0x6b4500 }),
      chain: new THREE.MeshStandardMaterial({ color: 0xd2703e, roughness: 0.4 }),
      knot: new THREE.MeshStandardMaterial({ color: 0xeadbb5, roughness: 0.8 }),
      ring: new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.75 }),
      halo: new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false }),
    };
  }

  _mesh(geo, mat, parent, x = 0, y = 0, z = 0, s = 1) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(s);
    m.castShadow = true;
    parent.add(m);
    return m;
  }

  // gebogene Wurst mit Zipfeln
  _curved(parent, mat) {
    const g = new THREE.Group();
    this._mesh(this.geo.curve, mat, g);
    const ex = R * Math.cos(ARC), ey = R * Math.sin(ARC);
    this._mesh(this.geo.ball, mat, g, R, 0, 0, 0.12);
    this._mesh(this.geo.ball, mat, g, ex, ey, 0, 0.12);
    this._mesh(this.geo.ball, this.mat.knot, g, R, -0.13, 0, 0.045);
    this._mesh(this.geo.ball, this.mat.knot, g, ex - Math.sin(ARC) * 0.13, ey + Math.cos(ARC) * 0.13, 0, 0.045);
    g.rotation.z = -(ARC / 2 + Math.PI / 2);
    g.position.y = 0.36;
    parent.add(g);
  }

  _build(type) {
    const root = new THREE.Group();
    const shadow = new THREE.Mesh(this.geo.shadow, this.mat.shadow);
    shadow.position.y = 0.03;
    root.add(shadow);
    const spin = new THREE.Group();
    root.add(spin);
    let ring = null;
    if (type === 'chain') {
      for (let i = -1; i <= 1; i++) {
        const link = new THREE.Group();
        link.position.set(i * 0.5, i === 0 ? 0.08 : 0, 0);
        link.rotation.z = -i * 0.25;
        this._mesh(this.geo.straight, this.mat.chain, link);
        this._mesh(this.geo.ball, this.mat.chain, link, -0.18, 0, 0, 0.1);
        this._mesh(this.geo.ball, this.mat.chain, link, 0.18, 0, 0, 0.1);
        spin.add(link);
      }
      for (const x of [-0.25, 0.25]) this._mesh(this.geo.ball, this.mat.knot, spin, x, 0.04, 0, 0.05);
      ring = this._mesh(this.geo.ring, this.mat.ring, root);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = false;
    } else {
      this._curved(spin, type === 'gold' ? this.mat.gold : this.mat.normal);
      if (type === 'gold') {
        const halo = this._mesh(this.geo.ball, this.mat.halo, spin, 0, 0, 0, 0.75);
        halo.castShadow = false;
      }
    }
    return { root, spin, shadow, ring };
  }

  _pickType() {
    const r = Math.random();
    return r < 0.08 ? 'gold' : r < 0.22 ? 'chain' : 'normal';
  }

  // Online: mehr Spieler -> mehr Würste
  setPlayers(n) {
    this.minCount = MIN_COUNT + (n - 1) * 3;
    this.targetCount = TARGET_COUNT + (n - 1) * 4;
  }

  // dogs: ein Dackel oder ein Array
  spawn(dogs, minDog = 4) {
    const w = this.world;
    const list = Array.isArray(dogs) ? dogs : [dogs];
    for (let tries = 0; tries < 80; tries++) {
      const x = (Math.random() * 2 - 1) * 46;
      const z = (Math.random() * 2 - 1) * 46;
      if (!w.isFree(x, z, 1.1)) continue;
      let ok = true;
      for (const dog of list) {
        if (Math.hypot(x - dog.pos.x, z - dog.pos.z) < minDog) { ok = false; break; }
        const sp = dog.segPos;
        for (let i = 0; ok && i < dog.nSeg; i += 2) if (Math.hypot(sp[i * 3] - x, sp[i * 3 + 2] - z) < 1.5) ok = false;
        if (!ok) break;
      }
      for (const s of this.list) if (Math.hypot(s.x - x, s.z - z) < 4) { ok = false; break; }
      if (!ok) continue;
      return this.spawnAt(this.nextId++, this._pickType(), x, z);
    }
    return null;
  }

  // Wurst mit bekannter ID/Typ/Position setzen (Host + Mitspieler)
  spawnAt(id, type, x, z) {
    if (this.list.length >= MAX_LIST) return null;
    const b = this._build(type);
    const y = this.world.heightAt(x, z);
    b.root.position.set(x, y, z);
    b.root.scale.setScalar(0.001);
    this.scene.add(b.root);
    const s = { id, type, x, z, y, ...b, t: 0, ph: Math.random() * 6 };
    this.list.push(s);
    return s;
  }

  _remove(i) {
    const s = this.list[i];
    this.scene.remove(s.root);
    this.list.splice(i, 1);
    return s;
  }

  removeById(id) {
    const i = this.list.findIndex((s) => s.id === id);
    return i >= 0 ? this._remove(i) : null;
  }

  byId(id) {
    return this.list.find((s) => s.id === id) || null;
  }

  clear() {
    for (const s of this.list) this.scene.remove(s.root);
    this.list.length = 0;
    this.timer = 0;
  }

  reset(dogs) {
    this.clear();
    for (let i = 0; i < this.targetCount; i++) this.spawn(dogs, 7);
  }

  // immer mindestens 8 auf der Map, Ziel 11; gibt neu gespawnte Würste zurück
  maintain(dt, dogs, out = null) {
    while (this.list.length < this.minCount) {
      const s = this.spawn(dogs);
      if (!s) break;
      out?.push(s);
    }
    if (this.list.length < this.targetCount) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const s = this.spawn(dogs);
        if (s) out?.push(s);
        this.timer = 1 + Math.random() * 2;
      }
    }
  }

  // Online-Vorhersage: Wurst kurz verstecken, bis der Host das Fressen bestätigt
  setHidden(s, h) {
    s.hidden = h;
    s.root.visible = !h;
  }

  update(dt, t) {
    for (const s of this.list) {
      s.t += dt;
      const k = Math.min(1, s.t / 0.45);
      const pop = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2); // easeOutBack
      s.root.scale.setScalar(Math.max(0.001, pop));
      const hover = 0.62 + Math.sin(t * 2.2 + s.ph) * 0.15;
      s.spin.position.y = hover;
      s.spin.rotation.y += dt * 1.8;
      s.shadow.scale.setScalar(1.1 - hover * 0.4);
      if (s.ring) {
        s.ring.position.y = hover + 0.1;
        s.ring.rotation.z -= dt * 3;
        s.ring.scale.setScalar(1 + Math.sin(t * 6) * 0.06);
      }
    }
  }

  // Gibt die gefressene Wurst zurück (oder null). remove=false: nur nachschauen (Online-Vorhersage)
  checkEat(mouth, remove = true) {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.list[i];
      if (s.t < 0.25 || s.hidden) continue;
      const dx = s.x - mouth.x, dz = s.z - mouth.z;
      const dy = s.y + s.spin.position.y + 0.15 - mouth.y;
      if (dx * dx + dz * dz + dy * dy * 0.5 < EAT_RADIUS * EAT_RADIUS) return remove ? this._remove(i) : s;
    }
    return null;
  }
}
