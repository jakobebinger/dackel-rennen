// Namensschilder über den Dackeln der Mitspieler (HTML-Overlay, per Kamera projiziert).
import * as THREE from 'three';

const _v = new THREE.Vector3();

export class Labels {
  constructor() {
    this.root = document.getElementById('labels');
    this.items = new Map(); // key -> { el, dog }
  }

  add(key, name, css, dog) {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = name;
    el.style.borderLeftColor = css;
    this.root.appendChild(el);
    this.items.set(key, { el, dog });
  }

  remove(key) {
    const it = this.items.get(key);
    if (!it) return;
    it.el.remove();
    this.items.delete(key);
  }

  clear() {
    for (const k of [...this.items.keys()]) this.remove(k);
  }

  update(camera) {
    const w = innerWidth, h = innerHeight;
    for (const it of this.items.values()) {
      const d = it.dog;
      if (!d.objects.length || !d.objects[0].visible) { it.el.style.display = 'none'; continue; }
      _v.set(d.pos.x, d.pos.y + 1.9, d.pos.z).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { it.el.style.display = 'none'; continue; }
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      const dist = camera.position.distanceTo(d.pos);
      const s = Math.max(0.6, Math.min(1, 14 / Math.max(dist, 1)));
      it.el.style.display = '';
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(2)})`;
    }
  }
}
