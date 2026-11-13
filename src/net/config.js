// Netzwerk-Einstellungen für den Online-Modus (PeerJS / WebRTC).
//
// Signalisierung läuft über den kostenlosen PeerJS-Cloud-Server (0.peerjs.com),
// die eigentlichen Spieldaten gehen direkt von Browser zu Browser (WebRTC).

// Präfix für die Peer-IDs, damit sich Raumcodes nicht mit anderen PeerJS-Apps überschneiden.
export const PEER_PREFIX = 'dackelrennen-v1-';

// Protokoll-Version: Host und Mitspieler müssen dieselbe Datei haben.
export const PROTOCOL = 2; // 2 = bis 8 Spieler

// Google-STUN-Server: reichen im Heim-WLAN meistens aus.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ---------- Optional: TURN-Server ----------
// Nur nötig, wenn direkte Verbindungen blockiert werden (Mobilfunk, Schul-WLAN,
// strenge Firewalls). Ohne TURN klappt es im normalen Heim-WLAN.
// Kostenlos z. B. bei https://www.metered.ca/ (Account anlegen, "TURN credentials"
// kopieren) und hier eintragen. Leer lassen = kein TURN.
export const TURN = {
  urls: '',       // z. B. 'turn:a.relay.metered.ca:80'
  username: '',   // z. B. 'abc123...'
  credential: '', // z. B. 'xyz789...'
};

export function iceServers() {
  const list = [...ICE_SERVERS];
  if (TURN.urls) list.push({ urls: TURN.urls, username: TURN.username, credential: TURN.credential });
  return list;
}

export const CONNECT_TIMEOUT = 12000; // ms bis "Verbindung fehlgeschlagen"
export const INPUT_HZ = 30; // Mitspieler -> Host
export const SNAPSHOT_HZ = 20; // Host -> Mitspieler
export const ROUND_SECONDS = 180; // 3 Minuten
export const MAX_PLAYERS = 8;
