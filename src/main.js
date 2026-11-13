// Dackel-Rennen: Spielablauf, Kamera, Hauptschleife.
import * as THREE from 'three';
import { World } from './world.js';
import { Dog, START_SEG } from './dog.js';
import { Sausages } from './sausages.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { Particles } from './effects.js';
import { createMenuDog } from './menuDog.js';
import { Multiplayer } from './multiplayer.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 320);

const world = new World(scene);
const dog = new Dog(scene);
const sausages = new Sausages(scene, world);
const fx = new Particles(scene);
const controls = new Controls();
const ui = new UI();
const sound = new Sound(ui.muted);
sound.music.setEnabled(ui.music);
// erster Klick/Tastendruck irgendwo schaltet den Ton frei (Menümusik)
const firstUnlock = () => sound.unlock();
addEventListener('pointerdown', firstUnlock, { once: true });
addEventListener('keydown', firstUnlock, { once: true });
const menuDog = createMenuDog({ zIndex: 1, onBark: () => sound.bark() });

const START_HEADING = 0.5;
const IDLE = { turn: 0, forward: false, brake: false, sprint: false, jump: false, dirX: 0, dirZ: 0, dirMag: 0 };
// state: menu | playing | paused | over | mp (Online-Modus, siehe multiplayer.js)
const game = { state: 'menu', time: 0, eaten: 0, grace: 0, overTimer: 0, camYaw: START_HEADING, starting: false };
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58 };
const mouth = new THREE.Vector3();

// ---------- Kamera ----------
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// target: der Dackel, dem die Kamera folgt (Einzelspieler: immer `dog`)
function updateCamera(dt, snap = false, target = dog) {
  const menu = game.state === 'menu';
  if (menu) game.camYaw += dt * 0.12;
  else game.camYaw = lerpAngle(game.camYaw, target.heading, 1 - Math.exp(-dt * (target.amp > 0.1 ? 2.6 : 1.2)));
  const portrait = camera.aspect < 1 ? 1.35 : 1;
  let dist = (menu ? 9 : 6.4 + Math.min(14, (target.seg - START_SEG) * 0.09)) * portrait;
  const height = menu ? 3.2 : 2.5 + dist * 0.33;
  const p = target.pos;
  const bx = -Math.cos(game.camYaw), bz = Math.sin(game.camYaw);
  // Kamera näher heranziehen, wenn eine Baumkrone im Weg ist
  if (!menu) {
    for (let k = 1; k <= 8; k++) {
      const d = (dist * k) / 8;
      if (d > 2.5 && world.inFoliage(p.x + bx * d, p.z + bz * d)) { dist = Math.max(3, d - 1); break; }
    }
  }
  const tx = p.x + bx * dist;
  const tz = p.z + bz * dist;
  const ty = Math.max(p.y * 0.6 + height, world.heightAt(tx, tz) + 2.2);
  const k = snap ? 1 : 1 - Math.exp(-dt * 4.5);
  cam.pos.x += (tx - cam.pos.x) * k;
  cam.pos.y += (ty - cam.pos.y) * k;
  cam.pos.z += (tz - cam.pos.z) * k;
  const fx = Math.cos(target.heading), fz = -Math.sin(target.heading);
  const lead = menu ? 0.6 : 1.6;
  const kl = snap ? 1 : 1 - Math.exp(-dt * 7);
  cam.look.x += (p.x + fx * lead - cam.look.x) * kl;
  cam.look.y += (p.y * 0.7 + 1.0 - cam.look.y) * kl;
  cam.look.z += (p.z + fz * lead - cam.look.z) * kl;
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  const fov = 58 + (target.boost > 0 ? 9 : 0) + (target.sprinting ? 4 : 0);
  cam.fov += (fov - cam.fov) * Math.min(1, dt * 4);
  if (Math.abs(camera.fov - cam.fov) > 0.01) {
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
  }
}

// ---------- Spielablauf ----------
function toMenu() {
  game.state = 'menu';
  dog.setVisible(true);
  dog.reset(0, 0, START_HEADING);
  sausages.reset(dog);
  ui.showHud(false);
  ui.show('start');
  menuDog.showStart();
  sound.music.setMode('menu');
  game.camYaw = START_HEADING + 0.9;
  updateCamera(0, true);
}

