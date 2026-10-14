// الإعدادات: بتتحفظ على الجهاز (localStorage) وبترجع تاني لما تفتح اللعبة.
// لو التخزين مقفول (Private mode) اللعبة بتشتغل عادي بالقيم الافتراضية.

const KEY = 'egy-microbus-settings-v1';

// كل إعداد: نوعه (range/seg) وقيمه وقيمته الافتراضية. المجموعات للعرض بس.
export const SCHEMA = [
  { group: 'الكاميرا' },
  { key: 'fov', type: 'range', label: 'زاوية الرؤية من كرسي السواق', min: 55, max: 90, step: 1, fmt: (v) => `${v}°`, def: 62 },
  { key: 'seat', type: 'seg', label: 'مكان الكرسي (كاميرا السواق)', options: [['near', 'قريب'], ['normal', 'عادي'], ['back', 'لورا']], def: 'normal' },
  { key: 'lookSens', type: 'range', label: 'حساسية لف الكاميرا', min: 0.4, max: 2, step: 0.1, fmt: (v) => `${(+v).toFixed(1)}×`, def: 1 },
  { key: 'mirrorInsets', type: 'seg', label: 'المرايات الجانبية على حرف الشاشة', options: [['auto', 'تلقائي'], ['on', 'دايمًا'], ['off', 'مقفولة']], def: 'auto' },
  { group: 'الجرافيكس' },
  { key: 'graphics', type: 'seg', label: 'الجودة', options: [['auto', 'تلقائي'], ['low', 'واطية'], ['med', 'متوسطة'], ['high', 'عالية']], def: 'auto' },
  { key: 'shadows', type: 'seg', label: 'الضل', options: [['on', 'شغال'], ['off', 'مقفول']], def: 'on' },
  { key: 'mirrorQuality', type: 'seg', label: 'جودة المرايات', options: [['low', 'واطية'], ['med', 'متوسطة'], ['high', 'عالية']], def: 'auto-device' },
  { group: 'الوقت والإضاءة' },
  { key: 'timeOfDay', type: 'seg', label: 'الوقت', options: [['day', 'نهار'], ['sunset', 'مغرب'], ['night', 'ليل']], def: 'day' },
  { key: 'headlights', type: 'seg', label: 'الكشافات', options: [['auto', 'تلقائي'], ['on', 'شغالة'], ['off', 'مطفية']], def: 'auto' },
  { group: 'الصوت' },
  { key: 'masterVol', type: 'range', label: 'الصوت العام', min: 0, max: 100, step: 5, fmt: (v) => `${v}%`, def: 80 },
  { key: 'engineVol', type: 'range', label: 'صوت الموتور', min: 0, max: 100, step: 5, fmt: (v) => `${v}%`, def: 80 },
  { group: 'المرور والركاب' },
  { key: 'traffic', type: 'seg', label: 'زحمة المرور', options: [['off', 'فاضي'], ['low', 'خفيفة'], ['normal', 'عادية'], ['high', 'زحمة']], def: 'normal' },
  { key: 'paxDensity', type: 'seg', label: 'الركاب المستنيين', options: [['0.4', 'قليل'], ['1', 'عادي'], ['1.6', 'كتير']], def: '1' },
];

export const DEFAULTS = Object.fromEntries(SCHEMA.filter((s) => s.key).map((s) => [s.key, s.def]));

const GEAR_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';

export class Settings {
  constructor({ mobile = false } = {}) {
    // زاوية رؤية أضيق شوية على الموبايل (الشاشة عريضة جدًا → الأطراف بتتمط)
    this.values = { ...DEFAULTS, mirrorQuality: mobile ? 'med' : 'high', fov: mobile ? 52 : 58 };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (saved.fovV !== 2) delete saved.fov; // الافتراضي اتغير في التحديث ده
      for (const s of SCHEMA) {
        if (!s.key || saved[s.key] === undefined) continue;
        const v = saved[s.key];
        if (s.type === 'range' && typeof v === 'number') this.values[s.key] = Math.min(s.max, Math.max(s.min, v));
        if (s.type === 'seg' && s.options.some((o) => o[0] === v)) this.values[s.key] = v;
      }
    } catch { /* مفيش تخزين */ }
    this.listeners = [];
    this.open = false;
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    if (this.values[k] === v) return;
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify({ ...this.values, fovV: 2 })); } catch { /* مفيش تخزين */ }
    for (const fn of this.listeners) fn(k, v);
    this._sync?.();
  }

  onChange(fn) { this.listeners.push(fn); }

  /** زرار الترس + اللوحة */
  mount(touchTop) {
    const btn = document.createElement('button');
    btn.className = 'set-btn';
    btn.setAttribute('aria-label', 'الإعدادات');
    btn.innerHTML = GEAR_SVG;
    if (touchTop) touchTop.prepend(btn);
    else { btn.classList.add('set-btn-fixed'); document.body.appendChild(btn); }

    const p = (this.panel = document.createElement('div'));
    p.id = 'settings';
    p.className = 'hidden';
    const rows = SCHEMA.map((s) => {
      if (s.group) return `<h3 class="set-group">${s.group}</h3>`;
      if (s.type === 'range') {
        return `<label class="set-row" for="set-${s.key}"><span>${s.label}</span><output id="set-${s.key}-val"></output></label>
          <input id="set-${s.key}" data-key="${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" />`;
      }
      return `<div class="set-row"><span>${s.label}</span></div>
        <div class="set-seg" data-key="${s.key}" style="grid-template-columns: repeat(${s.options.length}, 1fr)">${s.options.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
    }).join('');
    p.innerHTML = `<div class="set-card">
        <div class="set-head"><b>الإعدادات</b><button class="set-close" aria-label="قفل">✕</button></div>
        ${rows}
        <p class="set-note">بتتحفظ على الجهاز ده.</p>
      </div>`;
    document.body.appendChild(p);
    const sync = (this._sync = () => {
      for (const s of SCHEMA) {
        if (!s.key) continue;
        if (s.type === 'range') {
          const el = p.querySelector(`#set-${s.key}`);
          if (+el.value !== this.values[s.key]) el.value = this.values[s.key];
          p.querySelector(`#set-${s.key}-val`).textContent = s.fmt(this.values[s.key]);
        } else {
          for (const b of p.querySelector(`.set-seg[data-key="${s.key}"]`).children) b.classList.toggle('on', b.dataset.v === this.values[s.key]);
        }
      }
    });
    sync();
    p.addEventListener('input', (e) => { const k = e.target.dataset?.key; if (k) this.set(k, +e.target.value); });
    p.addEventListener('click', (e) => {
      const b = e.target.closest('.set-seg button');
      if (b) this.set(b.parentElement.dataset.key, b.dataset.v);
    });
    const toggle = (show) => { this.open = show; p.classList.toggle('hidden', !show); };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggle(!this.open); });
    p.querySelector('.set-close').addEventListener('click', () => toggle(false));
    p.addEventListener('pointerdown', (e) => { if (e.target === p) toggle(false); e.stopPropagation(); });
    this.toggle = toggle;
  }
}
