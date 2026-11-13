// Soundeffekte mit WebAudio (alles synthetisch, keine Dateien).
const VOL = 0.55;

export class Sound {
  constructor(muted) {
    this.muted = !!muted;
    this.ctx = null;
    this.music = new Polka(this);
    // Tab im Hintergrund: alles anhalten
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else this.ctx.resume();
    });
  }

  // muss in einem Klick/Tastendruck aufgerufen werden
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = (this.ctx = new AC());
        this.out = ctx.createGain();
        this.out.gain.value = this.muted ? 0 : VOL;
        const comp = ctx.createDynamicsCompressor();
        this.out.connect(comp);
        comp.connect(ctx.destination);
        const len = ctx.sampleRate;
        this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.music._init();
    } catch (e) {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.out.gain.setTargetAtTime(m ? 0 : VOL, this.ctx.currentTime, 0.02);
  }

  _ok() {
    return this.ctx && !this.muted && this.ctx.state === 'running';
  }

  _env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _osc(type, f0, f1, t, dur, peak, dest) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    this._env(g, t, 0.006, peak, dur);
    o.connect(g);
    g.connect(dest || this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _noise(t, dur, peak, type, freq, q = 1) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this._env(g, t, 0.004, peak, dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  snap() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.05, 0.5, 'bandpass', 2600, 1.2);
    this._osc('square', 420, 140, t, 0.07, 0.15);
    this._osc('sine', 220, 90, t + 0.02, 0.09, 0.35);
  }

  gold() {
    if (!this._ok()) return;
    this.snap();
    const t = this.ctx.currentTime;
    [784, 988, 1319, 1568].forEach((f, i) => this._osc('triangle', f, f * 1.01, t + 0.06 + i * 0.07, 0.14, 0.16));
  }

  boost() {
    if (!this._ok()) return;
    this.snap();
    const t = this.ctx.currentTime;
    this._osc('sawtooth', 160, 900, t + 0.03, 0.35, 0.06);
    this._noise(t + 0.03, 0.4, 0.18, 'highpass', 1800, 0.7);
  }

  _barkAt(t, p) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(380 * p, t);
    o.frequency.linearRampToValueAtTime(640 * p, t + 0.03);
    o.frequency.exponentialRampToValueAtTime(230 * p, t + 0.17);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 1.4;
    const g = c.createGain();
    this._env(g, t, 0.008, 0.7, 0.17);
    o.connect(bp);
    bp.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
    this._noise(t, 0.08, 0.15, 'bandpass', 1500, 1);
  }

  bark() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime + 0.02;
    this._barkAt(t, 1);
    this._barkAt(t + 0.24, 0.92);
  }

  jump() {
    if (!this._ok()) return;
    this._osc('sine', 280, 600, this.ctx.currentTime, 0.12, 0.12);
  }

  land() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._osc('sine', 130, 55, t, 0.12, 0.25);
    this._noise(t, 0.08, 0.12, 'lowpass', 500);
  }

  splash() {
    if (!this._ok()) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.3, 0.35, 'lowpass', 1400);
    this._noise(t + 0.03, 0.15, 0.12, 'bandpass', 3200, 1.5);
  }

  bump() {
    if (!this._ok()) return;
    this._osc('sine', 160, 80, this.ctx.currentTime, 0.08, 0.15);
  }

  over() {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.9);
    const lfo = c.createOscillator();
    lfo.frequency.value = 7;
    const lg = c.createGain();
    lg.gain.value = 18;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = c.createGain();
    this._env(g, t, 0.05, 0.35, 0.9);
    o.connect(g);
    g.connect(this.out);
    o.start(t); lfo.start(t);
    o.stop(t + 1.05); lfo.stop(t + 1.05);
  }

  click() {
    if (!this._ok()) return;
    this._osc('sine', 900, 700, this.ctx.currentTime, 0.04, 0.08);
  }
}

// ---------- Polka-Musik (Tuba, Akkordeon, Schlagzeug – alles synthetisch) ----------
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Akkorde: Tuba wechselt Grundton/Quinte ("Um"), Akkordeon spielt den "Pa"
const CHORDS = {
  F: { bass: [41, 36], stab: [57, 60, 65] },
  C: { bass: [36, 43], stab: [55, 58, 60, 64] },
  B: { bass: [46, 41], stab: [58, 62, 65] },
};
const PROG = 'FFCCCCFF' + 'FFBBFFCF';

// Melodie: pro Takt (2/4) Liste aus [MIDI-Note, Achtel], 0 = Pause
const MELODY = [
  [[72, 1], [69, 1], [65, 1], [69, 1]],
  [[72, 1], [74, 0.5], [72, 0.5], [69, 1], [65, 1]],
  [[70, 1], [67, 1], [64, 1], [67, 1]],
  [[70, 1], [72, 0.5], [70, 0.5], [67, 1], [64, 1]],
  [[72, 1], [70, 1], [69, 1], [67, 1]],
  [[76, 1], [74, 1], [72, 1], [70, 1]],
  [[69, 1], [72, 1], [77, 1], [0, 1]],
  [[77, 1], [72, 1], [65, 1], [0, 1]],
  [[69, 0.5], [70, 0.5], [72, 1], [72, 1], [72, 1]],
  [[74, 0.5], [72, 0.5], [70, 0.5], [69, 0.5], [72, 2]],
  [[74, 1], [77, 1], [74, 1], [70, 1]],
  [[72, 0.5], [74, 0.5], [77, 1], [74, 1], [70, 1]],
  [[72, 1], [69, 1], [72, 1], [77, 1]],
  [[69, 1], [72, 1], [77, 1], [81, 1]],
  [[79, 0.5], [77, 0.5], [76, 0.5], [74, 0.5], [72, 0.5], [70, 0.5], [67, 0.5], [64, 0.5]],
  [[77, 1], [0, 1], [65, 1], [0, 1]],
];
const STEPS = PROG.length * 8; // Sechzehntel pro Durchlauf