function startGame() {
  sound.unlock();
  if (game.starting) return;
  game.starting = true;
  ui.show(null);
  sound.music.setMode('off');
  // Menü-Hund rennt aus dem Bild, dann geht's los
  menuDog.exit(() => {
    game.starting = false;
    dog.reset(0, 0, START_HEADING);
    sausages.reset(dog);
    Object.assign(game, { state: 'playing', time: 0, eaten: 0, grace: 1.2, camYaw: START_HEADING });
    controls.clearJump();
    ui.showHud(true);
    sound.bark();
    sound.music.setTempo(118);
    sound.music.setMode('play');
    updateCamera(0, true);
  });
}

function setPaused(p) {
  if (p && game.state === 'playing') {
    game.state = 'paused';
    ui.show('pause');
    sound.music.setMode('pause');
  } else if (!p && game.state === 'paused') {
    game.state = 'playing';
    ui.show(null);
    controls.clearJump();
    sound.music.setMode('play');
  }
}

function endRound() {
  if (game.state !== 'playing' && game.state !== 'paused') return;
  game.state = 'over';
  dog.knockOut();
  sound.music.setMode('off');
  sound.over();
  game.overTimer = 1.2;
  game.result = {
    cm: dog.lengthCm, count: game.eaten, time: game.time, relaxed: ui.relaxed,
    isNew: ui.submit(dog.lengthCm, game.eaten, game.time),
  };
  ui.show(null);
}

function setMusic(on) {
  ui.setMusic(on);
  sound.unlock();
  sound.music.setEnabled(on);
}
ui.onMusic = setMusic;

function toggleMute() {
  ui.setMuted(!ui.muted);
  sound.unlock();
  sound.setMuted(ui.muted);
}

controls.onPause = () => {
  if (mp.active) mp.toggleOverlay();
  else if (game.state === 'playing') setPaused(true);
  else if (game.state === 'paused') setPaused(false);
};
controls.onMute = toggleMute;

const on = (id, fn) => document.getElementById(id).addEventListener('click', () => { sound.unlock(); sound.click(); fn(); });
on('btnStart', startGame);
on('btnResume', () => setPaused(false));
on('btnRestartP', () => { setPaused(false); game.state = 'menu'; startGame(); });
on('btnEnd', () => { setPaused(false); endRound(); });
on('btnRestart', () => { menuDog.hide(); startGame(); });
on('btnMenu', () => { menuDog.hide(); toMenu(); });
on('btnMenuP', () => toMenu());
on('btnPause', () => controls.onPause());
document.getElementById('btnMute').addEventListener('click', toggleMute);
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyN' && !e.repeat) setMusic(!ui.music);
  if (e.code !== 'Enter' || mp.active) return;
  if (game.state === 'menu' && !game.starting) startGame();
  else if (game.state === 'over' && game.overTimer <= 0) { menuDog.hide(); startGame(); }
});
// Tab im Hintergrund: Einzelspieler pausieren (online läuft es weiter)
document.addEventListener('visibilitychange', () => { if (document.hidden && !mp.active) setPaused(true); });

// ---------- Online-Modus ----------
const mp = new Multiplayer({
  scene, world, sausages, fx, controls, ui, sound, menuDog,
  camYaw: () => game.camYaw,
  snapCamera: (heading) => { game.state = 'mp'; dog.setVisible(false); game.camYaw = heading; updateCamera(0, true, mp.cameraTarget() || dog); },
  onExit: () => { menuDog.hide(); toMenu(); },
});
function mpStep(dt, t) {
  world.update(t, dt);
  if (!mp.inRound && game.state === 'mp') {
    // Runde vorbei, zurück in die Lobby: wieder Menü-Ansicht mit dem eigenen Dackel
    game.state = 'menu';
    dog.setVisible(true);
    dog.reset(0, 0, START_HEADING);
    sausages.reset(dog);
    menuDog.showStart();
    game.camYaw = START_HEADING + 0.9;
    updateCamera(0, true);
  }
  mp.step(dt, t);
  sausages.update(dt, t);
  fx.update(dt);
  const target = mp.cameraTarget() || dog;
  world.followSun(target.pos);
  updateCamera(dt, false, target);
  mp.render(camera);
}
// Host im Hintergrund-Tab: requestAnimationFrame steht still, deshalb weiter simulieren
let bgLast = 0;
setInterval(() => {
  if (!document.hidden || !mp.active || mp.role !== 'host') { bgLast = 0; return; }
  const now = performance.now();
  let el = bgLast ? Math.min(1, (now - bgLast) / 1000) : 0.05;
  bgLast = now;
  while (el > 0) { const dt = Math.min(0.05, el); el -= dt; mp.step(dt, now / 1000); }
}, 50);

