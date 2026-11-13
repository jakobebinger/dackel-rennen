// Menu dog: a big Dackel in the foreground of the start and game-over screens.
// It walks in across the whole screen, then greets (start) or lies down sadly (game over).
// Self-contained: own canvas, renderer, scene and camera, drawn under the HTML menus.
//
//   const menuDog = createMenuDog({ onBark: () => sfx.bark() });
//   menuDog.showStart();                     // walk in, stop, look at player, bark
//   menuDog.exit(() => startGame());         // run off to the right, then hide
//   menuDog.showGameOver({ segments: 30 });  // long dog walks in and lies down
//   menuDog.hide();
import * as THREE from 'three';

const SEG_SP = 0.32;        // distance between body segments
const BASE_SEGS = 9;        // length of a fresh dog
const MAX_SEGS = 160;
const BODY_Y = 0.92;        // body height while standing
const LIE_Y = 0.5;          // body height while lying
const WALK_SPEED = 2.6;
const EXIT_SPEED = 7;

// Lights got ~PI times darker in r155 (physically based units)
const LIGHT_K = parseInt(THREE.REVISION, 10) >= 155 ? Math.PI : 1;

export function createMenuDog({ parent = document.body, zIndex = 1, onBark = null, onArrive = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'menu-dog';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: String(zIndex), display: 'none',
  });
  parent.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x5a4636, 0.8 * LIGHT_K));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9 * LIGHT_K);
  sun.position.set(3, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 1024);
  sun.shadow.radius = 4;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 6, bottom: -6, near: 1, far: 30 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 20), new THREE.ShadowMaterial({ opacity: 0.25 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- model ----------
  const std = (color, roughness) => new THREE.MeshStandardMaterial({ color, roughness });
  const M = {
    fur: std(0x9c4a1f, 0.75), dark: std(0x5e2a10, 0.8), light: std(0xd29a5e, 0.8),
    black: std(0x151010, 0.35), white: std(0xffffff, 0.2), claw: std(0xeee3d0, 0.5), tongue: std(0xd65a6a, 0.6),
  };
  const sph = new THREE.SphereGeometry(1, 24, 16);
  const legGeo = new THREE.CylinderGeometry(0.13, 0.11, 0.56, 12);
  const neckGeo = new THREE.CylinderGeometry(0.24, 0.33, 0.6, 16);
  const tailGeo = new THREE.ConeGeometry(0.08, 0.7, 10);

  function mesh(geo, mat, p, s, r) {
    const m = new THREE.Mesh(geo, mat);
    if (p) m.position.set(...p);
    if (s) m.scale.set(...s);
    if (r) m.rotation.set(...r);
    m.castShadow = true;
    return m;
  }

  const dog = new THREE.Group();
  scene.add(dog);

  // Body: one cylinder piece between each pair of segments (slightly overlapping)
  // plus round caps at both ends, so it reads as one smooth sausage, not beads.
  const pieceGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).rotateZ(Math.PI / 2); // axis = x
  const bodyInst = new THREE.InstancedMesh(pieceGeo, M.fur, MAX_SEGS);
  const bellyInst = new THREE.InstancedMesh(pieceGeo, M.dark, MAX_SEGS);
  bodyInst.castShadow = bellyInst.castShadow = true;
  bodyInst.frustumCulled = bellyInst.frustumCulled = false;
  const capFront = mesh(sph, M.fur, null, [0.46, 0.46, 0.44]);
  const capRear = mesh(sph, M.fur, null, [0.46, 0.46, 0.44]);
  dog.add(bodyInst, bellyInst, capFront, capRear);

  function makeLeg() {
    const g = new THREE.Group(); // pivot = hip
    g.add(mesh(legGeo, M.fur, [0, -0.27, 0]));
    g.add(mesh(sph, M.dark, [0.07, -0.56, 0], [0.17, 0.08, 0.14]));
    for (const k of [-1, 0, 1]) g.add(mesh(sph, M.claw, [0.23, -0.585, k * 0.06], [0.035, 0.025, 0.022]));
    return g;
  }

  // Front: chest, neck, head, front legs. Sits on segment 0.
  const front = new THREE.Group();
  dog.add(front);
  front.add(mesh(sph, M.light, [0.3, -0.1, 0], [0.3, 0.34, 0.37]));       // light chest
  front.add(mesh(neckGeo, M.fur, [0.35, 0.36, 0], null, [0, 0, -0.7]));
  const head = new THREE.Group();
  head.position.set(0.62, 0.68, 0);
  front.add(head);
  head.add(mesh(sph, M.fur, [0, 0, 0], [0.36, 0.32, 0.31]));               // skull
  head.add(mesh(sph, M.fur, [0.36, -0.1, 0], [0.34, 0.17, 0.19]));         // round snout
  head.add(mesh(sph, M.fur, [0.6, -0.11, 0], [0.16, 0.14, 0.15]));         // snout tip
  head.add(mesh(sph, M.black, [0.75, -0.08, 0], [0.075, 0.065, 0.085]));   // nose
  const tongue = mesh(sph, M.tongue, [0.5, -0.24, 0], [0.09, 0.025, 0.06]);
  tongue.visible = false;
  head.add(tongue);
  const lids = [];
  for (const sd of [1, -1]) {
    head.add(mesh(sph, M.light, [0.36, -0.15, 0.12 * sd], [0.16, 0.07, 0.09]));  // cheek
    head.add(mesh(sph, M.white, [0.22, 0.08, 0.17 * sd], [0.06, 0.065, 0.045]));
    head.add(mesh(sph, M.black, [0.26, 0.08, 0.185 * sd], [0.035, 0.045, 0.03]));
    head.add(mesh(sph, M.light, [0.2, 0.19, 0.15 * sd], [0.06, 0.035, 0.05])); // brow spot
    const lid = mesh(sph, M.fur, [0.23, 0.115, 0.172 * sd], [0.064, 0.036, 0.05]); // sad eyelid
    lid.visible = false;
    head.add(lid);
    lids.push(lid);
  }
  const ears = [1, -1].map((sd) => {
    const pivot = new THREE.Group();
    pivot.position.set(-0.05, 0.17, 0.27 * sd);
    pivot.add(mesh(sph, M.dark, [0, -0.26, 0.03 * sd], [0.17, 0.33, 0.05], [0.15 * sd, 0, 0]));
    head.add(pivot);
    return { pivot, sd, swing: 0, swingV: 0, flare: 0, flareV: 0 };
  });
  const frontLegs = [1, -1].map((sd) => {
    const l = makeLeg();
    l.position.set(0.05, -0.24, 0.26 * sd);
    front.add(l);
    return l;
  });

  // Rear: hind legs and tail. Always sits on the last segment.
  const rear = new THREE.Group();
  dog.add(rear);
  const hindLegs = [1, -1].map((sd) => {
    const l = makeLeg();
    l.position.set(-0.05, -0.24, 0.25 * sd);
    rear.add(l);
    return l;
  });
  const tail = new THREE.Group();
  tail.position.set(-0.4, 0.18, 0);
  rear.add(tail);
  tail.add(mesh(tailGeo, M.fur, [-0.22, 0.24, 0], null, [0, 0, 0.85]));

  // Extra leg pairs in the middle for long dogs
  const midPairs = [];
  function ensureMidPairs(n) {
    while (midPairs.length < n) {
      const g = new THREE.Group();
      const legs = [1, -1].map((sd) => {
        const l = makeLeg();
        l.position.set(0, -0.24, 0.25 * sd);
        g.add(l);
        return l;
      });
      dog.add(g);
      midPairs.push({ g, legs, seg: 0 });
    }
    midPairs.forEach((p, i) => { p.g.visible = i < n; });
  }

  // ---------- state ----------
  let segs = BASE_SEGS;
  let mode = 'start';    // 'start' | 'gameover'
  let state = 'hidden';  // walk | greet | idle | lie | exit | hidden
  let headX = 0, targetX = 0, v = 0, prevV = 0;
  let phase = 0, stateT = 0, lieP = 0, barked = false;
  let bodyY = BODY_Y, prevBodyY = BODY_Y, bodyVY = 0;
  let exitCb = null, raf = 0, last = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpDir = new THREE.Vector3();
  const X_AXIS = new THREE.Vector3(1, 0, 0);

  function halfWidthAt(dist) { return dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect; }

  function layoutCamera() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    // Long dogs: zoom out a bit, but let very long ones run off the left edge
    const dogLen = Math.min(segs, 40) * SEG_SP + 1.6;
    const needHalf = Math.max(3.4, dogLen * 0.62);
    const dist = Math.max(9, needHalf / (Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect));
    cam.position.set(0, 1.9, dist);
    cam.lookAt(0, 1.4 + dist * 0.06, 0); // keeps the dog in the lower part of the screen
    cam.updateProjectionMatrix();
    const len = (segs - 1) * SEG_SP;
    targetX = mode === 'start' ? len / 2 + 0.3 : Math.min(len / 2 + 0.3, halfWidthAt(dist) * 0.55);
  }

  function setLength(n) {
    segs = Math.max(2, Math.min(MAX_SEGS, Math.round(n)));
    bodyInst.count = bellyInst.count = segs - 1;
    const pairs = segs >= 14 ? Math.min(12, Math.floor((segs - 6) / 8)) : 0;
    ensureMidPairs(pairs);
    for (let i = 0; i < pairs; i++) midPairs[i].seg = Math.round(((i + 1) * (segs - 1)) / (pairs + 1));
  }

  function reset() {
    layoutCamera();
    const len = (segs - 1) * SEG_SP;
    headX = -halfWidthAt(cam.position.z) - 1.2; // just off the left edge
    v = WALK_SPEED; prevV = v; phase = 0; stateT = 0; lieP = 0; barked = false;
    bodyY = prevBodyY = BODY_Y; bodyVY = 0;
    head.rotation.set(0, 0, 0);
    head.position.y = 0.68;
    tongue.visible = false;
    lids.forEach((l) => { l.visible = false; });
    ears.forEach((e) => { e.swing = e.swingV = e.flare = e.flareV = 0; });
    state = 'walk';
    if (reducedMotion) { // skip the walk, show the final pose
      headX = targetX; v = 0;
      if (mode === 'start') { state = 'idle'; head.rotation.y = -0.8; }
      else { state = 'lie'; lieP = 1; stateT = 10; }
    }
    void len;
  }

  // ---------- animation ----------
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

  function update(dt) {
    stateT += dt;
    const t = performance.now() / 1000;

    // Movement along x
    if (state === 'walk') {
      const remain = targetX - headX;
      const brake = Math.sqrt(Math.max(0, 2 * 3.5 * remain)); // smooth stop
      v = Math.min(damp(v, WALK_SPEED, 4, dt), brake);
      headX += v * dt;
      if (remain < 0.01 || v < 0.05) {
        headX = targetX; v = 0; stateT = 0;
        state = mode === 'start' ? 'greet' : 'lie';
        if (onArrive) onArrive(mode);
      }
    } else if (state === 'exit') {
      head.rotation.y = damp(head.rotation.y, 0, 8, dt);
      v = damp(v, EXIT_SPEED, 3, dt);
      headX += v * dt;
      const tailX = headX - (segs - 1) * SEG_SP - 1;
      if (tailX > halfWidthAt(cam.position.z) + 0.5) {
        const cb = exitCb; exitCb = null;
        hide();
        if (cb) cb();
        return;
      }
    } else {
      v = damp(v, 0, 8, dt);
    }
    const accel = (v - prevV) / Math.max(dt, 1e-3);
    prevV = v;

    // Gait: diagonal pairs move together, stride grows with speed
    phase += v * dt * 3.4;
    const amp = Math.min(0.65, v * 0.22);
    const sw = (off) => Math.sin(phase + off) * amp;
    let fl = sw(0), fr = sw(Math.PI), hl = sw(Math.PI), hr = sw(0);
    let midX = 0;

    // Poses
    let tailSpeed = 7, tailAmp = 0.45;
    if (state === 'greet') {
      head.rotation.y = damp(head.rotation.y, -0.85, 6, dt);  // look at the player
      tongue.visible = true;
      tailSpeed = 18; tailAmp = 0.7;
      // little hop + bark
      const hop = stateT > 0.35 && stateT < 0.75 ? Math.sin(((stateT - 0.35) / 0.4) * Math.PI) : 0;
      head.rotation.z = hop * 0.35;
      bodyY = BODY_Y + hop * 0.12;
      if (!barked && stateT > 0.4) { barked = true; if (onBark) onBark(); }
      if (stateT > 1.6) { state = 'idle'; stateT = 0; }
    } else if (state === 'idle') {
      head.rotation.y = damp(head.rotation.y, -0.75 + Math.sin(t * 0.6) * 0.2, 3, dt);
      head.rotation.x = damp(head.rotation.x, Math.sin(t * 0.45) > 0.85 ? 0.3 : 0, 4, dt); // curious tilt
      head.rotation.z = damp(head.rotation.z, 0, 6, dt);
      tongue.visible = Math.sin(t * 0.3) > -0.3;
      tailSpeed = 11; tailAmp = 0.55;
      bodyY = BODY_Y + Math.sin(t * 2.2) * 0.012;
    } else if (state === 'lie') {
      lieP = Math.min(1, lieP + dt / 0.9);
      const e = lieP * lieP * (3 - 2 * lieP);
      bodyY = THREE.MathUtils.lerp(BODY_Y, LIE_Y, e) + (lieP >= 1 ? Math.sin(t * 1.4) * 0.01 : 0);
      fl = fr = 1.35 * e;    // front legs stretched forward
      hl = hr = -1.35 * e;   // hind legs stretched back
      midX = 1.15 * e;       // middle legs splay sideways
      head.position.y = 0.68 - 0.28 * e;
      head.rotation.z = -0.35 * e + (lieP >= 1 ? Math.sin(t * 0.7) * 0.03 : 0);
      head.rotation.y = damp(head.rotation.y, -0.5 * e, 3, dt);
      lids.forEach((l) => { l.visible = lieP > 0.6; });
      tailSpeed = 2; tailAmp = 0.18;
      // a deep sigh every few seconds
      const sigh = stateT > 1.5 ? Math.max(0, Math.sin((stateT - 1.5) * 1.2)) ** 6 : 0;
      bodyY += sigh * 0.04;
    } else {
      head.rotation.y = damp(head.rotation.y, 0, 6, dt);
      head.rotation.z = Math.sin(phase * 2) * 0.04 * (amp / 0.65);
      bodyY = BODY_Y + Math.abs(Math.sin(phase)) * 0.05 * (amp / 0.65);
    }

    frontLegs[0].rotation.z = fl; frontLegs[1].rotation.z = fr;
    hindLegs[0].rotation.z = hl; hindLegs[1].rotation.z = hr;
    midPairs.forEach((p, i) => {
      if (!p.g.visible) return;
      const off = i % 2 ? 0 : Math.PI;
      p.legs.forEach((l, k) => {
        l.rotation.z = midX ? 0 : sw(off + k * Math.PI);
        l.rotation.x = midX * (k === 0 ? -1 : 1);
      });
    });
    tail.rotation.y = Math.sin(t * tailSpeed) * tailAmp;

    // Ear springs: swing back when speeding up, flare when the body moves up/down
    bodyVY = (bodyY - prevBodyY) / Math.max(dt, 1e-3);
    prevBodyY = bodyY;
    const droop = state === 'lie' ? -0.25 * lieP : 0;
    ears.forEach((e) => {
      const swingT = THREE.MathUtils.clamp(-accel * 0.06, -0.6, 0.6) + droop;
      e.swingV += ((swingT - e.swing) * 60 - e.swingV * 7) * dt;
      e.swing += e.swingV * dt;
      const flareT = THREE.MathUtils.clamp(bodyVY * 0.5, -0.4, 0.6) + (state === 'greet' ? 0.15 : 0);
      e.flareV += ((flareT - e.flare) * 70 - e.flareV * 6) * dt;
      e.flare += e.flareV * dt;
      e.pivot.rotation.z = e.swing;
      e.pivot.rotation.x = -e.sd * Math.max(0, e.flare);
    });

    // Body segments (straight path, small travelling wiggle)
    const wig = (amp / 0.65) * 0.015;
    const segY = (i) => bodyY + Math.sin(phase * 2 - i * 0.6) * wig;
    for (let i = 0; i < segs - 1; i++) {
      const x0 = headX - i * SEG_SP, y0 = segY(i);
      const y1 = segY(i + 1);
      tmpDir.set(-SEG_SP, y1 - y0, 0);
      const len = tmpDir.length();
      tmpQ.setFromUnitVectors(X_AXIS, tmpDir.normalize());
      tmpP.set(x0 - SEG_SP / 2, (y0 + y1) / 2, 0);
      tmpS.set(len + 0.04, 0.46, 0.44);
      tmpM.compose(tmpP, tmpQ, tmpS);
      bodyInst.setMatrixAt(i, tmpM);
      tmpP.y -= 0.13;
      tmpS.set(len + 0.04, 0.34, 0.37);
      tmpM.compose(tmpP, tmpQ, tmpS);
      bellyInst.setMatrixAt(i, tmpM);
    }
    bodyInst.instanceMatrix.needsUpdate = bellyInst.instanceMatrix.needsUpdate = true;
    capFront.position.set(headX, segY(0), 0);
    capRear.position.set(headX - (segs - 1) * SEG_SP, segY(segs - 1), 0);
    front.position.set(headX, bodyY, 0);
    rear.position.set(headX - (segs - 1) * SEG_SP, bodyY, 0);
    midPairs.forEach((p) => { if (p.g.visible) p.g.position.set(headX - p.seg * SEG_SP, bodyY, 0); });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt);
    if (state !== 'hidden') renderer.render(scene, cam);
  }

  function start() {
    canvas.style.display = 'block';
    cancelAnimationFrame(raf);
    last = performance.now();
    if (reducedMotion) { update(0); renderer.render(scene, cam); return; }
    raf = requestAnimationFrame(frame);
  }

  function onResize() {
    if (state === 'hidden') return;
    layoutCamera();
    if (state !== 'walk' && state !== 'exit') headX = targetX;
    if (reducedMotion) { update(0); renderer.render(scene, cam); }
  }
  window.addEventListener('resize', onResize);

  // ---------- public API ----------
  function showStart() {
    mode = 'start';
    setLength(BASE_SEGS);
    reset();
    start();
  }

  // segments: total body segments of the dog at game over (BASE_SEGS = fresh dog)
  function showGameOver({ segments = BASE_SEGS } = {}) {
    mode = 'gameover';
    setLength(segments);
    reset();
    start();
  }

  // Run off to the right, then hide and call cb (e.g. to start the game)
  function exit(cb) {
    if (state === 'hidden' || reducedMotion) { hide(); if (cb) cb(); return; }
    exitCb = cb || null;
    state = 'exit';
    tongue.visible = false;
  }

  function hide() {
    state = 'hidden';
    cancelAnimationFrame(raf);
    canvas.style.display = 'none';
  }

  function dispose() {
    hide();
    window.removeEventListener('resize', onResize);
    renderer.dispose();
    canvas.remove();
  }

  return { showStart, showGameOver, exit, hide, dispose, canvas, get state() { return state; } };
}
