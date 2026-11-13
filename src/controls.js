// Eingabe: Tastatur (WASD/Pfeile, Leertaste, Shift) und Touch (Joystick + Knöpfe).
export class Controls {
  constructor() {
    this.keys = new Set();
    this.jumpQueued = false;
    this.sprintTouch = false;
    this.joy = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.onPause = null;
    this.onMute = null;
    this.state = { turn: 0, forward: false, brake: false, sprint: false, jump: false, dirX: 0, dirZ: 0, dirMag: 0 };

    const block = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
    addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (block.has(e.code)) e.preventDefault();
      if (e.code === 'Escape' || e.code === 'KeyP') { if (!e.repeat) this.onPause?.(); return; }
      if (e.code === 'KeyM' && !e.repeat) this.onMute?.();
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this._joyEnd(); this.sprintTouch = false; });
    this._setupTouch();
  }

  _setupTouch() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const knob = document.getElementById('joyKnob');
    const jump = document.getElementById('btnJump');
    const sprint = document.getElementById('btnSprint');
    this._base = base; this._knob = knob;
    const RAD = 55;

    const markTouch = (e) => { if (e.pointerType === 'touch') document.body.classList.add('touch'); };
    addEventListener('pointerdown', markTouch, { passive: true });
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

    zone.addEventListener('pointerdown', (e) => {
      if (this.joy.active) return;
      e.preventDefault();
      const j = this.joy;
      j.active = true; j.id = e.pointerId; j.ox = e.clientX; j.oy = e.clientY; j.x = j.y = 0;
      base.style.left = e.clientX + 'px';
      base.style.top = e.clientY + 'px';
      base.classList.add('on');
      knob.style.transform = 'translate(-50%,-50%)';
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      const j = this.joy;
      if (!j.active || e.pointerId !== j.id) return;
      let dx = e.clientX - j.ox, dy = e.clientY - j.oy;
      const l = Math.hypot(dx, dy);
      if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
      j.x = dx / RAD; j.y = -dy / RAD;
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e) => { if (e.pointerId === this.joy.id) this._joyEnd(); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    jump.addEventListener('pointerdown', (e) => { e.preventDefault(); this.jumpQueued = true; jump.classList.add('down'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jump.addEventListener(ev, () => jump.classList.remove('down'));
    sprint.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sprintTouch = true; sprint.classList.add('down'); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) sprint.addEventListener(ev, () => { this.sprintTouch = false; sprint.classList.remove('down'); });
  }

  _joyEnd() {
    const j = this.joy;
    j.active = false; j.id = null; j.x = j.y = 0;
    this._base?.classList.remove('on');
  }

  // camYaw: Blickrichtung der Kamera -> Joystick wirkt relativ zur Kamera
  read(camYaw) {
    const k = this.keys, s = this.state;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    s.turn = (left ? 1 : 0) - (right ? 1 : 0);
    s.forward = up;
    s.brake = down;
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this.sprintTouch;
    s.jump = this.jumpQueued;
    this.jumpQueued = false;
    const j = this.joy;
    const m = Math.hypot(j.x, j.y);
    if (j.active && m > 0.15) {
      const fx = Math.cos(camYaw), fz = -Math.sin(camYaw);
      const rx = Math.sin(camYaw), rz = Math.cos(camYaw);
      let x = fx * j.y + rx * j.x, z = fz * j.y + rz * j.x;
      const l = Math.hypot(x, z) || 1;
      s.dirX = x / l; s.dirZ = z / l;
      s.dirMag = Math.min(1, m);
    } else s.dirMag = 0;
    return s;
  }

  clearJump() {
    this.jumpQueued = false;
  }
}