// ---------- Hauptschleife ----------
function onEat(s) {
  game.eaten++;
  dog.feed(s.type);
  const x = s.x, y = s.y + s.spin.position.y, z = s.z;
  if (s.type === 'gold') {
    sound.gold();
    fx.burst(x, y, z, [0xffd34d, 0xfff1a8, 0xffb000], 26, 4, 5, 0.1);
    ui.toast('+3 Goldwurst!', 'gold');
  } else if (s.type === 'chain') {
    sound.boost();
    fx.burst(x, y, z, [0x7fe3ff, 0xd2703e, 0xffffff], 22, 4, 4, 0.09);
    ui.toast('Turbo!', 'boost');
  } else {
    sound.snap();
    fx.burst(x, y, z, [0xb4432a, 0xe58a5a, 0xf2d1a8], 14, 3, 3.5, 0.08);
  }
}

function step(dt, t) {
  world.update(t, dt);
  const playing = game.state === 'playing';
  const inp = playing ? controls.read(game.camYaw) : IDLE;
  const ev = dog.update(dt, inp, world);

  if (playing) {
    game.time += dt;
    game.grace -= dt;
    if (ev.jumped) sound.jump();
    if (ev.landed) {
      sound.land();
      fx.burst(dog.pos.x, dog.pos.y + 0.05, dog.pos.z, [0xb89a6a, 0x9c8158], 10, 2.5, 1.5, 0.08);
    }
    if (ev.splash) {
      sound.splash();
      fx.burst(dog.pos.x, world.pond.waterY + 0.1, dog.pos.z, [0xbfe8ff, 0xffffff, 0x7cc6ec], 22, 3.5, 4.5, 0.09);
    }
    if (ev.bumped && !game._bumpCd) { sound.bump(); game._bumpCd = 0.4; }
    game._bumpCd = Math.max(0, (game._bumpCd || 0) - dt);
    if (dog.inWater && dog.actualSpeed > 1 && Math.random() < dt * 12) {
      fx.burst(dog.pos.x, world.pond.waterY + 0.05, dog.pos.z, [0xd8f1ff, 0xffffff], 2, 1.5, 2, 0.06);
    }
    const s = sausages.checkEat(dog.mouth(mouth));
    if (s) onEat(s);
    if (!ui.relaxed && game.grace <= 0 && dog.checkSelf() >= 0) endRound();
    sausages.maintain(dt, dog);
    // je länger der Dackel, desto schneller die Polka
    sound.music.setTempo(118 + Math.min(32, (dog.seg - START_SEG) * 0.25) + (dog.boost > 0 ? 10 : 0) + (dog.sprinting ? 4 : 0));
    ui.hud(dog.lengthCm, game.eaten, game.time, dog.stamina, dog.exhausted, dog.boost);
  } else if (game.state === 'over' && game.overTimer > 0) {
    game.overTimer -= dt;
    if (game.overTimer <= 0) {
      ui.showHud(false);
      ui.gameOver(game.result);
      sound.music.setMode('menu');
      menuDog.showGameOver({ segments: Math.round(dog.seg + 2) });
    }
  }
  sausages.update(dt, t);
  fx.update(dt);
  world.followSun(dog.pos);
  updateCamera(dt);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (mp.active) mpStep(dt, now / 1000);
  else if (game.state !== 'paused') step(dt, now / 1000);
  renderer.render(scene, camera);
}

toMenu();
requestAnimationFrame(frame);

// Für Tests im Dev-Modus
if (import.meta.env.DEV) window.__game = { game, dog, sausages, world, controls, startGame, endRound, setPaused, renderer, camera, mp };
