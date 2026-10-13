// تحكم باللمس للموبايل: دركسيون (اسحب يمين/شمال)، دواسة بنزين وفرامل، وزراير.
// بيدعم أكتر من صباع في نفس الوقت (Pointer Events).

export const isTouchDevice = () =>
  (typeof window !== 'undefined') && (('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches);

export class TouchControls {
  constructor() {
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: 0, horn: false };
    this.actions = new Set();
    this.active = false;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="t-steer" id="t-steer">
        <svg viewBox="0 0 100 100" id="t-wheel"><circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="50" cy="50" r="11" fill="currentColor"/><path d="M50 6v33M8 60l31-8M92 60l-31-8" stroke="currentColor" stroke-width="9"/><rect x="45" y="2" width="10" height="12" rx="3" fill="#f2b330"/></svg>
        <span>اسحب يمين وشمال</span>
      </div>
      <div class="t-btns">
        <button data-act="camera">🎥</button>
        <button data-hold="horn">📯</button>
        <button data-act="reset">↺</button>
        <button data-act="time">☀</button>
      </div>
      <div class="t-pedals">
        <button class="t-hb" data-hold="handbrake">فرامل<br>يد</button>
        <button class="t-brake" data-hold="brake">فرامل<br><small>ريوس</small></button>
        <button class="t-gas" data-hold="throttle">بنزين</button>
      </div>`;
    document.body.appendChild(this.root);
    this.wheel = this.root.querySelector('#t-wheel');
    this._bindSteer(this.root.querySelector('#t-steer'));
    for (const b of this.root.querySelectorAll('[data-hold]')) this._bindHold(b, b.dataset.hold);
    for (const b of this.root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions.add(b.dataset.act); b.classList.add('on'); });
      b.addEventListener('pointerup', () => b.classList.remove('on'));
      b.addEventListener('pointercancel', () => b.classList.remove('on'));
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show() { this.root.classList.remove('hidden'); this.active = true; }

  _bindHold(el, key) {
    const set = (v) => {
      if (key === 'horn') this.state.horn = v; else this.state[key] = v ? 1 : 0;
      el.classList.toggle('on', v);
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* مش مهم */ } set(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
  }

  _bindSteer(el) {
    let id = null, startX = 0, base = 0;
    const width = () => Math.max(120, el.getBoundingClientRect().width * 0.42);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; startX = e.clientX; base = this.state.steer;
      try { el.setPointerCapture(e.pointerId); } catch { /* مش مهم */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      // سحب يمين = لف يمين (steer سالب)
      const v = base - (e.clientX - startX) / width();
      this.state.steer = Math.max(-1, Math.min(1, v));
    });
    const end = (e) => { if (e.pointerId === id) { id = null; this.state.steer = 0; } };
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, end);
  }

  /** دوران أيقونة الدركسيون حسب زاوية الدركسيون الحقيقية */
  setWheelAngle(rad) { this.wheel.style.transform = `rotate(${(-rad * 180) / Math.PI}deg)`; }

  takeActions() { const a = new Set(this.actions); this.actions.clear(); return a; }
}
