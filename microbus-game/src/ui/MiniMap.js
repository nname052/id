import { LOOP } from '../traffic/TrafficSystem.js';
import { ROADS } from '../world/RoadNetwork.js';
import { RACE } from '../world/RaceTrack.js';
import { ROAD, CROSSINGS } from '../world/layout.js';
import { TERMINAL } from '../world/Shibin.js';
import { SHIBIN } from '../world/RoadNetwork.js';
import { STATION } from '../world/PetrolStation.js';

// خريطة الطرق: صغيرة في الركن (بتلف مع اتجاهك)، ولما تدوس عليها بتكبر لخريطة كاملة (الشمال لفوق).
// الطرق بتترسم مرة واحدة في canvas جاهز، وكل فريم بنرسم فوقها: طريق الـ GPS، خط الميكروباص ومحطاته،
// الزباين اللي بيشاوروا، الوجهة، اللاعبين التانيين، وإنت.
// الخريطة الصغيرة من غير كلام (أسامي الطرق في الكبيرة بس). وكمان بترسم شاشة الخريطة اللي في التابلوه (navCanvas).

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
    // الصغيرة: دوسة = تفتح الكبيرة. الكبيرة: سحب = تحريك، عجلة/قرصة/أزرار = زوم، دوسة على مكان = "اذهب إلى هنا"
    el.insertAdjacentHTML('beforeend', '<div class="mm-ui"><button class="mm-close" aria-label="قفل">✕</button><div class="mm-zoom"><button data-z="1.5" aria-label="تكبير">+</button><button data-z="0.667" aria-label="تصغير">−</button><button data-z="me" aria-label="مكاني">◎</button></div><div class="mm-panel hidden"><div class="mm-pname"></div><div class="mm-pbtns"><button class="mm-go">🧭 اذهب إلى هنا</button><button class="mm-cancel">إلغاء</button></div></div></div>');
    this.ui = el.querySelector('.mm-ui');
    this.panel = el.querySelector('.mm-panel');
    this.ui.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ui.querySelector('.mm-close').onclick = () => this.toggle();
    this.ui.querySelectorAll('.mm-zoom button').forEach((b) => (b.onclick = () => {
      if (b.dataset.z === 'me') { const ph = this.game.player.physics; this.view.cx = ph.x; this.view.cz = ph.z; this.view.zoom = Math.max(this.view.zoom, 3); }
      else this._zoomAt(+b.dataset.z);
      this._t = 0;
    }));
    this.ui.querySelector('.mm-go').onclick = () => { if (this.sel) this.game.setUserTarget?.(this.sel); this.sel = null; this.panel.classList.add('hidden'); this.toggle(); };
    this.ui.querySelector('.mm-cancel').onclick = () => { this.sel = null; this.panel.classList.add('hidden'); this._t = 0; };
    this.view = { cx: 0, cz: 0, zoom: 1 };
    this._ptrs = new Map();
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this.big) { this.toggle(); return; }
      el.setPointerCapture?.(e.pointerId);
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      this._moved = false;
    });
    el.addEventListener('pointermove', (e) => {
      const q = this._ptrs.get(e.pointerId);
      if (!this.big || !q) return;
      const k = this._worldPerCss();
      if (this._ptrs.size === 1) {
        this.view.cx -= (e.clientX - q.x) * k; this.view.cz -= (e.clientY - q.y) * k;
      } else if (this._ptrs.size === 2) {
        const [a, b] = [...this._ptrs.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        q.x = e.clientX; q.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d0 > 10) this._zoomAt(d1 / d0);
      }
      q.x = e.clientX; q.y = e.clientY;
      if (Math.hypot(q.x - q.x0, q.y - q.y0) > 7) this._moved = true;
      this._t = 0;
    });
    const up = (e) => {
      if (!this._ptrs.has(e.pointerId)) return;
      this._ptrs.delete(e.pointerId);
      if (this.big && !this._moved && !this._ptrs.size) this._tap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => this._ptrs.delete(e.pointerId));
    el.addEventListener('wheel', (e) => { if (!this.big) return; e.preventDefault(); this._zoomAt(e.deltaY < 0 ? 1.25 : 0.8); this._t = 0; }, { passive: false });
    this.PX = PX;
    if (game.world?.minimapData) this._bakeWorld(game.world); else this._bake();
    this._t = 0;
    // شاشة الخريطة اللي في تابلوه التاكسي/الميكروباص
    this.navCv = document.createElement('canvas');
    this.navCv.width = 320; this.navCv.height = 200;
    this.navCtx = this.navCv.getContext('2d');
    this._navT = 0;
  }

  show() { this.el.classList.remove('hidden'); }
  toggle() {
    this.big = !this.big; this.el.classList.toggle('big', this.big); this._t = 0;
    this.sel = null; this.panel?.classList.add('hidden'); this._ptrs?.clear();
    // بتفتح على مكانك، متكبرة شوية
    if (this.big) { const ph = this.game.player.physics; this.view.cx = ph.x; this.view.cz = ph.z; this.view.zoom = 2.5; }
  }

  _fitScale(W, H) { return Math.min(W / (this.b.w * this.PX), H / (this.b.h * this.PX)); }
  /** كام متر في كل بكسل CSS (للسحب) */
  _worldPerCss() {
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = this.el.clientWidth * dpr, H = this.el.clientHeight * dpr;
    return dpr / (this._fitScale(W, H) * this.view.zoom * this.PX);
  }
  _zoomAt(f) { this.view.zoom = Math.max(1, Math.min(14, this.view.zoom * f)); }
  _screenToWorld(cx, cy) {
    const r = this.el.getBoundingClientRect(), k = this._worldPerCss();
    return [this.view.cx + (cx - r.left - r.width / 2) * k, this.view.cz + (cy - r.top - r.height / 2) * k];
  }

  /** أماكن حقيقية من البيانات (OSM) — مفيش أماكن متألفة */
  _pois() {
    if (this._poiList) return this._poiList;
    const ICON = { rail_station: '🚉', rail_halt: '🚉', hospital: '🏥', university: '🎓', stadium: '🏟', post: '📮', bridge: '🌉', street: '🛣', canal: '💧' };
    const W = this.game.world, out = [];
    for (const l of W?.landmarkPoints || []) out.push({ name: l.name, x: l.rx, z: l.rz, icon: ICON[l.kind] || '📍' });
    for (const sp of W?.policeSpots || []) out.push({ name: sp.name, x: sp.q.x, z: sp.q.z, icon: '👮' });
    return (this._poiList = out);
  }

  _tap(cx, cy) {
    const [wx, wz] = this._screenToWorld(cx, cy), k = this._worldPerCss();
    // أقرب مكان معروف في حدود ~22 بكسل
    let best = null, bd = 22 * k;
    for (const p of this._pois()) { const d = Math.hypot(p.x - wx, p.z - wz); if (d < bd) { bd = d; best = p; } }
    if (!best) {
      // أي نقطة: بنلزقها على أقرب شارع (والاسم من OSM لو موجود)
      const W = this.game.world, r = W?.nearestRoad?.(wx, wz, Math.max(40, 30 * k));
      if (!r) { this.sel = null; this.panel.classList.add('hidden'); return; }
      const cls = r.e.cls.replace('_link', '');
      best = { x: r.x ?? wx, z: r.z ?? wz, name: r.e.name || (['primary', 'trunk', 'secondary'].includes(cls) ? 'طريق رئيسي (مالوش اسم مسجّل)' : 'شارع جانبي'), icon: '📍' };
    }
    this.sel = best;
    this.panel.querySelector('.mm-pname').textContent = `${best.icon} ${best.name}`;
    this.panel.classList.remove('hidden');
    this._t = 0;
  }

  // ===== الطبقة الثابتة: كل الطرق =====
  _bake() {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const p of LOOP.samples) grow(p.x, p.z);
    for (const r of ROADS) for (const p of r.samples) grow(p.x, p.z);
    for (const p of RACE.samples) grow(p.x, p.z);
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
    // حلبة السباق: أسفلت غامق بحواف حمرا + خط البداية
    { const loop = [...RACE.samples, RACE.samples[0]]; line(loop, 26, '#b91c1c'); line(loop, 16, '#4b5563'); }
    // الموقف
    x.fillStyle = '#ff9f43'; x.strokeStyle = '#5b5348'; x.lineWidth = 3;
    const [ta, tb] = P(TERMINAL.x0, TERMINAL.z0); x.fillRect(ta, tb, (TERMINAL.x1 - TERMINAL.x0) * PX, (TERMINAL.z1 - TERMINAL.z0) * PX); x.strokeRect(ta, tb, (TERMINAL.x1 - TERMINAL.x0) * PX, (TERMINAL.z1 - TERMINAL.z0) * PX);
    // البنزينة (أرضية + مظلة + علامة طلمبة)
    {
      const S = STATION, [a0, b0] = P(S.pad.x0, S.pad.z0);
      x.fillStyle = '#8f8f94'; x.fillRect(a0, b0, (S.pad.x1 - S.pad.x0) * PX, (S.pad.z1 - S.pad.z0) * PX);
      const [a1, b1] = P(S.canopy.x0, S.canopy.z0);
      x.fillStyle = '#16a34a'; x.fillRect(a1, b1, (S.canopy.x1 - S.canopy.x0) * PX, (S.canopy.z1 - S.canopy.z0) * PX);
      const [ia, ib] = P((S.canopy.x0 + S.canopy.x1) / 2, (S.canopy.z0 + S.canopy.z1) / 2);
      x.fillStyle = '#fff'; x.beginPath(); x.arc(ia, ib, 7, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#16a34a'; x.fillRect(ia - 3, ib - 4, 5, 8); x.fillRect(ia + 2, ib - 2, 2, 5);
    }
    // نسخة من غير كلام للخريطة الصغيرة وشاشة التابلوه، والأسامي للكبيرة بس
    this.baseNL = document.createElement('canvas');
    this.baseNL.width = c.width; this.baseNL.height = c.height;
    this.baseNL.getContext('2d').drawImage(c, 0, 0);
    // أسامي الطرق: كلام غامق بحرف أبيض
    x.font = 'bold 14px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl'; x.lineJoin = 'round';
    const lbl = (t, wx, wz, size = 14) => { const [a, b] = P(wx, wz); x.font = `bold ${size}px Cairo, sans-serif`; x.lineWidth = 4; x.strokeStyle = '#fff'; x.strokeText(t, a, b); x.fillStyle = '#3a3128'; x.fillText(t, a, b); };
    for (const r of ROADS) { const m = r.samples[r.samples.length >> 1]; lbl(r.name, m.x, m.z - 10); }
    lbl('وسط البلد', 0, ROAD.zMax - 60, 18);
    lbl('شبين الكوم', 220, 380, 18);
    lbl('🚐 موقف الميكروباص', (TERMINAL.x0 + TERMINAL.x1) / 2, TERMINAL.z1 + 16, 15);
    lbl('🏁 حلبة السباق', -410, 70, 16);
    lbl('⛽ بنزينة الترعة', (STATION.pad.x0 + STATION.pad.x1) / 2, STATION.pad.z1 + 14, 14);
  }

  /** خريطة منطقة حقيقية (شبين الكوم من OSM): الطرق الحقيقية + الترع + السكة + المعالم + بوابات التوسع */
  _bakeWorld(W) {
    const D = W.minimapData();
    const PXw = (this.PX = W.low ? 0.32 : 0.4);
    const [bx0, bz0, bx1, bz1] = D.bbox;
    const x0 = bx0 - 80, z0 = bz0 - 80;
    this.b = { x0, z0, w: bx1 - bx0 + 160, h: bz1 - bz0 + 160 };
    const c = (this.base = document.createElement('canvas'));
    c.width = Math.ceil(this.b.w * PXw); c.height = Math.ceil(this.b.h * PXw);
    const x = c.getContext('2d');
    x.fillStyle = '#9fd67a'; x.fillRect(0, 0, c.width, c.height);
    const P = (wx, wz) => [(wx - x0) * PXw, (wz - z0) * PXw];
    const poly = (flat, w, col, dash) => {
      x.strokeStyle = col; x.lineWidth = Math.max(1, w * PXw); x.lineCap = 'round'; x.lineJoin = 'round';
      x.setLineDash(dash || []);
      x.beginPath();
      for (let i = 0; i < flat.length; i += 2) { const [a, b] = P(flat[i], flat[i + 1]); if (i) x.lineTo(a, b); else x.moveTo(a, b); }
      x.stroke(); x.setLineDash([]);
    };
    // المدينة: نسيج مباني فاتح حوالين كل الشوارع
    for (const r of D.roads) poly(r.p, 46, '#efe0c2');
    for (const w of D.water) poly(w.p, Math.max(6, w.w), '#4fb3ea');
    for (const r of D.rail) poly(r.p, 4, '#6b5b4b', [10, 6]);
    for (const r of D.roads) poly(r.p, r.w + 6, '#5b5348');
    for (const r of D.roads) poly(r.p, r.w + 1, r.major ? '#ffd34d' : '#ffffff');
    // بوابات التوسع (حدود المنطقة)
    for (const g of D.gates) { const [a, b] = P(g.x, g.z); x.fillStyle = '#d62828'; x.fillRect(a - 4, b - 4, 8, 8); }
    // حدود المنطقة
    x.strokeStyle = 'rgba(214,40,40,0.6)'; x.lineWidth = 3; x.setLineDash([14, 8]);
    x.beginPath(); D.boundary.forEach(([wx, wz], i) => { const [a, b] = P(wx, wz); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.stroke(); x.setLineDash([]);
    this.baseNL = document.createElement('canvas');
    this.baseNL.width = c.width; this.baseNL.height = c.height;
    this.baseNL.getContext('2d').drawImage(c, 0, 0);
    x.textAlign = 'center'; x.direction = 'rtl'; x.lineJoin = 'round';
    const lbl = (t, wx, wz, size = 13, col = '#3a3128') => { const [a, b] = P(wx, wz); x.font = `bold ${size}px Cairo, sans-serif`; x.lineWidth = 4; x.strokeStyle = '#fff'; x.strokeText(t, a, b); x.fillStyle = col; x.fillText(t, a, b); };
    for (const s of D.streetLabels) lbl(s.name, s.x, s.z, 12);
    for (const l of D.landmarks) lbl(`📍 ${l.name}`, l.x, l.z - 8, 14, '#0d4f8c');
  }

  update(dt) {
    // شاشة التابلوه: 4 مرات في الثانية بس
    this._navT -= dt;
    if (this._navT <= 0) { this._navT = 0.25; this._draw(this.navCtx, this.navCv.width, this.navCv.height, { big: false, dpr: 1, zoom: 1.35, dash: true }); }
    if (this.el.classList.contains('hidden')) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 1 / 12;
    const cv = this.cv, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.el.clientWidth * dpr), H = Math.round(this.el.clientHeight * dpr);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    this._draw(this.ctx, W, H, { big: this.big, dpr, zoom: 1 });
  }

  _draw(x, W, H, { big, dpr, zoom, dash = false }) {
    const ph = this.game.player.physics;
    const base = big ? this.base : this.baseNL;
    const PX = this.PX;
    const scale = big ? this._fitScale(W, H) * this.view.zoom : (1.6 * dpr / (PX * 2)) * zoom;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#9fd67a'; x.fillRect(0, 0, W, H);
    // التحويل: العالم → الشاشة
    const toBase = (wx, wz) => [(wx - this.b.x0) * PX, (wz - this.b.z0) * PX];
    x.save();
    if (big) {
      const [vx, vz] = toBase(this.view.cx, this.view.cz);
      x.imageSmoothingEnabled = this.view.zoom < 3;
      x.translate(W / 2, H / 2); x.scale(scale, scale); x.translate(-vx, -vz);
    } else {
      // بتلف مع العربية: قدامك لفوق
      const [px, pz] = toBase(ph.x, ph.z);
      x.translate(W / 2, H * (dash ? 0.66 : 0.62)); x.rotate(ph.yaw); x.scale(scale, scale); x.translate(-px, -pz);
    }
    x.drawImage(base, 0, 0);
    const k = 1 / scale; // حجم ثابت على الشاشة
    const dot = (wx, wz, r, col, stroke) => { const [a, b] = toBase(wx, wz); x.beginPath(); x.arc(a, b, r * k * dpr, 0, Math.PI * 2); x.fillStyle = col; x.fill(); if (stroke) { x.lineWidth = 2 * k * dpr; x.strokeStyle = stroke; x.stroke(); } };
    const text = (t, wx, wz, col = '#fff') => { const [a, b] = toBase(wx, wz); x.save(); x.translate(a, b); if (!big) x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr); x.font = 'bold 12px Cairo, sans-serif'; x.textAlign = 'center'; x.direction = 'rtl'; x.lineWidth = 3.5; x.strokeStyle = '#fff'; x.strokeText(t, 0, -10); x.fillStyle = col === '#fff' ? '#3a3128' : col; x.fillText(t, 0, -10); x.restore(); };
    const path = (pts, from, w, col, alpha = 1) => {
      if (!pts || pts.length < 2) return;
      x.globalAlpha = alpha; x.strokeStyle = col; x.lineWidth = w * k * dpr; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath();
      for (let i = from; i < pts.length; i++) { const [a, b] = toBase(pts[i].x, pts[i].z); if (i === from) x.moveTo(a, b); else x.lineTo(a, b); }
      x.stroke(); x.globalAlpha = 1;
    };
    const pin = (wx, wz, col) => {
      const [a, b] = toBase(wx, wz);
      x.save(); x.translate(a, b); if (!big) x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr);
      x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(-9, -10, -9, -22, 0, -22); x.bezierCurveTo(9, -22, 9, -10, 0, 0);
      x.fillStyle = col; x.fill(); x.lineWidth = 2; x.strokeStyle = '#fff'; x.stroke();
      x.beginPath(); x.arc(0, -15, 3.2, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill();
      x.restore();
    };
    const P = this.game.passengers, nav = this.game.nav;
    // خط الميكروباص كله (بلونه) + محطاته
    if (P?.mode === 'line' && P.linePath) {
      path(P.linePath.pts, 0, 9, '#ffffff', 0.9);
      path(P.linePath.pts, 0, 5.5, P.line?.color || '#e8711a', 0.95);
      const next = P.nextStop;
      for (const st of P.lineStops) dot(st.x, st.z, st === next ? 6.5 : 4.2, st === next ? '#ffffff' : (P.line?.color || '#e8711a'), '#3a3128');
      if (next && (big || dash)) text(next.name, next.x, next.z, '#1f2937');
    }
    // طريق الـ GPS (من مكانك لحد الهدف)
    // بيظهر بس وإنت محمّل ركاب (أو الكمين/البنزين محتاجينك تروح مكان) — وإنت فاضي الخريطة نضيفة
    if (nav?.route && (P?.onboard?.length || this.game.hud?.navOverride || this.game.userTarget)) {
      const from = Math.max(0, nav._track?.i ?? 0);
      path(nav.route.pts, from, 8, '#ffffff', 0.95);
      path(nav.route.pts, from, 4.6, '#2b7cff', 1);
    }
    if (P) {
      // الزباين اللي بيشاوروا (تاكسي/توكتوك) + أماكن نزول الركاب
      const dests = new Set(P.onboard.map((o) => o.dest));
      for (const st of P.stops) {
        if (P.mode === 'line' && P.lineStops.includes(st)) continue;
        const has = st.waiting.some((w) => w.state === 'wait') && st.kind !== 'terminal';
        if (has && P.mode === 'trip' && !P.trip) dot(st.x, st.z, 5.5, '#ffcc00', '#3a3128');
        else if (dests.has(st) && P.mode === 'line') dot(st.x, st.z, 6, '#22c55e', '#3a3128');
      }
    }
    if (big) {
      for (const p of this._pois()) {
        const [a, b] = toBase(p.x, p.z);
        x.save(); x.translate(a, b); x.scale(k * dpr, k * dpr);
        x.beginPath(); x.arc(0, 0, 11, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,0.92)'; x.fill(); x.lineWidth = 2; x.strokeStyle = '#0d4f8c'; x.stroke();
        x.font = '13px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(p.icon, 0, 1);
        x.restore();
      }
      if (this.sel) pin(this.sel.x, this.sel.z, '#7c3aed');
    }
    if (nav?.target) pin(nav.target.x, nav.target.z, this.game.userTarget ? '#7c3aed' : P?.trip ? '#16a34a' : P?.mode === 'line' ? '#e8711a' : '#f59e0b');
    // اللاعبين التانيين
    // كل لاعب بلون رقمه (نفس لون الاسم فوق عربيته) واسمه جنبه
    for (const o of this.game.mp?.positions() || []) { dot(o.x, o.z, 7, o.color || '#3b82f6', '#fff'); text(`${o.seat} ${o.name || ''}`, o.x, o.z, o.color || '#1e3a8a'); }
    // إنت: سهم
    {
      const [a, b] = toBase(ph.x, ph.z);
      x.save(); x.translate(a, b); x.rotate(-ph.yaw); x.scale(k * dpr, k * dpr);
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7, 8); x.lineTo(0, 4); x.lineTo(-7, 8); x.closePath();
      x.fillStyle = '#ff5a36'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#fff'; x.stroke();
      x.restore();
    }
    x.restore();
    if (big) { x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, H - 26 * dpr, W, 26 * dpr); x.fillStyle = '#fff'; x.font = `${12 * dpr}px Cairo, sans-serif`; x.textAlign = 'center'; x.direction = 'rtl'; x.fillText('اسحب للتحريك · عجلة/قرصة للزوم · دوس على مكان → اذهب إلى هنا · 🔵 طريقك · 🟠 الخط · 🟡 زبون', W / 2, H - 9 * dpr); }
  }
}
