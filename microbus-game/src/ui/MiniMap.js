import { LOOP } from '../traffic/TrafficSystem.js';
import { ROADS } from '../world/RoadNetwork.js';
import { ROAD, CROSSINGS } from '../world/layout.js';
import { TERMINAL } from '../world/Shibin.js';

// خريطة الطرق: صغيرة في الركن (بتلف مع اتجاهك)، ولما تدوس عليها بتكبر لخريطة كاملة (الشمال لفوق).
// الطرق بتترسم مرة واحدة في canvas جاهز، وكل فريم بنرسم فوقها: إنت، اللاعبين التانيين، المواقف، ووجهة الركاب.

const PX = 0.5; // بكسل لكل متر في الطبقة الجاهزة

export class MiniMap {
  constructor(game) {
    this.game = game;
    this.big = false;
    const el = (this.el = document.createElement('div'));
    el.id = 'minimap';
    el.className = 'hidden';
    el.innerHTML = '<canvas></canvas><div class="mm-hint">الخريطة</div>';
    document.body.appendChild(el);
    this.cv = el.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.toggle(); });
    this._bake();
    this._t = 0;
  }

  show() { this.el.classList.remove('hidden'); }
  toggle() { this.big = !this.big; this.el.classList.toggle('big', this.big); this._t = 0; }

  // ===== الطبقة الثابتة: كل الطرق =====
  _bake() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const p of LOOP.samples) grow(p.x, p.z);
    for (const r of ROADS) for (const p of r.samples) grow(p.x, p.z);
    x0 -= 60; x1 += 60; z0 -= 60; z1 += 60;
    this.b = { x0, z0, w: x1 - x0, h: z1 - z0 };
    const c = (this.base = document.createElement('canvas'));
    c.width = Math.ceil(this.b.w * PX); c.height = Math.ceil(this.b.h * PX);
    const x = c.getContext('2d');
    x.fillStyle = '#1e2420'; x.fillRect(0, 0, c.width, c.height);
    const P = (wx, wz) => [(wx - x0) * PX, (wz - z0) * PX];
    const line = (pts, w, col) => {
      x.strokeStyle = col; x.lineWidth = w * PX; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.stroke();
    };
    // بحر شبين/النيل تقريبًا: ألوان خفيفة للأرض
    // الطريق الرئيسي (حواف ثم أسفلت)
    line(LOOP.samples, 24, '#3a3f3c');
    line(LOOP.samples, 19, '#8b8f93');
    // شوارع وسط البلد العرضية
    for (const cr of CROSSINGS) line([{ x: cr.xMin, z: cr.z }, { x: cr.xMax, z: cr.z }], cr.half * 2, '#8b8f93');
    // الطرق الفرعية وشبين الكوم
    for (const r of ROADS) {
      const urban = r.style === 'urban';
      line(r.samples, r.half * 2 + (urban ? 6 : 2), urban ? '#4a4540' : '#3a3f3c');
      line(r.samples, r.half * 2, r.surface === 'dirt' ? '#a08a62' : '#9a9da1');
    }
    // الموقف
    x.fillStyle = '#c8a020';
    const [ta, tb] = P(TERMINAL.x0, TERMINAL.z0); x.fillRect(ta, tb, (TERMINAL.x1 - TERMINAL.x0) * PX, (TERMINAL.z1 - TERMINAL.z0) * PX);
    // أسامي الطرق
    x.fillStyle = '#e8e4d8'; x.font = 'bold 13px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl';
    for (const r of ROADS) { const m = r.samples[r.samples.length >> 1]; const [a, b] = P(m.x, m.z); x.fillText(r.name, a, b - 8); }
    const lbl = (t, wx, wz) => { const [a, b] = P(wx, wz); x.fillText(t, a, b); };
    lbl('وسط البلد', 0, ROAD.zMax - 60);
    lbl('شبين الكوم', 220, 380);
    lbl('موقف الميكروباص', (TERMINAL.x0 + TERMINAL.x1) / 2, TERMINAL.z1 + 14);
  }

  update(dt) {
    if (this.el.classList.contains('hidden')) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 1 / 12;
    const big = this.big;
    const cv = this.cv, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.el.clientWidth * dpr), H = Math.round(this.el.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const x = this.ctx, ph = this.game.player.physics;
    const scale = (big ? Math.min(W / (this.b.w * PX), H / (this.b.h * PX)) : 1.6 * dpr / (PX * 2)) ;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#1e2420'; x.fillRect(0, 0, W, H);
    // التحويل: العالم → الشاشة
    const toBase = (wx, wz) => [(wx - this.b.x0) * PX, (wz - this.b.z0) * PX];
    x.save();
    if (big) {
      x.translate(W / 2, H / 2); x.scale(scale, scale);
      x.translate(-this.base.width / 2, -this.base.height / 2);
    } else {
      // بتلف مع العربية: قدامك لفوق
      const [px, pz] = toBase(ph.x, ph.z);
      x.translate(W / 2, H * 0.62); x.rotate(ph.yaw); x.scale(scale, scale); x.translate(-px, -pz);
    }
    x.drawImage(this.base, 0, 0);
    const k = 1 / scale; // حجم ثابت على الشاشة
    const dot = (wx, wz, r, col, stroke) => { const [a, b] = toBase(wx, wz); x.beginPath(); x.arc(a, b, r * k * dpr, 0, Math.PI * 2); x.fillStyle = col; x.fill(); if (stroke) { x.lineWidth = 2 * k * dpr; x.strokeStyle = stroke; x.stroke(); } };
    const text = (t, wx, wz, col = '#fff') => { const [a, b] = toBase(wx, wz); x.save(); x.translate(a, b); if (!big) x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr); x.font = 'bold 12px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl'; x.lineWidth = 3; x.strokeStyle = '#000'; x.strokeText(t, 0, -9); x.fillStyle = col; x.fillText(t, 0, -9); x.restore(); };
    // المواقف: أصفر = فيه ناس مستنية، أخضر = موقف نازل فيه حد معاك
    const P = this.game.passengers;
    if (P) {
      const dests = new Set(P.onboard.map((o) => o.dest?.name));
      for (const st of P.stops) {
        const has = st.waiting.some((w) => w.state === 'wait');
        const dest = dests.has(st.name);
        if (!has && !dest) continue;
        dot(st.x, st.z, dest ? 6 : 4.5, dest ? '#3ee07a' : '#f2c230', '#000');
        if (dest && st.side === 1) text(st.name, st.x, st.z, '#7dffab');
      }
    }
    // اللاعبين التانيين
    for (const o of this.game.mp?.positions() || []) { dot(o.x, o.z, 6, '#4aa8ff', '#fff'); text(`${o.seat} ${o.name || ''}`, o.x, o.z, '#bfe0ff'); }
    // إنت: سهم
    {
      const [a, b] = toBase(ph.x, ph.z);
      x.save(); x.translate(a, b); x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr);
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath();
      x.fillStyle = '#f2b330'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#000'; x.stroke();
      x.restore();
    }
    x.restore();
    if (big) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, H - 26 * dpr, W, 26 * dpr); x.fillStyle = '#fff'; x.font = `${12 * dpr}px Cairo, sans-serif`; x.textAlign = 'center'; x.direction = 'rtl'; x.fillText('🟡 ناس مستنية · 🟢 موقف نازل فيه راكب معاك · 🔵 لاعبين — دوس على الخريطة عشان تقفلها', W / 2, H - 9 * dpr); }
  }
}
