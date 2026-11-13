# Dackel-Rennen (Online-Version)

3D-Browserspiel: Steuere einen Dackel durch den Garten, friss Würste und werde immer länger.
Allein oder online mit bis zu 7 Freunden – ohne eigenen Server, direkt von Browser zu Browser.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) (LTS), z. B. per `winget install OpenJS.NodeJS.LTS`.

```
npm install
npm run dev
```

Der Browser öffnet sich automatisch. Vite zeigt auch eine Netzwerk-Adresse an,
damit kannst du das Spiel im selben WLAN auf dem Handy testen.

`npm run build` erzeugt eine fertige Version im Ordner `dist/`.

## Als Webseite (GitHub Pages)

Link zum Spielen (auch auf iPhone/Android): **https://jakobebinger.github.io/dackel-rennen/**

Nach Änderungen am Code:

```
npm run online
```

Baut das Spiel und lädt es hoch (Branch `gh-pages`). Nach 1–2 Minuten ist die neue Version unter demselben Link online.
Den Quellcode selbst sichern: `git add -A`, `git commit -m "..."`, `git push`.

## Als eine Datei verschicken

```
npm run datei
```

Erzeugt `export/Dackel-Rennen.html`: das ganze Spiel in einer einzigen Datei (inkl. Online-Modus).
Verschicken (WhatsApp, Mail, USB-Stick), doppelklicken, spielen. Der Einzelspieler-Modus
geht auch ohne Internet, für den Online-Modus braucht es Internet.
Am besten am PC/Laptop; auf dem iPhone öffnet sich die Datei oft nur als Vorschau.

## Online spielen

1. **Alle brauchen dieselbe Datei** (gleiche Version).
2. Im Startbildschirm unten einen Namen eintippen (wird im Browser gemerkt).
3. Einer klickt **„Spiel erstellen“** und bekommt einen Raumcode wie `WURST-42`.
4. Die anderen klicken **„Beitreten“**, tippen den Code ein (Groß-/Kleinschreibung egal) und landen in der Lobby.
5. Der Host wählt den Modus und drückt **Start** (ab 2 Spielern, max. 8). Nach dem Countdown geht's los.

Jeder Spieler hat eine eigene Fellfarbe (Braun, Schwarz, Blond, Grau, Rot, Creme, Schoko, Blau); über den anderen Dackeln steht der Name.

### Modi

| Modus          | Regeln |
|----------------|--------|
| **Battle**     | Gemeinsame Würste. Wer mit dem Kopf einen anderen Dackel (oder sich selbst, außer „Entspannt“ ist an) berührt, ist raus und schaut zu. Der letzte Dackel gewinnt – oder nach 3 Minuten der längste. |
| **Zeitrennen** | 3 Minuten, niemand fliegt raus. Der längste Dackel am Ende gewinnt. |

Am Ende gibt es eine Rangliste (Name, Länge, Würste). Der Host kann mit **„Nochmal“** sofort eine neue Runde mit
derselben Lobby starten. Im Online-Spiel gibt es keine Pause: `Esc` öffnet nur ein kleines Fenster mit „Verlassen“,
das Spiel läuft weiter.

### Wie das technisch läuft

