// Online-Bildschirme: Name, Beitreten, Lobby, Rundenende, Esc-Overlay, Spielerliste im HUD.
import { FUR_COLORS } from './dog.js';
import { formatTime } from './ui.js';
import { normalizeCode } from './net/codes.js';

const NICK_KEY = 'dackel-rennen.nick';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const MODE_NAMES = { battle: 'Battle', race: 'Zeitrennen' };

export class MpUi {
  constructor(ui, sound) {
    this.ui = ui;
    this.el = {
      nick: $('nick'), mpError: $('mpError'), joinCode: $('joinCode'), joinError: $('joinError'),
      lobbyCode: $('lobbyCode'), lobbyPlayers: $('lobbyPlayers'), lobbyHostOpts: $('lobbyHostOpts'), lobbyRelaxed: $('lobbyRelaxed'),
      lobbyInfo: $('lobbyInfo'), lobbyStart: $('btnLobbyStart'), mpOverTitle: $('mpOverTitle'), mpOverText: $('mpOverText'),
      mpRank: $('mpRank'), mpAgain: $('btnMpAgain'), mpOverWait: $('mpOverWait'), mpList: $('mpList'), spectate: $('spectate'),
      countdown: $('countdown'), joinGo: $('btnJoinGo'), host: $('btnHost'), join: $('btnJoin'),
    };
    // Rückrufe, werden vom Multiplayer-Modul gesetzt
    this.onHost = null; this.onJoin = null; this.onStart = null; this.onLeave = null;
    this.onSettings = null; this.onAgain = null; this.onMenu = null; this.onResume = null;

    try { this.el.nick.value = localStorage.getItem(NICK_KEY) || ''; } catch (e) { /* kein Speicher */ }
    this.el.nick.addEventListener('change', () => { try { localStorage.setItem(NICK_KEY, this.nick()); } catch (e) { /* egal */ } });

    const click = (id, fn) => $(id).addEventListener('click', () => { sound.unlock(); sound.click(); fn(); });
    click('btnHost', () => this.onHost?.());
    click('btnJoin', () => { this.error('join', null); ui.show('join'); setTimeout(() => this.el.joinCode.focus(), 50); });
    click('btnJoinBack', () => ui.show('start'));
    click('btnJoinGo', () => this._join());
    this.el.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._join(); } });
    click('btnLobbyStart', () => this.onStart?.());
    click('btnLobbyLeave', () => this.onLeave?.());
    click('btnMpAgain', () => this.onAgain?.());
    click('btnMpMenu', () => this.onMenu?.());
    click('btnMpResume', () => this.onResume?.());
    click('btnMpLeave', () => this.onLeave?.());
    for (const r of document.querySelectorAll('input[name="mpMode"]')) r.addEventListener('change', () => this._settings());
    this.el.lobbyRelaxed.addEventListener('change', () => this._settings());
    this._listLast = '';
  }

  nick() {
    return this.el.nick.value.trim().slice(0, 16) || 'Dackel';
  }

  _join() {
    const code = normalizeCode(this.el.joinCode.value);
    if (!code) { this.error('join', 'Bitte einen Code wie WURST-42 eingeben.'); return; }
    this.el.joinCode.value = code;
    this.onJoin?.(code);
  }

  _settings() {
    const mode = document.querySelector('input[name="mpMode"]:checked')?.value || 'battle';
    this.el.lobbyRelaxed.closest('.switch').classList.toggle('hidden', mode !== 'battle');
    this.onSettings?.({ mode, relaxed: this.el.lobbyRelaxed.checked });
  }

  settings() {
    return { mode: document.querySelector('input[name="mpMode"]:checked')?.value || 'battle', relaxed: this.el.lobbyRelaxed.checked };
  }

  // where: 'start' | 'join'; msg null = ausblenden
  error(where, msg) {
    const el = where === 'join' ? this.el.joinError : this.el.mpError;
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  // nach dem Verlassen: alte Lobby-Daten weg
  resetLobby() {
    this.el.lobbyCode.textContent = '…';
    this.el.lobbyPlayers.innerHTML = '';
    this.el.mpList.innerHTML = '';
    this._listLast = '';
  }

  busy(b) {
    for (const el of [this.el.host, this.el.join, this.el.joinGo]) el.disabled = b;
    this.el.joinGo.textContent = b ? 'Verbinde…' : 'Verbinden';
    this.el.host.textContent = b ? 'Erstelle…' : 'Spiel erstellen';
  }

  // players: [{ id, name, color }], settings: { mode, relaxed }
  showLobby({ code, players, settings, isHost, myId }) {
    this.el.lobbyCode.textContent = code || '…';
    this.el.lobbyPlayers.innerHTML = players.map((p) => {
      const c = FUR_COLORS[p.color];
      return `<li><i class="dot" style="background:${c.css}"></i>${esc(p.name)}${p.id === myId ? ' (du)' : ''}<small>${p.id === 1 ? 'Host · ' : ''}${c.name}</small></li>`;
    }).join('');
    this.el.lobbyHostOpts.classList.toggle('hidden', !isHost);
    this.el.lobbyStart.classList.toggle('hidden', !isHost);
    if (isHost) {
      this.el.lobbyStart.disabled = players.length < 2;
      this.el.lobbyInfo.textContent = players.length < 2 ? 'Warten auf Mitspieler… (2–8 Spieler)' : `${players.length} Spieler bereit.`;
    } else {
      const m = MODE_NAMES[settings.mode] || settings.mode;
      this.el.lobbyInfo.textContent = `Modus: ${m}${settings.mode === 'battle' && settings.relaxed ? ' (entspannt)' : ''} · Warten auf den Host…`;
    }
    this.ui.show('lobby');
  }

  // rank: [{ name, color, cm, count, alive, me }]
  showOver({ rank, mode, isHost }) {
    const w = rank[0];
    this.el.mpOverTitle.textContent = w ? `${w.name} gewinnt!` : 'Runde vorbei';
    this.el.mpOverText.textContent = mode === 'battle'
      ? (rank.some((r) => r.alive) && rank.filter((r) => r.alive).length === 1 ? 'Letzter Dackel im Garten.' : 'Zeit abgelaufen – der längste Dackel gewinnt.')
      : 'Zeit abgelaufen – der längste Dackel gewinnt.';
    this.el.mpRank.innerHTML = rank.map((r, i) => {
      const c = FUR_COLORS[r.color];
      return `<li class="${i === 0 ? 'first' : ''}${r.alive ? '' : ' out'}"><span class="pos">${i + 1}.</span><i class="dot" style="background:${c.css}"></i><b>${esc(r.name)}${r.me ? ' (du)' : ''}</b><span>${r.cm} cm · ${r.count} Würste</span></li>`;
    }).join('');
    this.el.mpAgain.classList.toggle('hidden', !isHost);
    this.el.mpOverWait.classList.toggle('hidden', isHost);
    this.ui.show('mpover');
  }

  countdown(n) {
    const el = this.el.countdown;
    const text = n === null ? '' : n > 0 ? String(n) : 'Los!';
    if (el.textContent !== text) {
      el.textContent = text;
      el.classList.toggle('hidden', !text);
      if (text) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = 'pop 0.35s cubic-bezier(0.2, 1.4, 0.4, 1)'; }
    }
  }

  // Kleine Rangliste im HUD, players: [{ id, name, color, cm, alive }]
  list(players, myId) {
    const html = players.map((p) => `<div class="${p.alive ? '' : 'out'}${p.id === myId ? ' me' : ''}"><i class="dot" style="background:${FUR_COLORS[p.color].css}"></i>${esc(p.name)} · ${p.cm}</div>`).join('');
    if (html !== this._listLast) { this._listLast = html; this.el.mpList.innerHTML = html; }
    this.el.mpList.classList.remove('hidden');
  }

  hideList() {
    this.el.mpList.classList.add('hidden');
    this.spectating(false);
  }

  spectating(on) {
    this.el.spectate.classList.toggle('hidden', !on);
  }

  // Zeit im HUD als Restzeit
  timeLeft(sec) {
    this.ui._set('time', this.ui.el.time, formatTime(Math.max(0, sec)));
  }
}
