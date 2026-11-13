// Raumcodes wie "WURST-42": leicht zu diktieren, werden auf eine PeerJS-ID abgebildet.
import { PEER_PREFIX } from './config.js';

const WORDS = ['WURST', 'DACKEL', 'WALDI', 'SENF', 'KNOCHEN', 'PFOTE', 'GARTEN', 'TEICH', 'POLKA', 'BRATWURST', 'SCHNAUZE', 'HOPP', 'TURBO', 'ZAUN', 'RAMPE', 'KORB'];

export function randomCode() {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = 10 + Math.floor(Math.random() * 90);
  return `${w}-${n}`;
}

// Eingabe aufräumen: "wurst 42", "Wurst42", "WURST-42" -> "WURST-42"
export function normalizeCode(text) {
  let s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  s = s.replace(/^([A-Z]+)(\d+)$/, '$1-$2');
  return /^[A-Z]+-\d{2,3}$/.test(s) ? s : null;
}

export function peerIdFor(code) {
  return PEER_PREFIX + code;
}
