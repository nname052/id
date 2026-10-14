// الإعدادات: بتتحفظ على الجهاز (localStorage) وبترجع تاني لما تفتح اللعبة.
// لو التخزين مقفول (Private mode) اللعبة بتشتغل عادي بالقيم الافتراضية.

const KEY = 'egy-microbus-settings-v1';

export const DEFAULTS = {
  fov: 62,            // زاوية رؤية كرسي السواق (رأسية، بالدرجات) 55–90
  mirrorInsets: 'auto', // auto | on | off
};

const GEAR_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>';

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      for (const k of Object.keys(DEFAULTS)) if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) this.values[k] = saved[k];
    } catch { /* مفيش تخزين */ }
    this.values.fov = Math.min(90, Math.max(55, this.values.fov));
    this.listeners = [];
    this.open = false;
  }

  get(k) { return this.values[k]; }

  set(k, v) {
    this.values[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* مفيش تخزين */ }
    for (const fn of this.listeners) fn(k, v);
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
    p.innerHTML = `
      <div class="set-card">
        <div class="set-head"><b>الإعدادات</b><button class="set-close" aria-label="قفل">✕</button></div>
        <label class="set-row" for="set-fov">
          <span>زاوية الرؤية من كرسي السواق</span>
          <output id="set-fov-val"></output>
        </label>
        <input id="set-fov" type="range" min="55" max="90" step="1" />
        <div class="set-row"><span>المرايات الجانبية على حرف الشاشة</span></div>
        <div class="set-seg" id="set-mirrors">
          <button data-v="auto">تلقائي</button><button data-v="on">دايمًا</button><button data-v="off">مقفولة</button>
        </div>
        <p class="set-note">بتتحفظ على الجهاز ده.</p>
      </div>`;
    document.body.appendChild(p);
    const fov = p.querySelector('#set-fov'), fovVal = p.querySelector('#set-fov-val');
    const seg = p.querySelector('#set-mirrors');
    const sync = () => {
      fov.value = this.values.fov; fovVal.textContent = `${this.values.fov}°`;
      for (const b of seg.children) b.classList.toggle('on', b.dataset.v === this.values.mirrorInsets);
    };
    sync();
    fov.addEventListener('input', () => { this.set('fov', +fov.value); sync(); });
    seg.addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.v; if (v) { this.set('mirrorInsets', v); sync(); } });
    const toggle = (show) => { this.open = show; p.classList.toggle('hidden', !show); };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggle(!this.open); });
    p.querySelector('.set-close').addEventListener('click', () => toggle(false));
    p.addEventListener('pointerdown', (e) => { if (e.target === p) toggle(false); e.stopPropagation(); });
    this.toggle = toggle;
  }
}
