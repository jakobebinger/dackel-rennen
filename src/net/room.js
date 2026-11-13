// Dünne Hülle um PeerJS: ein Host öffnet einen Raum (Peer-ID aus dem Raumcode),
// Mitspieler verbinden sich direkt per WebRTC-DataChannel.
// Nachrichten sind kleine JSON-Objekte mit kurzen Schlüsseln.
import { Peer } from 'peerjs';
import { iceServers, CONNECT_TIMEOUT, PROTOCOL, MAX_PLAYERS } from './config.js';
import { randomCode, peerIdFor } from './codes.js';

export const ERR_NOT_FOUND = 'Raum nicht gefunden. Code richtig abgetippt?';
export const ERR_CONNECT = 'Verbindung fehlgeschlagen – evtl. blockiert das Netzwerk direkte Verbindungen (Schul-WLAN / Mobilfunk).';
export const ERR_SERVER = 'Keine Verbindung zum Vermittlungsserver. Internet an?';
export const ERR_FULL = `Der Raum ist schon voll (max. ${MAX_PLAYERS} Spieler).`;
export const ERR_BUSY = 'In diesem Raum läuft gerade ein Spiel. Später nochmal versuchen.';
export const ERR_VERSION = 'Der Host hat eine andere Spielversion. Alle brauchen dieselbe Datei.';
export const ERR_HOST_LEFT = 'Der Host hat das Spiel verlassen.';
export const ERR_BROWSER = 'Dieser Browser kann keine direkten Verbindungen (WebRTC). Die Datei in Chrome, Edge, Firefox oder Safari öffnen – nicht in einer Vorschau/App.';

// PeerJS-Fehler -> deutsche Meldung (mit Fehlertyp zur Diagnose)
function serverError(e) {
  if (e && e.type === 'browser-incompatible') return ERR_BROWSER;
  return `${ERR_SERVER} (${(e && e.type) || 'Zeitüberschreitung'})`;
}
const hasRtc = () => typeof RTCPeerConnection !== 'undefined' && typeof WebSocket !== 'undefined';

function peerOptions() {
  return {
    host: '0.peerjs.com', port: 443, secure: true, // Cloud-Server, auch von file:// erreichbar
    debug: 0,
    config: { iceServers: iceServers() },
  };
}

const CONN_OPTS = { reliable: true, serialization: 'json' };
const TAB_ID = Math.random().toString(36).slice(2, 12); // erkennt doppelte Verbindungen derselben Seite

// ---------- Host ----------
export class HostRoom {
  constructor() {
    this.peer = null;
    this.code = null;
    this.conns = new Map(); // playerId -> DataConnection
    this.nextId = 2; // 1 = Host
    this.accepting = true;
    this.onJoin = null; // (id, name)
    this.onLeave = null; // (id)
    this.onMessage = null; // (id, msg)
  }

  // Raum öffnen, gibt Promise mit Raumcode zurück (freie ID wird gesucht)
  open() {
    return new Promise((resolve, reject) => {
      if (!hasRtc()) { reject(new Error(ERR_BROWSER)); return; }
      let tries = 0;
      const attempt = () => {
        const code = randomCode();
        const peer = new Peer(peerIdFor(code), peerOptions());
        let opened = false;
        const timer = setTimeout(() => { if (!opened) { peer.destroy(); reject(new Error(serverError(null))); } }, CONNECT_TIMEOUT);
        peer.on('open', () => {
          opened = true;
          clearTimeout(timer);
          this.peer = peer;
          this.code = code;
          this._listen(peer);
          resolve(code);
        });
        peer.on('error', (e) => {
          if (opened) return this._hostError(e);
          clearTimeout(timer);
          peer.destroy();
          if (e.type === 'unavailable-id' && ++tries < 6) attempt(); // Code schon belegt -> neuer
          else reject(new Error(serverError(e)));
        });
      };
      attempt();
    });
  }

  _hostError(e) {
    // Signalisierungs-Server weg: bestehende Verbindungen laufen weiter, neu verbinden
    if (e.type === 'network' || e.type === 'socket-closed') this.peer?.reconnect?.();
  }

