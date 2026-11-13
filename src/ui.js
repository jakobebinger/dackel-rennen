// HUD, Bildschirme (Start, Pause, Game Over), Einstellungen + Highscore (localStorage).
const LS_KEY = 'dackel-rennen.v1';
const $ = (id) => document.getElementById(id);

export function formatTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export class UI {
  constructor() {
    this.data = { muted: false, relaxed: false, music: true, best: null };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY));
      if (saved && typeof saved === 'object') Object.assign(this.data, saved);
    } catch (e) { /* kein Speicher verfügbar */ }
    this.el = {
      hud: $('hud'), len: $('hLen'), count: $('hCount'), time: $('hTime'), stam: $('hStam'),
      stamWrap: $('stamina'), boost: $('boostTag'), relaxTag: $('relaxTag'), toasts: $('toasts'),
      mute: $('btnMute'), pause: $('btnPause'),
      start: $('screenStart'), paused: $('screenPause'), over: $('screenOver'),
      best: $('bestLine'), overStats: $('overStats'), overRecord: $('overRecord'), overTitle: $('overTitle'), overText: $('overText'),
      relaxed: [...document.querySelectorAll('.relaxed-toggle')],
      music: [...document.querySelectorAll('.music-toggle')],
    };
    this._last = {};
    this.el.relaxed.forEach((c) => {
      c.checked = this.data.relaxed;
      c.addEventListener('change', () => this.setRelaxed(c.checked));
    });
    this.onMusic = null;
    this.el.music.forEach((c) => {
      c.checked = this.data.music;
      c.addEventListener('change', () => this.onMusic?.(c.checked));
    });
    this._renderMute();
    this._renderBest();
    this._renderRelax();
  }

  save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.data)); } catch (e) { /* egal */ }
  }

  get muted() { return this.data.muted; }
  get relaxed() { return this.data.relaxed; }
  get music() { return this.data.music; }

  setMusic(on) {
    this.data.music = on;
    this.el.music.forEach((c) => (c.checked = on));
    this.save();
  }

  setMuted(m) {
    this.data.muted = m;
    this.save();
    this._renderMute();
  }
  setRelaxed(r) {
    this.data.relaxed = r;
    this.el.relaxed.forEach((c) => (c.checked = r));
    this.save();
    this._renderRelax();
  }

  _renderMute() {
    const m = this.data.muted;
    this.el.mute.classList.toggle('muted', m);
    this.el.mute.setAttribute('aria-label', m ? 'Ton an' : 'Ton aus');
    this.el.mute.title = m ? 'Ton an (M)' : 'Ton aus (M)';
  }
  _renderRelax() {
    this.el.relaxTag.classList.toggle('hidden', !this.data.relaxed);
  }
  _renderBest() {
    const b = this.data.best;
    this.el.best.textContent = b ? `Rekord: ${b.cm} cm · ${b.count} Würste · ${formatTime(b.time)}` : 'Noch kein Rekord – leg los!';
  }

  // Ergebnis eintragen, gibt true zurück bei neuem Rekord
  submit(cm, count, time) {
    const b = this.data.best;
    const isNew = !b || cm > b.cm;
    if (isNew) {
      this.data.best = { cm, count, time: Math.round(time) };
      this.save();
      this._renderBest();
    }
    return isNew;
  }

  // name: 'start' | 'pause' | 'over' | 'join' | 'lobby' | 'mpover' | 'mppause' | null
  show(name) {
    const screens = { start: 'screenStart', pause: 'screenPause', over: 'screenOver', join: 'screenJoin', lobby: 'screenLobby', mpover: 'screenMpOver', mppause: 'screenMpPause' };
    for (const k in screens) $(screens[k]).classList.toggle('hidden', name !== k);
    document.body.classList.toggle('menu-open', !!name);
  }
  showHud(on) {
    this.el.hud.classList.toggle('hidden', !on);
    document.body.classList.toggle('playing', on);
  }

  _set(key, el, text) {
    if (this._last[key] !== text) {
      this._last[key] = text;
      el.textContent = text;
    }
  }

  hud(cm, count, time, stamina, exhausted, boost) {
    this._set('len', this.el.len, `${cm} cm`);
    this._set('count', this.el.count, String(count));
    this._set('time', this.el.time, formatTime(time));
    const w = Math.round(stamina * 100);
    if (this._last.stam !== w) {
      this._last.stam = w;
      this.el.stam.style.width = w + '%';
    }
    if (this._last.ex !== exhausted) {
      this._last.ex = exhausted;
      this.el.stamWrap.classList.toggle('exhausted', exhausted);
    }
    const b = boost > 0;
    if (this._last.boost !== b) {
      this._last.boost = b;
      this.el.boost.classList.toggle('hidden', !b);
    }
  }

  gameOver({ cm, count, time, isNew, relaxed }) {
    this.el.overTitle.textContent = relaxed ? 'Feierabend!' : 'Autsch!';
    this.el.overText.textContent = relaxed ? 'Waldi ist müde und satt.' : 'Waldi hat sich in den eigenen Rücken gebissen.';
    this.el.overStats.innerHTML =
      `<div><b>${cm} cm</b><span>Länge</span></div>` +
      `<div><b>${count}</b><span>Würste</span></div>` +
      `<div><b>${formatTime(time)}</b><span>Zeit</span></div>`;
    this.el.overRecord.classList.toggle('hidden', !isNew);
    this.show('over');
  }

  toast(text, cls = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + cls;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.remove(), 1400);
  }
}
