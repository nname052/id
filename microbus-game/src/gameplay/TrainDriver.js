// =====================================================================
//  سواقة القطر (MAJOR UPDATE — STAGE 6): اللاعب بيسوق قطر السكة الحديد اللي في المدينة نفسه.
//  - فيزيا طولية بسيطة وواقعية: كتلة ~310 طن (جرار + 5 عربيات)، جرّ محدود بالقدرة (≈2.4 ميجاوات: F = min(Fmax, P/v))،
//    مقاومة Davis (احتكاك + هوا ∝ v²)، فرامل لحد ~1 م/ث² (القطر بيقف في مسافة طويلة زي الحقيقة)، أقصى 90 كم/س.
//  - البنزين = الجرّ، الفرامل = الفرامل؛ واقف + فرامل مكمّلة = عكس الاتجاه (زي الريوس في العربيات).
//  - المحطة: لو وقفت والقطر في نص الرصيف (±15م) الأبواب بتفتح، الركاب بينزلوا/يطلعوا، وفلوس على الرحلة.
//  - آخر الخط: مصدّ — القطر بيقف (مش بيخرج من الخريطة).
//  - الكاميرا: كابينة الجرار / ورا القطر من فوق / حرة حوالين الجرار (نفس زرار الكاميرا).
// =====================================================================
const M = 310000, FMAX = 260000, POWER = 2.4e6, VMAX = 25, BRAKE = 1.0, G = 9.81;

export class TrainDriver {
  constructor(game) {
    this.g = game; this.rail = game.world?.rail; this.T = this.rail?.trains?.[0] || null;
    this.revT = 0; this.doors = 0; this.served = null; this.trips = 0; this.earned = 0; this._eye = null;
  }

  get ok() { return !!(this.T && this.rail?.line && this.rail.line.length > 300); }

  enter() {
    const T = this.T, R = this.rail;
    T.player = true; T.state = 'run'; T.v = 0; T.dir = 1;
    // بيبدأ واقف في المحطة الرئيسية (القطر كله على الرصيف)
    const st = R.stations.find((s) => s.main) || R.stations[0];
    const half = T.len / 2;
    T.s = st ? Math.min(R.line.length - 5, Math.max(T.len + 5, st.s + half)) : T.len + 5;
    this.served = st || null; this.doors = 0;
    this.g.hud.toast('🚆 إنت في كابينة القطر — بنزين = جرّ، فرامل = فرامل. اقف في نص الرصيف عشان الأبواب تفتح', 5);
  }

  exit() { if (this.T) { this.T.player = false; this.T.state = 'run'; } }