  _listen(peer) {
    peer.on('disconnected', () => { if (!peer.destroyed) try { peer.reconnect(); } catch (e) { /* egal */ } });
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        const meta = conn.metadata || {};
        let refuse = null;
        if (meta.ver !== PROTOCOL) refuse = ERR_VERSION;
        else if (!this.accepting) refuse = ERR_BUSY;
        else {
          // Halbtote Verbindungen (abgebrochener Beitritt, Handy-Fehlversuch, Neuladen) zählen nicht mit
          for (const [oid, oc] of this.conns) {
            if (!oc.open) { this.conns.delete(oid); try { oc.close(); } catch (e) { /* egal */ } this.onLeave?.(oid); }
          }
          if (this.conns.size >= MAX_PLAYERS - 1) refuse = ERR_FULL;
        }
        if (refuse) {
          conn.send({ t: 'nein', msg: refuse });
          setTimeout(() => conn.close(), 300);
          return;
        }
        // Dieselbe Seite nochmal verbunden (Doppelklick, Neuladen)? Alte Verbindung raus, sonst Geister-Dackel
        for (const [oid, oc] of this.conns) {
          if (meta.tab && oc.metadata?.tab === meta.tab) { this.conns.delete(oid); try { oc.close(); } catch (e) { /* egal */ } this.onLeave?.(oid); }
        }
        const id = this.nextId++;
        this.conns.set(id, conn);
        conn.on('data', (m) => this.onMessage?.(id, m));
        const bye = () => {
          if (this.conns.get(id) !== conn) return;
          this.conns.delete(id);
          this.onLeave?.(id);
        };
        conn.on('close', bye);
        conn.on('error', bye);
        // Tab zu / neu geladen: ICE meldet erst "disconnected" -> nach 6 s ohne Erholung rauswerfen
        let lost = null;
        conn.on('iceStateChanged', (s) => {
          if (s === 'failed' || s === 'closed') bye();
          else if (s === 'disconnected') { if (!lost) lost = setTimeout(() => { try { conn.close(); } catch (e) { /* egal */ } bye(); }, 6000); }
          else if (lost) { clearTimeout(lost); lost = null; }
        });
        this.onJoin?.(id, String(meta.name || '').slice(0, 16) || 'Dackel');
      });
    });
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) try { c.send(msg); } catch (e) { /* Verbindung gerade weg */ }
  }
  broadcast(msg) {
    for (const id of this.conns.keys()) this.send(id, msg);
  }

  close() {
    for (const c of this.conns.values()) try { c.close(); } catch (e) { /* egal */ }
    this.conns.clear();
    try { this.peer?.destroy(); } catch (e) { /* egal */ }
    this.peer = null;
  }
}

// ---------- Mitspieler ----------
export class ClientRoom {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.onMessage = null; // (msg)
    this.onClose = null; // (reason)
    this._closed = false;
  }

  // Mit Raumcode verbinden; Promise erfüllt sich, sobald der DataChannel offen ist
  connect(code, name) {
    return new Promise((resolve, reject) => {
      if (!hasRtc()) { reject(new Error(ERR_BROWSER)); return; }
      let done = false;
      const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); this.close(); reject(new Error(msg)); };
      const timer = setTimeout(() => fail(ERR_CONNECT), CONNECT_TIMEOUT);
      const peer = new Peer(undefined, peerOptions());
      this.peer = peer;
      peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') fail(ERR_NOT_FOUND);
        else if (!done) fail(e.type === 'webrtc' || e.type === 'disconnected' ? ERR_CONNECT : serverError(e));
        else if (e.type === 'network' || e.type === 'socket-closed') { if (!peer.destroyed) try { peer.reconnect(); } catch (x) { /* egal */ } }
      });
      peer.on('open', () => {
        const conn = peer.connect(peerIdFor(code), { ...CONN_OPTS, metadata: { name, ver: PROTOCOL, tab: TAB_ID } });
        this.conn = conn;
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        });
        conn.on('data', (m) => {
          if (m && m.t === 'nein') { fail(m.msg || ERR_CONNECT); this._bye(m.msg); return; }
          this.onMessage?.(m);
        });
        conn.on('close', () => this._bye(ERR_HOST_LEFT));
        conn.on('error', () => this._bye(ERR_HOST_LEFT));
        conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') this._bye(ERR_HOST_LEFT); });
      });
    });
  }

  _bye(reason) {
    if (this._closed) return;
    this._closed = true;
    const cb = this.onClose;
    this.close();
    cb?.(reason);
  }

  send(msg) {
    if (this.conn && this.conn.open) try { this.conn.send(msg); } catch (e) { /* egal */ }
  }

  close() {
    this._closed = true;
    try { this.conn?.close(); } catch (e) { /* egal */ }
    try { this.peer?.destroy(); } catch (e) { /* egal */ }
    this.conn = null;
    this.peer = null;
  }
}