export class Polka {
  constructor(sound) {
    this.s = sound;
    this.enabled = true;
    this.mode = 'off'; // 'menu' | 'play' | 'pause' | 'off'
    this.bpm = this.target = 108;
    this.step = 0;
    this.loop = 0;
    this.next = 0;
    this.bus = null;
    // Melodie in ein Sechzehntel-Raster umrechnen
    this.mel = MELODY.map((bar) => {
      const a = new Array(8).fill(null);
      let p = 0;
      for (const [m, e] of bar) {
        if (m) a[p] = { m, len: e * 2 };
        p += e * 2;
      }
      return a;
    });
  }

  // wird von Sound.unlock() aufgerufen, sobald es einen AudioContext gibt
  _init() {
    const c = this.s.ctx;
    if (!c || this.bus) return;
    this.bus = c.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.s.out);
    this.timer = setInterval(() => this._tick(), 25);
    this._apply();
  }

  setEnabled(on) {
    this.enabled = on;
    this._apply();
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'off') { this.step = 0; this.loop = 0; this.next = 0; }
    this.mode = mode;
    if (mode === 'menu') this.target = 108;
    this._apply();
  }

  setTempo(bpm) {
    this.target = bpm;
  }

  _apply() {
    if (!this.bus) return;
    const c = this.s.ctx;
    const vol = !this.enabled ? 0 : { play: 0.85, menu: 0.6, pause: 0.22, off: 0 }[this.mode];
    this.bus.gain.setTargetAtTime(vol, c.currentTime, this.mode === 'off' ? 0.25 : 0.12);
  }

  _tick() {
    const c = this.s.ctx;
    if (!c || c.state !== 'running') return;
    if (!this.enabled || this.s.muted || this.mode === 'off') {
      if (this.mode === 'off') { this.step = 0; this.loop = 0; }
      this.next = 0;
      return;
    }
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05;
    while (this.next < c.currentTime + 0.15) {
      this._play(this.step, this.next);
      this.bpm += (this.target - this.bpm) * 0.04;
      this.next += 15 / this.bpm; // ein Sechzehntel
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.loop++;
    }
  }

  _play(step, t) {
    const bar = step >> 3, pos = step & 7;
    const ch = CHORDS[PROG[bar]];
    const sd = 15 / this.bpm;
    const drums = this.mode !== 'menu';
    if (pos === 0 || pos === 4) {
      this._tuba(ch.bass[pos >> 2], t, sd * 2.2);
      if (drums) this._kick(t);
    }
    if (pos === 2 || pos === 6) {
      this._stab(ch.stab, t, sd * 1.4);
      if (drums) this._hat(t, pos === 6);
    }
    const ev = this.mel[bar][pos];
    if (ev) {
      this._lead(ev.m, t, ev.len * sd);
      // ab dem zweiten Durchlauf glitzert ein Glockenspiel mit
      if (this.loop % 2 === 1) this._bell(ev.m + 12, t);
    }
  }

  _gain(t, peak, dur, attack = 0.01) {
    const g = this.s.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _tuba(m, t, d) {
    const c = this.s.ctx, f = mtof(m);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + d);
    lp.Q.value = 3;
    const g = this._gain(t, 0.32, d, 0.015);
    lp.connect(g);
    g.connect(this.bus);
    for (const [type, mul] of [['sawtooth', 1], ['sine', 1], ['sine', 2]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * mul * 0.97, t); // leichtes "Anblasen"
      o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.03);
      o.connect(lp);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  // Akkordeon: zwei leicht verstimmte Zungen pro Ton (Musette-Klang)
  _reeds(f, t, d, dest) {
    const c = this.s.ctx;
    for (const det of [1, 1.008]) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f * det;
      o.connect(dest);
      o.start(t);
      o.stop(t + d + 0.05);
    }
  }

  _stab(notes, t, d) {
    const c = this.s.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const g = this._gain(t, 0.05, d, 0.008);
    lp.connect(g);
    g.connect(this.bus);
    for (const m of notes) this._reeds(mtof(m), t, d, lp);
  }

  _lead(m, t, d) {
    const c = this.s.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = c.createGain();
    const end = t + d * 0.92;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.012);
    g.gain.setValueAtTime(0.075, Math.max(t + 0.013, end - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(g);
    g.connect(this.bus);
    this._reeds(mtof(m), t, d, lp);
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m) * 0.996;
    const og = c.createGain();
    og.gain.value = 0.6;
    o.connect(og);
    og.connect(lp);
    o.start(t);
    o.stop(t + d + 0.05);
  }

  _bell(m, t) {
    const c = this.s.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    const g = this._gain(t, 0.035, 0.35, 0.004);
    o.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + 0.4);
  }

  _kick(t) {
    const c = this.s.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = this._gain(t, 0.3, 0.14, 0.004);
    o.connect(g);
    g.connect(this.bus);
    o.start(t);
    o.stop(t + 0.2);
  }

  _hat(t, snare) {
    const c = this.s.ctx;
    const s = c.createBufferSource();
    s.buffer = this.s.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = snare ? 'bandpass' : 'highpass';
    f.frequency.value = snare ? 2200 : 7000;
    const g = this._gain(t, snare ? 0.1 : 0.07, snare ? 0.1 : 0.05, 0.003);
    s.connect(f);
    f.connect(g);
    g.connect(this.bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + 0.15);
  }
}
