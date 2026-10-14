// واجهة بسيطة: السرعة، الفتيس، عداد اللفات، اسم الكاميرا، رسائل، مساعدة

export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.speed = document.getElementById('hud-speed');
    this.gear = document.getElementById('hud-gear');
    this.gearNum = document.getElementById('hud-gear-n');
    this.rpm = document.getElementById('hud-rpm');
    this.steer = document.getElementById('hud-steer');
    this.toastEl = document.getElementById('toast');
    this.help = document.getElementById('help');
    this.fpsEl = document.getElementById('fps');
    this.signal = document.getElementById('hud-signal');
    this.toastTimer = 0;
    this.fpsOn = false;
    this.frames = 0; this.fpsTime = 0;
    this.helpTimer = 14;
  }

  setPassengers(n, cap) {
    const el = (this.paxEl ||= document.getElementById('hud-pax'));
    if (el) el.textContent = `${n}/${cap}`;
  }

  show() { this.el.classList.remove('hidden'); this.help.classList.remove('hidden'); }

  toast(text, sec = 2) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = sec;
  }

  toggleHelp() { this.help.classList.toggle('hidden'); this.helpTimer = 0; }
  toggleFps() { this.fpsOn = !this.fpsOn; this.fpsEl.classList.toggle('hidden', !this.fpsOn); }

  update(dt, ph, lights) {
    const kmh = Math.round(ph.speed * 3.6);
    this.speed.textContent = kmh;
    const gm = ph.gearMode;
    const gtxt = gm === 'D' ? `D${ph.gear}` : gm;
    if (gtxt !== this._g) { this._g = gtxt; this.gear.textContent = gm === 'D' ? 'D' : gm; this.gear.className = gm; this.gearNum.textContent = gm === 'D' ? `سرعة ${ph.gear}` : gm === 'R' ? 'ريوس' : 'محايد'; }
    this.rpm.style.width = `${Math.min(100, (ph.rpm / 4500) * 100)}%`;
    this.rpm.classList.toggle('red', ph.rpm > 3800);
    const deg = Math.round((ph.steeringWheelAngle * 180) / Math.PI);
    this.steer.style.transform = `rotate(${-deg}deg)`;
    if (lights && this.signal) {
      const s = lights.state('main');
      this.signal.className = `sig ${s}`;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.helpTimer > 0) {
      this.helpTimer -= dt;
      if (this.helpTimer <= 0) this.help.classList.add('hidden');
    }
    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      if (this.fpsOn) this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTime)} FPS`;
      this.frames = 0; this.fpsTime = 0;
    }
  }
}
