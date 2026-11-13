// Online-Modus (2–8 Spieler, Peer-to-Peer über PeerJS).
// Der Host simuliert alles (Würste, Kollisionen, Punkte, Uhr) und schickt ~20x/s
// einen Schnappschuss. Mitspieler schicken ~30x/s ihre Eingabe, rechnen den eigenen
// Dackel voraus (fühlt sich direkt an) und zeichnen die anderen ~100 ms verzögert
// zwischen zwei Schnappschüssen interpoliert.
import * as THREE from 'three';
import { Dog, FUR_COLORS } from './dog.js';
import { HostRoom, ClientRoom } from './net/room.js';
import { INPUT_HZ, SNAPSHOT_HZ, ROUND_SECONDS, MAX_PLAYERS } from './net/config.js';
import { MpUi, MODE_NAMES } from './mpUi.js';
import { Labels } from './labels.js';

const IDLE = { turn: 0, forward: false, brake: false, sprint: false, jump: false, dirX: 0, dirZ: 0, dirMag: 0 };
// Startplätze im Kreis um die Mitte (bis 8 Spieler), Blick jeweils weg von der Mitte
const START_POS = Array.from({ length: MAX_PLAYERS }, (_, i) => {
  const a = Math.PI * 1.25 + (i * Math.PI * 2) / MAX_PLAYERS;
  return [Math.round(Math.cos(a) * 7 * 100) / 100, Math.round(Math.sin(a) * 7 * 100) / 100];
});
const COUNTDOWN = 3;
const INTERP_DELAY = 0.1; // Mitspieler-Dackel so weit in der Vergangenheit zeichnen
const HEAR_DIST = 24; // Geräusche anderer Dackel nur in der Nähe
const F_GROUND = 1, F_SPRINT = 2, F_WATER = 4, F_DEAD = 8, F_EXH = 16;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const _m = new THREE.Vector3();

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Multiplayer {
  // ctx: { scene, world, sausages, fx, controls, ui, sound, menuDog, camYaw(), snapCamera(heading), onExit(msg) }
  constructor(ctx) {
    this.ctx = ctx;
    this.ui = new MpUi(ctx.ui, ctx.sound);
    this.labels = new Labels();
    this.state = 'off'; // off | lobby | countdown | playing | over
    this.role = null; // host | client
    this.room = null;
    this.players = new Map(); // id -> { id, name, color, dog, alive, eaten, koTime, inp, jumpQueued, buf, host }
    this.myId = 0;
    this.code = null;
    this.settings = { mode: 'battle', relaxed: false };
    this.evs = []; // Host: Ereignisse bis zum nächsten Schnappschuss
    this.rtt = 0.08;
    this._s = {}; // Zwischenspeicher für Interpolation
    this.spectateId = 0;

    const u = this.ui;
    u.onHost = () => this.host();
    u.onJoin = (code) => this.join(code);
    u.onStart = () => this.hostStart();
    u.onLeave = () => this.leave(null);
    u.onSettings = (s) => { this.settings = s; this._broadcastLobby(); };
    u.onAgain = () => { if (this.players.size < 2) this._toLobby(); else this.hostStart(); };
    u.onMenu = () => this.leave(null);
    u.onResume = () => this.toggleOverlay(false);
  }

  get active() { return this.state !== 'off'; }
  get inRound() { return this.state === 'countdown' || this.state === 'playing' || this.state === 'over'; }
  get me() { return this.players.get(this.myId); }

  // ---------- Raum erstellen / beitreten ----------
  async host() {
    if (this._busy || this.active) return; // kein doppeltes Erstellen
    this._busy = true;
    this.ui.error('start', null);
    this.ui.busy(true);
    const room = new HostRoom();
    room.onJoin = (id, name) => this._hostJoin(id, name);
    room.onLeave = (id) => this._hostLeave(id);
    room.onMessage = (id, m) => this._hostMessage(id, m);
    try {
      const code = await room.open();
      this.room = room;
      this.role = 'host';
      this.code = code;
      this.myId = 1;
      this.state = 'lobby';
      this.players.clear();
      this.players.set(1, this._player(1, this.ui.nick(), 0));
      this._broadcastLobby();
    } catch (e) {
      room.close();
      this.ui.error('start', e.message);
    }
    this._busy = false;
    this.ui.busy(false);
  }

  async join(code) {
    if (this._busy || this.active) return; // doppeltes Verbinden (Enter + Klick) gäbe einen Geister-Dackel
    this._busy = true;
    this.ui.error('join', null);
    this.ui.busy(true);
    const room = new ClientRoom();
    this.room = room; // schon jetzt merken: Nachrichten alter/doppelter Verbindungen werden ignoriert
    room.onMessage = (m) => { if (this.room === room) this._clientMessage(m); };
    try {
      await room.connect(code, this.ui.nick());
      this.role = 'client';
      this.code = code;
      this.state = 'lobby';
      this.players.clear();
      room.onClose = (reason) => { if (this.room === room) this.leave(reason); };
      this.ui.showLobby({ code, players: [], settings: this.settings, isHost: false, myId: 0 });
    } catch (e) {
      room.close();
      if (this.room === room) this.room = null;
      this.ui.error('join', e.message);
    }
    this._busy = false;
    this.ui.busy(false);
  }

  _player(id, name, color) {
    return { id, name, color, dog: null, alive: true, eaten: 0, koTime: null, inp: { ...IDLE }, jumpQueued: false, buf: [], host: null, hostAge: 0, hideAt: 0 };
  }

  // Raum verlassen (freiwillig oder weil der Host weg ist); msg wird im Menü angezeigt
  leave(msg) {
    if (!this.active) return;
    this.room?.close();
    this.room = null;
    this._clearRound();
    this.players.clear();
    this.state = 'off';
    this.role = null;
    this.ui.hideList();
    this.ui.countdown(null);
    this.ui.resetLobby();
    this.ctx.sausages.setPlayers(1);
    this.ctx.ui._renderRelax();
    this.ctx.onExit();
    this.ui.error('start', msg);
  }

  _clearRound() {
    for (const p of this.players.values()) { p.dog?.dispose(); p.dog = null; }
    this.labels.clear();
  }

  // Esc im Online-Spiel: kleines Overlay, Spiel läuft weiter
  toggleOverlay(on) {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    const open = !document.getElementById('screenMpPause').classList.contains('hidden');
    if (on === undefined) on = !open;
    this.ctx.ui.show(on ? 'mppause' : null);
    if (!on) this.ctx.controls.clearJump();
  }

  // ---------- Lobby ----------
  _lobbyList() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color }));
  }

  _broadcastLobby() {
    if (this.role !== 'host' || this.state !== 'lobby') return;
    const players = this._lobbyList();
    for (const id of this.room.conns.keys()) this.room.send(id, { t: 'lobby', code: this.code, players, s: this.settings, you: id });
    this.ui.showLobby({ code: this.code, players, settings: this.settings, isHost: true, myId: 1 });
  }

  _toLobby() {
    this.state = 'lobby';
    this.room.accepting = true;
    this._clearRound();
    this.ctx.sausages.clear();
    this.ctx.ui.showHud(false);
    this.ui.hideList();
    this._broadcastLobby();
  }

  _hostJoin(id, name) {
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = 0;
    while (used.has(color)) color++;
    this.players.set(id, this._player(id, name, color));
    this.ctx.sound.bark();
    if (this.state === 'lobby') this._broadcastLobby();
    else if (this.state === 'over') this.room.send(id, { t: 'lobby', code: this.code, players: this._lobbyList(), s: this.settings, you: id });
  }

  _hostLeave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.state === 'lobby') this._broadcastLobby();
    else if (this.state === 'countdown' || this.state === 'playing') {
      this._removeDog(p);
      this.evs.push(['left', id]);
      this.ctx.ui.toast(`${p.name} hat das Spiel verlassen`);
      if (this.state === 'playing') this._checkEnd();
    }
  }

  _removeDog(p) {
    p.dog?.dispose();
    p.dog = null;
    this.labels.remove(p.id);
  }

  _hostMessage(id, m) {
    const p = this.players.get(id);
    if (!p || !m) return;
    if (m.t === 'in' && Array.isArray(m.a)) {
      const a = m.a, i = p.inp;
      i.turn = Math.max(-1, Math.min(1, +a[0] || 0));
      i.forward = !!a[1]; i.brake = !!a[2]; i.sprint = !!a[3];
      if (a[4]) p.jumpQueued = true;
      i.dirX = +a[5] || 0; i.dirZ = +a[6] || 0; i.dirMag = Math.max(0, Math.min(1, +a[7] || 0));
    } else if (m.t === 'p') this.room.send(id, { t: 'q', c: m.c });
  }

  _clientMessage(m) {
    if (!m) return;
    switch (m.t) {
      case 'lobby':
        this.myId = m.you;
        if (m.s) this.settings = m.s;
        if (this.state === 'over' || this.state === 'lobby') {
          this.state = 'lobby';
          this._clearRound();
          this.ctx.sausages.clear();
          this.ctx.ui.showHud(false);
          this.ui.hideList();
          this.players.clear();
          for (const p of m.players) this.players.set(p.id, this._player(p.id, p.name, p.color));
          this.ui.showLobby({ code: m.code, players: m.players, settings: this.settings, isHost: false, myId: this.myId });
        }
        break;
      case 'start': this._startRound(m); break;
      case 's': this._snapshot(m); break;
      case 'end': this._showOver(m.rank); break;
      case 'q': this.rtt = this.rtt * 0.8 + ((performance.now() - m.c) / 1000) * 0.2; break;
    }
  }

  // ---------- Rundenstart ----------
  hostStart() {
    if (this.role !== 'host' || this.players.size < 2 || this.players.size > MAX_PLAYERS) return;
    const list = [...this.players.values()];
    const players = list.map((p, i) => {
      const [x, z] = START_POS[i];
      return { id: p.id, name: p.name, color: p.color, x, z, h: Math.atan2(-z, x) };
    });
    const data = { t: 'start', mode: this.settings.mode, relaxed: this.settings.relaxed, dur: ROUND_SECONDS, players, saus: null };
    this._startRound(data);
    this.room.accepting = false;
    this.room.broadcast(data);
  }

  _startRound(d) {
    this._clearRound();
    this.settings = { mode: d.mode, relaxed: d.relaxed };
    // Spieler, die nicht mehr dabei sind, raus; neue rein
    const ids = new Set(d.players.map((p) => p.id));
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this.players.delete(id);
    for (const q of d.players) {
      let p = this.players.get(q.id);
      if (!p) { p = this._player(q.id, q.name, q.color); this.players.set(q.id, p); }
      Object.assign(p, { alive: true, eaten: 0, koTime: null, buf: [], host: null, hostAge: 0, jumpQueued: false, hideAt: 0 });
      p.inp = { ...IDLE };
      p.dog = new Dog(this.ctx.scene, FUR_COLORS[q.color]);
      p.dog.reset(q.x, q.z, q.h);
      if (q.id !== this.myId) this.labels.add(q.id, q.name, FUR_COLORS[q.color].css, p.dog);
    }
    const dogs = [...this.players.values()].map((p) => p.dog);
    const S = this.ctx.sausages;
    S.setPlayers(dogs.length);
    if (this.role === 'host') {
      S.reset(dogs);
      d.saus = S.list.map((s) => [s.id, s.type, r2(s.x), r2(s.z)]);
    } else {
      S.clear();
      for (const [id, type, x, z] of d.saus || []) S.spawnAt(id, type, x, z);
    }
    this.time = 0;
    this.timeLeft = d.dur;
    this.timeLeftAt = performance.now();
    this.grace = 1.2;
    this.count = COUNTDOWN;
    this.evs.length = 0;
    this.snapAcc = 0; this.inAcc = 0; this.listAcc = 0; this.pingAcc = 0;
    this.jumpPending = false;
    this.hostClock = null;
    this.lastTs = 0; this.lastTsAt = 0;
    this.spectateId = this.myId;
    this.state = 'countdown';
    const { ui, sound, menuDog } = this.ctx;
    ui.show(null);
    ui.showHud(true);
    ui.el.relaxTag.classList.toggle('hidden', !(d.mode === 'battle' && d.relaxed));
    this.ui.spectating(false);
    menuDog.exit(() => {});
    sound.unlock();
    sound.music.setMode('off');
    this.ctx.controls.clearJump();
    this.ctx.snapCamera(this.me.dog.heading);
    this.ctx.ui.toast(MODE_NAMES[d.mode] || d.mode);
  }

  // ---------- Hauptschleife ----------
  step(dt, t) {
    if (this.state === 'countdown') {
      this.count -= dt;
      this.ui.countdown(Math.ceil(Math.max(0, this.count)));
      if (this.count <= 0) {
        this.state = 'playing';
        this.ctx.sound.bark();
        this.ctx.sound.music.setTempo(118);
        this.ctx.sound.music.setMode('play');
        setTimeout(() => this.ui.countdown(null), 600);
      }
      return;
    }
    if (this.state !== 'playing') return;
    if (this.role === 'host') this._hostStep(dt);
    else this._clientStep(dt);
    // Sterbende Dackel nach kurzer Zeit ausblenden
    for (const p of this.players.values()) {
      if (p.alive || !p.dog) continue;
      if (!p.hideAt) p.hideAt = this.time + 3;
      else if (this.time > p.hideAt && p.dog.objects[0]?.visible) p.dog.setVisible(false);
    }
    this._hud(dt);
  }

  // nach updateCamera: Namensschilder
  render(camera) {
    if (this.inRound) this.labels.update(camera);
  }

  // Welchen Dackel die Kamera verfolgt (null = keiner, Menü)
  cameraTarget() {
    if (!this.inRound) return null;
    const me = this.me;
    if (me?.dog && me.alive) return me.dog;
    let cur = this.players.get(this.spectateId);
    if (!cur || !cur.alive || !cur.dog) {
      let best = null;
      for (const p of this.players.values()) if (p.alive && p.dog && (!best || p.dog.seg > best.dog.seg)) best = p;
      cur = best || cur;
      if (cur) this.spectateId = cur.id;
    }
    return cur?.dog || me?.dog || null;
  }

  _hud(dt) {
    const me = this.me;
    if (!me?.dog) return;
    const d = me.dog;
    const { ui, sound } = this.ctx;
    ui.hud(d.lengthCm, me.eaten, this.timeLeft, d.stamina, d.exhausted, d.boost);
    sound.music.setTempo(118 + Math.min(32, (d.seg - 7) * 0.25) + (d.boost > 0 ? 10 : 0) + (d.sprinting ? 4 : 0));
    this.listAcc += dt;
    if (this.listAcc > 0.25) {
      this.listAcc = 0;
      const rows = [...this.players.values()].filter((p) => p.dog).map((p) => ({ id: p.id, name: p.name, color: p.color, cm: p.dog.lengthCm, alive: p.alive }));
      rows.sort((a, b) => (b.alive - a.alive) || (b.cm - a.cm));
      this.ui.list(rows, this.myId);
    }
  }

  // Geräusche/Partikel für Dackel-Ereignisse; evs != null -> Host sammelt für die Mitspieler
  _dogEvents(p, ev, evs) {
    const { sound, fx, world } = this.ctx;
    const d = p.dog, near = this._near(d);
    if (ev.jumped) { if (near) sound.jump(); evs?.push(['j', p.id]); }
    if (ev.landed) {
      if (near) sound.land();
      fx.burst(d.pos.x, d.pos.y + 0.05, d.pos.z, [0xb89a6a, 0x9c8158], 10, 2.5, 1.5, 0.08);
      evs?.push(['l', p.id]);
    }
    if (ev.splash) {
      if (near) sound.splash();
      fx.burst(d.pos.x, world.pond.waterY + 0.1, d.pos.z, [0xbfe8ff, 0xffffff, 0x7cc6ec], 22, 3.5, 4.5, 0.09);
      evs?.push(['w', p.id]);
    }
    if (ev.bumped && p.id === this.myId && !this._bumpCd) { sound.bump(); this._bumpCd = 0.4; }
    if (d.inWater && d.actualSpeed > 1 && Math.random() < 0.2) fx.burst(d.pos.x, world.pond.waterY + 0.05, d.pos.z, [0xd8f1ff, 0xffffff], 2, 1.5, 2, 0.06);
  }

  _near(dog) {
    const c = this.cameraTarget();
    return !c || c === dog || c.pos.distanceTo(dog.pos) < HEAR_DIST;
  }

  _eatFx(s, p) {
    const { sound, fx, ui } = this.ctx;
    const x = s.x, y = s.y + s.spin.position.y, z = s.z;
    const mine = p.id === this.myId, near = mine || this._near(p.dog);
    if (s.type === 'gold') {
      if (near) sound.gold();
      fx.burst(x, y, z, [0xffd34d, 0xfff1a8, 0xffb000], 26, 4, 5, 0.1);
      if (mine) ui.toast('+3 Goldwurst!', 'gold');
    } else if (s.type === 'chain') {
      if (near) sound.boost();
      fx.burst(x, y, z, [0x7fe3ff, 0xd2703e, 0xffffff], 22, 4, 4, 0.09);
      if (mine) ui.toast('Turbo!', 'boost');
    } else {
      if (near) sound.snap();
      fx.burst(x, y, z, [0xb4432a, 0xe58a5a, 0xf2d1a8], 14, 3, 3.5, 0.08);
    }
  }

  _knockOut(p, why) {
    if (!p.alive) return;
    p.alive = false;
    p.koTime = this.time;
    p.dog?.knockOut();
    const { sound, fx, ui } = this.ctx;
    if (p.dog) fx.burst(p.dog.pos.x, p.dog.pos.y + 0.5, p.dog.pos.z, [0xb89a6a, 0xffffff, 0x9c8158], 20, 3, 3, 0.1);
    if (p.id === this.myId) {
      sound.over();
      this.ui.spectating(true);
      this.spectateId = 0;
    } else {
      if (this._near(p.dog)) sound.bump();
      const by = why === 'self' ? 'sich selbst' : (this.players.get(why)?.name || 'jemanden');
      ui.toast(`${p.name} ist raus (${by})`);
    }
  }

  // ---------- Host ----------
  _netInput(p) {
    p.inp.jump = p.jumpQueued;
    p.jumpQueued = false;
    return p.inp;
  }

  _hostStep(dt) {
    const { world, sausages, controls } = this.ctx;
    this.time += dt;
    this.timeLeft -= dt;
    this.grace -= dt;
    this._bumpCd = Math.max(0, (this._bumpCd || 0) - dt);
    const evs = this.evs;
    const alive = [];
    for (const p of this.players.values()) {
      if (!p.dog) continue;
      const inp = !p.alive ? IDLE : p.id === this.myId ? controls.read(this.ctx.camYaw()) : this._netInput(p);
      const ev = p.dog.update(dt, inp, world);
      if (p.alive) { this._dogEvents(p, ev, evs); alive.push(p); }
    }
    // Fressen
    for (const p of alive) {
      const s = sausages.checkEat(p.dog.mouth(_m));
      if (!s) continue;
      p.eaten++;
      p.dog.feed(s.type);
      evs.push(['eat', s.id, p.id, s.type]);
      this._eatFx(s, p);
    }
    // Kollisionen (nur Battle)
    if (this.settings.mode === 'battle' && this.grace <= 0) {
      const outs = [];
      for (const p of alive) {
        if (!this.settings.relaxed && p.dog.checkSelf() >= 0) { outs.push([p, 'self']); continue; }
        for (const q of alive) if (q !== p && p.dog.checkOther(q.dog)) { outs.push([p, q.id]); break; }
      }
      for (const [p, why] of outs) { this._knockOut(p, why); evs.push(['ko', p.id, why]); }
    }
    const spawned = [];
    sausages.maintain(dt, alive.map((p) => p.dog), spawned);
    for (const s of spawned) evs.push(['sp', s.id, s.type, r2(s.x), r2(s.z)]);

    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAPSHOT_HZ) { this.snapAcc = 0; this._sendSnapshot(); }
    this._checkEnd();
  }

  _sendSnapshot() {
    const d = [];
    for (const p of this.players.values()) {
      const g = p.dog;
      if (!g) continue;
      const flags = (g.onGround ? F_GROUND : 0) | (g.sprinting ? F_SPRINT : 0) | (g.inWater ? F_WATER : 0) | (g.dead ? F_DEAD : 0) | (g.exhausted ? F_EXH : 0);
      d.push([p.id, r2(g.pos.x), r2(g.pos.y), r2(g.pos.z), r3(g.heading), r2(g.speed), g.targetSeg, flags, r2(g.stamina), r2(g.boost), p.eaten]);
    }
    const msg = { t: 's', ts: r3(this.time), tl: r2(this.timeLeft), d, si: this.ctx.sausages.list.map((s) => s.id) };
    if (this.evs.length) { msg.ev = this.evs.slice(); this.evs.length = 0; }
    this.room.broadcast(msg);
  }

  _checkEnd() {
    if (this.state !== 'playing') return;
    const alive = [...this.players.values()].filter((p) => p.alive && p.dog).length;
    const out = this.timeLeft <= 0 || this.players.size < 2 || (this.settings.mode === 'battle' && alive <= 1);
    if (!out) return;
    const rank = this._ranking();
    this._sendSnapshot();
    this.room.broadcast({ t: 'end', rank });
    this.room.accepting = true;
    this._showOver(rank);
  }

  _ranking() {
    const list = [...this.players.values()].filter((p) => p.dog);
    list.sort((a, b) => (b.alive - a.alive) || (a.alive ? (b.dog.lengthCm - a.dog.lengthCm) || (b.eaten - a.eaten) : (b.koTime - a.koTime)));
    return list.map((p) => ({ id: p.id, name: p.name, color: p.color, cm: p.dog.lengthCm, count: p.eaten, alive: p.alive }));
  }

  _showOver(rank) {
    this.state = 'over';
    const { ui, sound } = this.ctx;
    ui.showHud(false);
    this.ui.hideList();
    this.ui.countdown(null);
    sound.music.setMode('menu');
    this.ui.showOver({ rank: rank.map((r) => ({ ...r, me: r.id === this.myId })), mode: this.settings.mode, isHost: this.role === 'host' });
  }

  // ---------- Mitspieler ----------
  _clientStep(dt) {
    const { world, sausages, controls } = this.ctx;
    this.time += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this._bumpCd = Math.max(0, (this._bumpCd || 0) - dt);
    const me = this.me;
    // Eingabe lesen + an den Host schicken
    const inp = me?.alive ? controls.read(this.ctx.camYaw()) : IDLE;
    if (inp.jump) this.jumpPending = true;
    this.inAcc += dt;
    if (this.inAcc >= 1 / INPUT_HZ) {
      this.inAcc = 0;
      this.room.send({ t: 'in', a: [inp.turn, +inp.forward, +inp.brake, +inp.sprint, +this.jumpPending, r2(inp.dirX), r2(inp.dirZ), r2(inp.dirMag)] });
      this.jumpPending = false;
    }
    this.pingAcc += dt;
    if (this.pingAcc > 2) { this.pingAcc = 0; this.room.send({ t: 'p', c: performance.now() }); }

    // Eigener Dackel: lokal vorausrechnen, sanft zum Host-Zustand ziehen
    if (me?.dog) {
      const ev = me.dog.update(dt, me.alive ? inp : IDLE, world);
      if (me.alive) this._dogEvents(me, ev, null);
      this._correct(me, dt);
    }
    // Andere Dackel: interpoliert aus den Schnappschüssen
    if (this.hostClock !== null) {
      const target = this.lastTs + (performance.now() - this.lastTsAt) / 1000 - INTERP_DELAY;
      this.hostClock += dt;
      if (Math.abs(target - this.hostClock) > 0.3) this.hostClock = target;
      else this.hostClock += (target - this.hostClock) * Math.min(1, dt * 2);
      for (const p of this.players.values()) {
        if (p.id === this.myId || !p.dog) continue;
        const s = this._interp(p);
        if (s) {
          const ev = p.dog.remoteUpdate(dt, s);
          this._dogEvents(p, ev, null);
        }
      }
    }
    // Optimistisch: eigene Wurst sofort verstecken, Host bestätigt gleich
    if (me?.dog && me.alive) {
      const s = sausages.checkEat(me.dog.mouth(_m), false);
      if (s) { sausages.setHidden(s, true); s.hideT = 0; }
    }
    for (const s of sausages.list) {
      if (!s.hidden) continue;
      s.hideT = (s.hideT || 0) + dt;
      if (s.hideT > 1) sausages.setHidden(s, false);
    }
  }

  _interp(p) {
    const buf = p.buf, t = this.hostClock;
    if (!buf.length) return null;
    while (buf.length > 2 && buf[1].ts <= t) buf.shift();
    const a = buf[0], b = buf[1];
    if (!b || t <= a.ts) return a;
    if (t >= b.ts) return b;
    const k = (t - a.ts) / (b.ts - a.ts);
    const o = this._s;
    Object.assign(o, b);
    o.x = a.x + (b.x - a.x) * k;
    o.y = a.y + (b.y - a.y) * k;
    o.z = a.z + (b.z - a.z) * k;
    o.heading = lerpAngle(a.heading, b.heading, k);
    o.speed = a.speed + (b.speed - a.speed) * k;
    return o;
  }

  _correct(me, dt) {
    const h = me.host, d = me.dog;
    if (!h) return;
    me.hostAge += dt;
    // Host-Zustand ist etwa rtt/2 + Alter des Schnappschusses alt -> entlang der Richtung vorausrechnen
    const lead = Math.min(0.35, this.rtt / 2 + me.hostAge);
    const px = h.x + Math.cos(h.heading) * h.speed * lead, pz = h.z - Math.sin(h.heading) * h.speed * lead;
    const ex = px - d.pos.x, ez = pz - d.pos.z;
    const err = Math.hypot(ex, ez);
    if (err > 3) {
      d.pos.x = px; d.pos.z = pz; d.heading = h.heading;
      d.path.push({ x: d.pos.x, y: d.pos.y, z: d.pos.z });
    } else if (err > 0.03) {
      const k = 1 - Math.exp(-dt * 3);
      d.pos.x += ex * k; d.pos.z += ez * k;
    }
    let dh = h.heading - d.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    if (Math.abs(dh) > 0.7) d.heading = h.heading;
    else if (Math.abs(d.omega) < 0.2) d.heading += dh * (1 - Math.exp(-dt * 2));
    d.stamina += (h.stamina - d.stamina) * (1 - Math.exp(-dt * 2));
    if (h.dead && me.alive) this._knockOut(me, 'self');
  }

  _snapshot(m) {
    this.lastTs = m.ts;
    this.lastTsAt = performance.now();
    if (this.hostClock === null) this.hostClock = m.ts - INTERP_DELAY;
    this.timeLeft = m.tl;
    for (const e of m.ev || []) this._event(e);
    for (const e of m.d) {
      const p = this.players.get(e[0]);
      if (!p || !p.dog) continue;
      const flags = e[7];
      const st = {
        ts: m.ts, x: e[1], y: e[2], z: e[3], heading: e[4], speed: e[5], targetSeg: e[6],
        onGround: !!(flags & F_GROUND), sprinting: !!(flags & F_SPRINT), inWater: !!(flags & F_WATER), dead: !!(flags & F_DEAD), exhausted: !!(flags & F_EXH),
        stamina: e[8], boost: e[9],
      };
      p.eaten = e[10];
      if (p.id === this.myId) {
        p.host = st;
        p.hostAge = 0;
        p.dog.targetSeg = st.targetSeg;
        if (Math.abs(p.dog.boost - st.boost) > 0.5) p.dog.boost = st.boost;
      } else {
        p.buf.push(st);
        if (p.buf.length > 30) p.buf.shift();
      }
    }
    // Würste abgleichen (falls ein Ereignis verloren ging)
    if (m.si) {
      const ids = new Set(m.si);
      const S = this.ctx.sausages;
      for (let i = S.list.length - 1; i >= 0; i--) if (!ids.has(S.list[i].id)) S._remove(i);
    }
  }

  _event(e) {
    const S = this.ctx.sausages, sound = this.ctx.sound;
    const p = this.players.get(e[1]);
    switch (e[0]) {
      case 'sp': if (!S.byId(e[1])) S.spawnAt(e[1], e[2], e[3], e[4]); break;
      case 'eat': {
        const s = S.removeById(e[1]);
        const q = this.players.get(e[2]);
        if (!q?.dog) break;
        q.dog.feed(e[3]);
        if (s) this._eatFx(s, q);
        else if (q.id === this.myId) { // schon vorher versteckt -> nur Ton
          if (e[3] === 'gold') { sound.gold(); this.ctx.ui.toast('+3 Goldwurst!', 'gold'); } else if (e[3] === 'chain') { sound.boost(); this.ctx.ui.toast('Turbo!', 'boost'); } else sound.snap();
        }
        break;
      }
      case 'ko': if (p) this._knockOut(p, e[2]); break;
      case 'j': if (p?.dog && p.id !== this.myId && this._near(p.dog)) sound.jump(); break;
      case 'l': if (p?.dog && p.id !== this.myId && this._near(p.dog)) sound.land(); break;
      case 'w': if (p?.dog && p.id !== this.myId && this._near(p.dog)) sound.splash(); break;
      case 'left':
        if (p) { this._removeDog(p); this.players.delete(p.id); this.ctx.ui.toast(`${p.name} hat das Spiel verlassen`); }
        break;
    }
  }
}
