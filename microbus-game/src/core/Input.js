// التحكم: كيبورد + Gamepad. بنستخدم e.code عشان يشتغل حتى لو الكيبورد عربي.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // ضغطات لمرة واحدة (C, R, ...)
    this.gamepadIndex = null;
    this.prevButtons = [];
    this.usingGamepad = false;
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  consume(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  /** يرجع حالة التحكم الحالية */
  read() {
    const k = this.keys;
    const st = {
      throttle: k.has('KeyW') || k.has('ArrowUp') ? 1 : 0,
      brake: k.has('KeyS') || k.has('ArrowDown') ? 1 : 0,
      steer: (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0),
      handbrake: k.has('Space') ? 1 : 0,
      horn: k.has('KeyH'),
      lookBack: k.has('KeyB'),
      lookX: (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0),
      lookY: 0,
      analog: false,
      actions: { camera: this.consume('KeyC'), reset: this.consume('KeyR'), time: this.consume('KeyT'), help: this.consume('KeyI') || this.consume('F1'), mute: this.consume('KeyM'), fps: this.consume('KeyF') },
    };
    this.pressed.clear();
    // تحكم اللمس (موبايل)
    const t = this.touch;
    if (t && t.active) {
      const ts = t.state;
      if (Math.abs(ts.steer) > 0.02) { st.steer = ts.steer; st.analog = true; }
      st.throttle = Math.max(st.throttle, ts.throttle);
      st.brake = Math.max(st.brake, ts.brake);
      st.handbrake = Math.max(st.handbrake, ts.handbrake);
      st.horn = st.horn || ts.horn;
      for (const a of t.takeActions()) st.actions[a] = true;
    }
    // Gamepad (Xbox / PlayStation بالـ standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = (this.gamepadIndex != null && pads[this.gamepadIndex]) || [...pads].find((p) => p);
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const edge = (i) => { const now = b(i) > 0.5; const was = this.prevButtons[i]; this.prevButtons[i] = now; return now && !was; };
      const sx = dz(gp.axes[0] || 0);
      const rt = b(7), lt = b(6);
      if (Math.abs(sx) > 0 || rt > 0.05 || lt > 0.05) this.usingGamepad = true;
      if (this.usingGamepad) {
        st.steer = -Math.sign(sx) * Math.pow(Math.abs(sx), 1.4);
        st.throttle = Math.max(st.throttle, rt);
        st.brake = Math.max(st.brake, lt);
        st.analog = true;
      }
      st.handbrake = Math.max(st.handbrake, b(0));         // A / X
      st.horn = st.horn || b(1) > 0.5 || b(10) > 0.5;      // B / O أو ضغط العصاية الشمال
      st.lookX = dz(gp.axes[2] || 0) || st.lookX;
      st.lookY = dz(gp.axes[3] || 0);
      if (edge(3)) st.actions.camera = true;               // Y / △
      if (edge(8)) st.actions.reset = true;                // Back / Share
      if (edge(9)) st.actions.help = true;                 // Start / Options
      if (edge(2)) st.actions.time = true;                 // X / □
    }
    return st;
  }
}