  /** بيتنادي من ShibinRail.update بدل المنطق الأوتوماتيكي */
  update(dt, input) {
    const T = this.T, R = this.rail, L = R.line.length;
    const thr = Math.max(0, input.throttle || 0), brk = Math.max(0, input.brake || 0);
    // عكس الاتجاه: واقف تمامًا + فرامل مدوسة ثانية من غير بنزين
    if (T.v < 0.05 && brk > 0.5 && thr < 0.1) {
      this.revT += dt;
      if (this.revT > 1.0) { this.revT = -99; T.dir = -T.dir; this.g.hud.toast(T.dir > 0 ? '🚆 الاتجاه: لقدام' : '🚆 الاتجاه: لورا (الناحية التانية من الخط)', 2.2); }
    } else if (brk < 0.2) this.revT = 0;
    // القوى (موجب = في اتجاه السير)
    const v = T.v;
    const traction = this.doors > 0 ? 0 : thr * Math.min(FMAX, POWER / Math.max(v, 1));
    const davis = (v > 0.01 ? 1 : 0) * (M * G * 0.0015 + 900 * v) + 8.5 * v * v;
    const brake = brk * M * BRAKE * (v > 0.01 ? 1 : 0);
    let a = (traction - davis - brake) / M;
    T.v = Math.max(0, Math.min(VMAX, v + a * dt));
    // المصدّ آخر الخط: القطر كله جوه الخط
    const sNext = T.s + T.v * T.dir * dt;
    const lo = T.len + 2, hi = L - 2;
    if ((T.dir > 0 && sNext > hi) || (T.dir < 0 && sNext < lo)) {
      if (T.v > 0.5) this.g.hud.toast('⛔ آخر الخط — اقف وارجع بالفرامل (اتجاه عكسي)', 2.5);
      T.v = 0; T.s = Math.max(lo, Math.min(hi, sNext));
    } else T.s = sNext;
    // المحطة: الأبواب
    if (this.doors > 0) {
      this.doors -= dt;
      if (this.doors <= 0) this.g.hud.toast('🚪 الأبواب اتقفلت — اتفضل اتحرك', 1.8);
    } else if (T.v < 0.3) {
      for (const st of R.stations) {
        if (st === this.served) continue;
        const mid = T.s - T.dir * T.len / 2; // نص القطر
        if (Math.abs(mid - st.s) < 15) {
          this.served = st; this.doors = 6; this.trips++;
          const pay = 25 + Math.round(Math.random() * 15); this.earned += pay;
          this.g.wallet?.add?.(pay, 'train', `رحلة قطر — ${st.name}`);
          this.g.hud.toast(`🚉 ${st.name} — الأبواب مفتوحة، الركاب بينزلوا ويطلعوا (+${pay} ج)`, 4);
          break;
        }
        if (Math.abs(mid - st.s) < 80 && Math.abs(mid - st.s) >= 15 && !this._warnT) { this._warnT = 3; this.g.hud.toast(`🚉 ${st.name}: قرّب نص القطر من نص الرصيف (${Math.round(Math.abs(mid - st.s))}م)`, 2); }
      }
    }
    this._warnT = Math.max(0, (this._warnT || 0) - dt) || 0;
    // مكان اللاعب (للمرور والمشاة وتحميل المربعات): عند الجرار
    const ph = this.g.player.physics, c = T.cars[0];
    if (c?.m) { ph.x = c.m.position.x; ph.z = c.m.position.z; ph.vx = 0; ph.vz = 0; }
  }

  /** الكاميرا: mode 0 كابينة، 1 ورا القطر، 2 حرة حوالين الجرار */
  camera(cam, mode, dt) {
    const c = this.T.cars[0]; if (!c?.m) return;
    const yaw = c.m.rotation.y; // (اتجاه الجرار = اتجاه السير: الوش اللي قدام بيتحسب من نقطة المقدمة)
    const fx = Math.sin(yaw), fz = Math.cos(yaw), p = c.m.position;
    // (الجرار: المقدمة في اتجاه السير — مع الاتجاه العكسي الكابينة التانية)
    // (الكابينة: عين السواق عند زجاج المقدمة بالظبط — جوه جسم الجرار كانت الصورة مقفولة بلوح غامق)
    const front = c.len / 2 + 0.15;
    if (mode === 0) {
      cam.position.set(p.x + fx * front - fz * 0.55, 3.2, p.z + fz * front + fx * 0.55);
      cam.lookAt(p.x + fx * (front + 30), 2.4, p.z + fz * (front + 30));
    } else {
      const back = mode === 1 ? 26 : 14, up = mode === 1 ? 9 : 5, side = mode === 1 ? 0 : 10;
      const tx = p.x - fx * back + fz * side, tz = p.z - fz * back - fx * side;
      const e = this._eye || (this._eye = cam.position.clone());
      const k = Math.min(1, dt * 4);
      e.x += (tx - e.x) * k; e.y += (up - e.y) * k; e.z += (tz - e.z) * k;
      cam.position.copy(e); cam.lookAt(p.x + fx * 12, 1.8, p.z + fz * 12);
    }
    cam.updateMatrixWorld();
  }

  hud() {
    const H = this.g.hud, kmh = Math.round(this.T.v * 3.6);
    H.speed.textContent = kmh;
    const g = this.doors > 0 ? 'P' : this.T.dir > 0 ? 'D' : 'R';
    if (g !== this._g) { this._g = g; H.gear.textContent = g; H.gear.className = g === 'R' ? 'R' : ''; H.gearNum.textContent = this.doors > 0 ? 'أبواب مفتوحة' : 'قطر'; }
  }
}
