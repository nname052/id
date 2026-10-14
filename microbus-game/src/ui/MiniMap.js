import { LOOP } from '../traffic/TrafficSystem.js';
import { ROADS } from '../world/RoadNetwork.js';
import { ROAD, CROSSINGS } from '../world/layout.js';
import { TERMINAL } from '../world/Shibin.js';
import { SHIBIN } from '../world/RoadNetwork.js';

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
    // ستايل كرتوني: أرض خضرا فاتحة، طرق بيضا بحواف غامقة، الترعة زرقا
    x.fillStyle = '#9fd67a'; x.fillRect(0, 0, c.width, c.height);
    const P = (wx, wz) => [(wx - x0) * PX, (wz - z0) * PX];
    // بقع خضرا أغمق شوية (غيطان) عشان الخلفية ماتبقاش مسطحة
    for (let i = 0; i < 260; i++) {
      const rx = (Math.sin(i * 12.9898) * 43758.5453) % 1, rz = (Math.sin(i * 78.233) * 12543.123) % 1;
      x.fillStyle = i % 3 ? 'rgba(110,180,80,0.35)' : 'rgba(190,230,140,0.4)';
      x.beginPath(); x.ellipse(Math.abs(rx) * c.width, Math.abs(rz) * c.height, 18 + (i % 7) * 6, 12 + (i % 5) * 5, i, 0, Math.PI * 2); x.fill();
    }
    const line = (pts, w, col) => {
      x.strokeStyle = col; x.lineWidth = w * PX; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); pts.forEach((p, i) => { const [a, b] = P(p.x, p.z); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.stroke();
    };
    // الترعة (بحر شبين)
    if (SHIBIN?.canal) { const C = SHIBIN.canal; const [ca, cb] = P(C.x - C.half, C.z0); x.fillStyle = '#4fb3ea'; x.fillRect(ca, cb, C.half * 2 * PX, (C.z1 - C.z0) * PX); }
    // وسط البلد: بلوكات مباني فاتحة
    x.fillStyle = '#f3e3c3';
    { const [a, b] = P(-90, ROAD.zMin); x.fillRect(a, b, 180 * PX, (ROAD.zMax - ROAD.zMin) * PX); }
    // الطرق: حدود غامقة + أسفلت أبيض/أصفر (الطريق الرئيسي أصفر زي خرايط الموبايل)
    line(LOOP.samples, 30, '#5b5348');
    for (const cr of CROSSINGS) line([{ x: cr.xMin, z: cr.z }, { x: cr.xMax, z: cr.z }], cr.half * 2 + 6, '#5b5348');
    for (const r of ROADS) line(r.samples, r.half * 2 + 8, '#5b5348');
    for (const cr of CROSSINGS) line([{ x: cr.xMin, z: cr.z }, { x: cr.xMax, z: cr.z }], cr.half * 2, '#ffffff');
    for (const r of ROADS) line(r.samples, r.half * 2 + 1, r.surface === 'dirt' ? '#e2c48a' : '#ffffff');
    line(LOOP.samples, 22, '#ffd34d');
    // الموقف
    x.fillStyle = '#ff9f43'; x.strokeStyle = '#5b5348'; x.lineWidth = 3;
    const [ta, tb] = P(TERMINAL.x0, TERMINAL.z0); x.fillRect(ta, tb, (TERMINAL.x1 - TERMINAL.x0) * PX, (TERMINAL.z1 - TERMINAL.z0) * PX); x.strokeRect(ta, tb, (TERMINAL.x1 - TERMINAL.x0) * PX, (TERMINAL.z1 - TERMINAL.z0) * PX);
    // أسامي الطرق: كلام غامق بحرف أبيض
    x.font = 'bold 14px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl'; x.lineJoin = 'round';
    const lbl = (t, wx, wz, size = 14) => { const [a, b] = P(wx, wz); x.font = `bold ${size}px Cairo, sans-serif`; x.lineWidth = 4; x.strokeStyle = '#fff'; x.strokeText(t, a, b); x.fillStyle = '#3a3128'; x.fillText(t, a, b); };
    for (const r of ROADS) { const m = r.samples[r.samples.length >> 1]; lbl(r.name, m.x, m.z - 10); }
    lbl('وسط البلد', 0, ROAD.zMax - 60, 18);
    lbl('شبين الكوم', 220, 380, 18);
    lbl('🚐 موقف الميكروباص', (TERMINAL.x0 + TERMINAL.x1) / 2, TERMINAL.z1 + 16, 15);
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
    x.fillStyle = '#9fd67a'; x.fillRect(0, 0, W, H);
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
    const text = (t, wx, wz, col = '#fff') => { const [a, b] = toBase(wx, wz); x.save(); x.translate(a, b); if (!big) x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr); x.font = 'bold 12px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl'; x.lineWidth = 3.5; x.strokeStyle = '#fff'; x.strokeText(t, 0, -10); x.fillStyle = col === '#fff' ? '#3a3128' : col; x.fillText(t, 0, -10); x.restore(); };
    // المواقف: أصفر = فيه ناس مستنية، أخضر = موقف نازل فيه حد معاك
    const P = this.game.passengers;
    if (P) {
      const dests = new Set(P.onboard.map((o) => o.dest));
      for (const st of P.stops) {
        const has = st.waiting.some((w) => w.state === 'wait');
        const dest = dests.has(st);
        if (!has && !dest) continue;
        dot(st.x, st.z, dest ? 7 : 5.5, dest ? '#22c55e' : '#ffcc00', '#3a3128');
        if (dest) text(st.name, st.x, st.z, '#15803d');
      }
    }
    // اللاعبين التانيين
    for (const o of this.game.mp?.positions() || []) { dot(o.x, o.z, 7, '#3b82f6', '#fff'); text(`${o.seat} ${o.name || ''}`, o.x, o.z, '#1e3a8a'); }
    // إنت: سهم
    {
      const [a, b] = toBase(ph.x, ph.z);
      x.save(); x.translate(a, b); x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr);
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath();
      x.fillStyle = '#ff5a36'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#fff'; x.stroke();
      x.restore();
    }
    x.restore();
    if (big) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, H - 26 * dpr, W, 26 * dpr); x.fillStyle = '#fff'; x.font = `${12 * dpr}px Cairo, sans-serif`; x.textAlign = 'center'; x.direction = 'rtl'; x.fillText('🟡 ناس مستنية · 🟢 مكان نزول راكب معاك · 🔵 لاعبين — دوس على الخريطة عشان تقفلها', W / 2, H - 9 * dpr); }
  }
}