- Peer-to-Peer per **WebRTC** mit [PeerJS](https://peerjs.com). Zum Finden der Mitspieler wird der kostenlose
  PeerJS-Cloud-Server (`0.peerjs.com`) benutzt, die Spieldaten gehen danach direkt zwischen den Browsern hin und her.
  Es gibt keinen eigenen Server und nichts zu installieren.
- Der Raumcode wird auf eine PeerJS-ID mit Präfix abgebildet (`dackelrennen-v1-WURST-42`). Ist die ID zufällig belegt,
  wird ein neuer Code gewürfelt.
- **Host-autoritativ**: Der Browser des Hosts rechnet das Spiel (Würste, Kollisionen, Punkte, Uhr). Die Mitspieler schicken
  ca. 30-mal pro Sekunde ihre Eingabe, der Host schickt ca. 20-mal pro Sekunde einen Schnappschuss. Der eigene Dackel wird
  lokal vorausberechnet (fühlt sich direkt an) und sanft zum Host-Zustand korrigiert; die anderen Dackel werden ca. 100 ms
  verzögert zwischen zwei Schnappschüssen interpoliert.
- Funktioniert aus der verschickten Datei (`file://`) genauso wie von einer Webseite (`https://`).

### Wenn es nicht klappt

- **„Raum nicht gefunden“**: Code falsch abgetippt, oder der Host hat den Raum schon verlassen.
- **„Verbindung fehlgeschlagen …“**: Das Netzwerk lässt keine direkten Verbindungen zu. Typisch im **Schul-WLAN**, bei
  **Mobilfunk** (Handy-Hotspot) oder hinter strengen Firewalls. Zu Hause im WLAN geht es normalerweise. Abhilfe: ein
  TURN-Server (siehe unten).
- **„Keine Verbindung zum Vermittlungsserver“**: Kein Internet, oder der PeerJS-Cloud-Server ist gerade nicht erreichbar
  (kostenloser Dienst, kann mal hängen). Kurz später nochmal probieren.
- **„Der Host hat das Spiel verlassen“**: Der Host hat die Datei/den Tab geschlossen oder die Verbindung ist abgebrochen.
  Alle landen im Menü, der Host muss einen neuen Raum erstellen.
- **Handy**: Die Datei muss in einem richtigen Browser (Chrome, Safari, Firefox) laufen. Die Vorschau in WhatsApp oder
  in der Dateien-App kann oft keine Verbindungen aufbauen. Am einfachsten: das Spiel als Webseite (`https://…`) hosten
  oder im selben WLAN die Netzwerk-Adresse von `npm run dev` öffnen. In der Fehlermeldung steht in Klammern der
  technische Grund (z. B. `network`, `server-error`), das hilft bei der Suche.
- **Zum Testen auf einem Laptop**: zwei Browser-**Fenster** nebeneinander statt zwei Tabs – ein Tab im Hintergrund
  wird vom Browser gebremst.
- Der **Host-Tab sollte im Vordergrund bleiben**: Browser bremsen Hintergrund-Tabs stark, dann ruckelt es bei allen.
- Je weiter weg der Host, desto mehr Verzögerung. Am besten hostet, wer die beste Internetverbindung hat.

### Optional: TURN-Server eintragen (Schul-WLAN / Mobilfunk)

Wenn direkte Verbindungen blockiert werden, hilft ein TURN-Server, der die Daten weiterleitet. Kostenlos (mit Limit)
z. B. bei [metered.ca](https://www.metered.ca/): Account anlegen, „TURN credentials“ kopieren und in
**`src/net/config.js`** bei `TURN` eintragen:

```js
export const TURN = {
  urls: 'turn:a.relay.metered.ca:80',
  username: '...',
  credential: '...',
};
```

Danach `npm run datei` und die neue Datei an alle schicken. Ohne Eintrag werden nur die Google-STUN-Server benutzt
(reicht im Heim-WLAN).

## Steuerung

| Aktion   | Tastatur          | Handy                 |
|----------|-------------------|-----------------------|
| Laufen   | W A S D / Pfeile  | Joystick (links ziehen) |
| Springen | Leertaste         | „Hopp!“-Knopf         |
| Sprint   | Shift (Ausdauer)  | „Sprint“ halten       |
| Pause    | Esc / P (online: nur Verlassen-Fenster) | Pause-Knopf |
| Ton      | M                 | Lautsprecher-Knopf    |
| Musik    | N                 | Schalter „Polka-Musik“ im Menü |

## Code

| Datei                 | Inhalt |
|-----------------------|--------|
| `src/main.js`         | Spielablauf Einzelspieler, Kamera, Hauptschleife (ruft online `multiplayer.js`) |
| `src/multiplayer.js`  | Online-Modus: Lobby, Host-Simulation, Vorhersage/Interpolation beim Mitspieler, Ereignisse, Rangliste |
| `src/mpUi.js`         | Online-Bildschirme (Name, Beitreten, Lobby, Rundenende, Esc-Fenster, Spielerliste im HUD) |
| `src/labels.js`       | Namensschilder über den Dackeln |
| `src/net/config.js`   | STUN/TURN, Präfix, Protokoll-Version, Sende-Raten, Rundenlänge |
| `src/net/codes.js`    | Raumcodes (`WURST-42`) und deren Abbildung auf PeerJS-IDs |
| `src/net/room.js`     | PeerJS-Hülle: Host-Raum und Mitspieler-Verbindung, Fehlermeldungen |
| `src/dog.js`          | Dackel: Snake-Körper (InstancedMesh), Beine, Ohr-Federphysik, Sprung, Fellfarben, `remoteUpdate` für Netz-Dackel |
| `src/world.js`        | Garten, Teich, Rampen, Hundehütte, Zaun, Pflanzen, Kollision, Bodenhöhe |
| `src/sausages.js`     | Würste (normal / gold / Kette), Spawnen, Fressen, IDs für den Netz-Abgleich |
| `src/controls.js`     | Tastatur + Touch-Joystick |
| `src/ui.js`           | HUD, Menüs, Highscore (localStorage) |
| `src/audio.js`        | Soundeffekte + Polka-Musik mit WebAudio |
| `src/effects.js`      | Partikel |
| `src/menuDog.js`      | großer Dackel im Start-/Game-Over-Bildschirm |


---

<sub>Entwickelt mit Unterstützung von Claude (KI von Anthropic).</sub>
