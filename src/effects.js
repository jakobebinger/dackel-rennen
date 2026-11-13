// Kleine Partikel (Krümel, Spritzer, Staub) als ein InstancedMesh.
import * as THREE from 'three';

export class Particles {
  constructor(scene, max = 260) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true }),
      max,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.next = 0;
    this._d = new THREE.Object3D();
    this._c = new THREE.Color();
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, zero);
      this.mesh.setColorAt(i, this._c.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(x, y, z, colors, n = 14, speed = 3, up = 4, size = 0.09, grav = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
      this.v[i * 3] = Math.cos(a) * s;
      this.v[i * 3 + 1] = up * (0.5 + Math.random() * 0.7);
      this.v[i * 3 + 2] = Math.sin(a) * s;
      this.life[i] = this.maxLife[i] = 0.5 + Math.random() * 0.5;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.grav[i] = grav;
      this.mesh.setColorAt(i, this._c.set(colors[k % colors.length]));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const d = this._d;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= 14 * this.grav[i] * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const s = this.life[i] > 0 ? this.size[i] * Math.min(1, (this.life[i] / this.maxLife[i]) * 2) : 0;
      d.position.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
      d.rotation.set(this.life[i] * 7, this.life[i] * 5, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    if (any || this._wasAny) this.mesh.instanceMatrix.needsUpdate = true;
    this._wasAny = any;
  }
}
