// =====================================================================
//  الراديو (اختياري): إذاعة القرآن الكريم
//  - اللعبة مش بتحمّل ولا بتوزّع أي صوت/بث: مفيش ملفات صوت متضمنة، ومفيش رابط بث مكتوب في الكود
//    لأن مفيش رابط بث رسمي متأكدين منه. اللاعب يقدر يحط رابط البث الرسمي بنفسه (https) من الإعدادات،
//    وبيتحفظ على جهازه بس. لو مفيش رابط: الزرار بيقول كده بوضوح (مش بيعمل حاجة في الخلفية).
//  - نسخة واحدة بس من مشغل الصوت (حتى لو اتعمل Radio تاني)، تشغيل/إيقاف، صوت، وفشل الشبكة بيتعامل معاه بهدوء.
// =====================================================================
const URL_KEY = 'egy-radio-url-v1';
// مكان الرابط الرسمي لو اتأكد منه بعدين (مصدر رسمي + مسموح بالتشغيل في الويب): سيبه null لحد كده
export const RADIO_STATIONS = [
  { id: 'quran', name: 'إذاعة القرآن الكريم', url: null, verified: false },
];

let shared = null; // مشغل واحد للصفحة كلها

export class Radio {
  constructor({ hud, settings } = {}) {
    this.hud = hud; this.settings = settings;
    this.station = RADIO_STATIONS[0];
    this.state = 'off'; // off | loading | on | error | unset
    this.listeners = [];
    window.addEventListener('pagehide', () => this.stop());
  }

  get url() {
    try { const u = localStorage.getItem(URL_KEY); if (u && /^https:\/\//i.test(u)) return u; } catch { /* */ }
    return this.station.url;
  }

  setUrl(u) {
    u = (u || '').trim();
    if (u && !/^https:\/\/[^\s]+$/i.test(u)) { this.hud?.toast('الرابط لازم يبدأ بـ https://', 2.4); return false; }
    try { if (u) localStorage.setItem(URL_KEY, u); else localStorage.removeItem(URL_KEY); } catch { /* */ }
    this.stop();
    this._emit();
    return true;
  }

  get volume() { return (this.settings?.get('radioVol') ?? 60) / 100; }
  setVolume(v) { if (shared) shared.volume = Math.max(0, Math.min(1, v)); }

  _el() {
    if (!shared) {
      shared = new Audio();
      shared.preload = 'none';
      shared.crossOrigin = null;
    }
    if (!shared._bound) {
      shared._bound = true;
      shared.addEventListener('playing', () => this._set('on'));
      shared.addEventListener('waiting', () => this.state !== 'off' && this._set('loading'));
      shared.addEventListener('error', () => {
        if (this.state === 'off') return;
        this._set('error');
        this.hud?.toast('📻 البث مش متاح دلوقتي (النت أو الرابط) — جرّب بعدين', 3);
      });
    }
    return shared;
  }

  toggle() { if (this.state === 'on' || this.state === 'loading') this.stop(); else this.play(); }

  play() {
    const url = this.url;
    if (!url) {
      this._set('unset');
      this.hud?.toast('📻 مفيش رابط بث رسمي مضاف — حط رابط البث الرسمي من الإعدادات (الراديو)', 3.5);
      return;
    }
    const el = this._el();
    if (el.src !== url) el.src = url;
    el.volume = this.volume;
    this._set('loading');
    el.play().catch(() => {
      if (this.state === 'off') return;
      this._set('error');
      this.hud?.toast('📻 مش قادر يشغّل البث — اتأكد من النت والرابط', 3);
    });
  }

  stop() {
    if (shared) { try { shared.pause(); shared.removeAttribute('src'); shared.load(); } catch { /* */ } }
    if (this.state !== 'off') this._set('off');
  }

  _set(s) { this.state = s; this._emit(); }
  _emit() { for (const f of this.listeners) f(this.state); }
  onChange(f) { this.listeners.push(f); }

  /** قسم الراديو جوه لوحة الإعدادات */
  mountSettings(panel) {
    const card = panel?.querySelector('.set-card');
    if (!card) return;
    const box = document.createElement('div');
    box.className = 'radio-box';
    box.innerHTML = `<h3 class="set-group">الراديو</h3>
      <div class="radio-row"><button class="radio-play" type="button">▶</button><div><b>${this.station.name}</b><small class="radio-st"></small></div></div>
      <label class="set-row" for="radio-url"><span>رابط البث الرسمي (اختياري، https)</span></label>
      <div class="radio-url"><input id="radio-url" type="url" inputmode="url" placeholder="https://..." dir="ltr" /><button type="button" class="radio-save">حفظ</button></div>
      <p class="set-note">اللعبة مش بتوفّر ولا بتنقل أي بث. حط رابط البث الرسمي بنفسك لو عندك؛ بيتحفظ على جهازك بس.</p>`;
    card.insertBefore(box, card.querySelector('.set-note'));
    const btn = box.querySelector('.radio-play'), st = box.querySelector('.radio-st'), inp = box.querySelector('#radio-url');
    inp.value = (() => { try { return localStorage.getItem(URL_KEY) || ''; } catch { return ''; } })();
    const LABEL = { off: 'مقفول', loading: 'بيحمّل…', on: 'شغال', error: 'البث مش متاح', unset: 'مفيش رابط بث مضاف' };
    const sync = () => {
      btn.textContent = this.state === 'on' || this.state === 'loading' ? '⏸' : '▶';
      st.textContent = this.url ? LABEL[this.state] : LABEL.unset;
      btn.classList.toggle('dim', !this.url);
    };
    this.onChange(sync); sync();
    btn.addEventListener('click', () => this.toggle());
    box.querySelector('.radio-save').addEventListener('click', () => { if (this.setUrl(inp.value)) this.hud?.toast(inp.value.trim() ? '📻 اتحفظ الرابط' : '📻 اتشال الرابط', 2); });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    inp.addEventListener('keyup', (e) => e.stopPropagation());
  }
}
