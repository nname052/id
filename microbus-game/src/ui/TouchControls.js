// تحكم الموبايل الاحترافي:
//  - دركسيون دائري حقيقي: بتمسكه وتلفه بحركة دائرية (زاوية الصباع حوالين المركز)
//    مع angle unwrapping (مفيش قفزة عند ±180°)، ±540° (لفة ونص لكل ناحية)،
//    وإعادة إمساك من أي مكان من غير ما الدركسيون يقفز (grab offset).
//  - دواسة بنزين وفرامل بضغط تدريجي (كل ما تطلع بصباعك لفوق الضغط بيزيد)
//  - Multi-touch كامل بالـ Pointer Events + pointer capture

export const isTouchDevice = () =>
  typeof window !== 'undefined' && (('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches);

const TAU = Math.PI * 2;
const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

const WHEEL_SVG = `
<svg viewBox="-100 -100 200 200" aria-hidden="true">
  <defs>
    <radialGradient id="tw-hub" cx="0" cy="-10" r="45" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4a4a4e"/><stop offset="1" stop-color="#1c1c1f"/></radialGradient>
    <linearGradient id="tw-rim" x1="0" y1="-95" x2="0" y2="95" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3b3b40"/><stop offset="0.5" stop-color="#1d1d21"/><stop offset="1" stop-color="#2c2c31"/></linearGradient>
  </defs>
  <circle r="86" fill="none" stroke="url(#tw-rim)" stroke-width="20"/>
  <circle r="86" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="20" stroke-dasharray="2 7"/>
  <path d="M-80 8 L-30 14 L-26 30 L26 30 L30 14 L80 8 L80 -6 L30 -6 L-30 -6 L-80 -6 Z" fill="#26262a"/>
  <path d="M-22 26 L-16 80 L16 80 L22 26 Z" fill="#26262a"/>
  <circle r="34" fill="url(#tw-hub)" stroke="#111" stroke-width="2"/>
  <ellipse rx="15" ry="9" fill="none" stroke="#9a9a9f" stroke-width="3"/>
  <rect x="-6" y="-97" width="12" height="20" rx="4" fill="#f2b330"/>
</svg>`;

export class TouchControls {
  constructor() {
    this.state = { wheelHeld: false, wheelAngle: 0, throttle: 0, brake: 0, handbrake: 0, horn: false };
    this.actions = new Set();
    this.active = false;
    this.maxWheel = 3 * Math.PI; // 540°
    this.physAngle = 0;          // آخر زاوية دركسيون من الفيزياء (موجب = شمال)
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="t-wheel-zone" id="t-wheel-zone">
        <div class="t-wheel" id="t-wheel">${WHEEL_SVG}</div>
        <div class="t-angle" id="t-angle">0°</div>
      </div>
      <div class="t-top">
        <button data-act="zoomOut" class="t-zoom" aria-label="بعّد الكاميرا"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 10h6M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button data-act="zoomIn" class="t-zoom" aria-label="قرّب الكاميرا"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 10h6M10 7v6M15 15l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button data-act="camera" aria-label="الكاميرا"><svg viewBox="0 0 24 24"><path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>
        <button data-act="lights" id="t-lights" aria-label="الكشافات"><svg viewBox="0 0 24 24"><path d="M10 6c-4 0-6 3-6 6s2 6 6 6h2V6zM15 8l6-1M15 12h6M15 16l6 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button data-act="time" aria-label="الوقت"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button data-act="siren" class="t-siren" aria-label="السارينة"><svg viewBox="0 0 24 24"><path d="M7 18v-6a5 5 0 0 1 10 0v6M5 18h14v3H5zM12 3v2M4.5 6l1.4 1.4M19.5 6l-1.4 1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
        <button data-act="reset" aria-label="رجوع للطريق"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <button class="t-horn" data-hold="horn" aria-label="كلاكس"><svg viewBox="0 0 24 24"><path d="M3 10v4h3l6 4V6L6 10zM16 8c1.5 1 1.5 7 0 8M19 6c3 2.5 3 9.5 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="t-pedals">
        <button class="t-hb" data-hold="handbrake" aria-label="فرامل يد"><b>P</b><small>يد</small></button>
        <div class="t-pedal t-brake" data-pedal="brake"><i></i><span>فرامل</span><small>ريوس</small></div>
        <div class="t-pedal t-gas" data-pedal="throttle"><i></i><span>بنزين</span></div>
      </div>`;
    document.body.appendChild(this.root);
    this.wheelEl = this.root.querySelector('#t-wheel');
    this.angleEl = this.root.querySelector('#t-angle');
    this._bindWheel(this.root.querySelector('#t-wheel-zone'));
    for (const p of this.root.querySelectorAll('[data-pedal]')) this._bindPedal(p, p.dataset.pedal);
    for (const b of this.root.querySelectorAll('[data-hold]')) this._bindHold(b, b.dataset.hold);
    for (const b of this.root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions.add(b.dataset.act); b.classList.add('on'); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => b.classList.remove('on'));
    }
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show() { this.root.classList.remove('hidden'); this.active = true; }
  setLights(on) { this.root.querySelector('#t-lights').classList.toggle('lit', on); }

  _capture(el, e) { try { el.setPointerCapture(e.pointerId); } catch { /* حدث صناعي */ } }

  // ===================== الدركسيون الدائري =====================
  _bindWheel(zone) {
    let id = null;        // الصباع الماسك الدركسيون (واحد بس)
    let lastRaw = 0;      // آخر زاوية خام للصباع (-π..π)
    let unwrapped = 0;    // زاوية الصباع المتراكمة (من غير قفزات)
    let offset = 0;       // الفرق بين الصباع والدركسيون لحظة المسكة
    let cx = 0, cy = 0, R = 1;
    const screenAngle = () => -this.physAngle; // الشاشة: مع عقارب الساعة موجب = يمين
    const fingerAngle = (e) => Math.atan2(e.clientY - cy, e.clientX - cx);

    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      const r = this.wheelEl.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = this.wheelEl.offsetWidth / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (dist > R * 1.35) return;
      e.preventDefault();
      id = e.pointerId;
      this._capture(zone, e);
      lastRaw = fingerAngle(e);
      unwrapped = lastRaw;
      // المسكة: نكمل من مكان الدركسيون الحالي من غير قفزة
      offset = screenAngle() - unwrapped;
      this.state.wheelHeld = true;
      this.state.wheelAngle = this.physAngle;
      this.wheelEl.classList.add('held');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      // لو الصباع قريب جدًا من المركز، الزاوية بتبقى عشوائية → نتجاهل
      if (Math.hypot(e.clientX - cx, e.clientY - cy) < R * 0.18) return;
      const raw = fingerAngle(e);
      unwrapped += wrapPi(raw - lastRaw); // angle unwrapping
      lastRaw = raw;
      let target = unwrapped + offset;    // زاوية الشاشة المطلوبة
      if (target > this.maxWheel) { target = this.maxWheel; unwrapped = target - offset; }
      if (target < -this.maxWheel) { target = -this.maxWheel; unwrapped = target - offset; }
      this.state.wheelAngle = -target;
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.state.wheelHeld = false; // من هنا الفيزياء بترجّعه تدريجيًا
      this.wheelEl.classList.remove('held');
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, end);
  }

  // ===================== الدواسات =====================
  _bindPedal(el, key) {
    let id = null;
    const press = (e) => {
      const r = el.getBoundingClientRect();
      const rel = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)); // 0 تحت → 1 فوق
      this.state[key] = Math.min(1, 0.45 + rel * 0.75);
      el.style.setProperty('--p', this.state[key].toFixed(2));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (id !== null) return;
      id = e.pointerId;
      this._capture(el, e);
      el.classList.add('on');
      press(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); press(e); } });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.state[key] = 0; el.classList.remove('on'); el.style.setProperty('--p', '0');
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, end);
  }

  _bindHold(el, key) {
    const set = (v) => {
      if (key === 'horn') this.state.horn = v; else this.state[key] = v ? 1 : 0;
      el.classList.toggle('on', v);
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._capture(el, e); set(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
  }

  /** كل فريم: زاوية الدركسيون الحقيقية من الفيزياء (عشان الرجوع الذاتي يبان على الشاشة) */
  update(physWheelAngle) {
    this.physAngle = physWheelAngle;
    const shown = this.state.wheelHeld ? this.state.wheelAngle : physWheelAngle;
    this.wheelEl.style.transform = `rotate(${(-shown * 180) / Math.PI}deg)`;
    const deg = Math.round((-shown * 180) / Math.PI);
    if (deg !== this._lastDeg) { this._lastDeg = deg; this.angleEl.textContent = `${deg > 0 ? '↻' : deg < 0 ? '↺' : ''} ${Math.abs(deg)}°`; }
  }

  takeActions() { const a = new Set(this.actions); this.actions.clear(); return a; }
}
