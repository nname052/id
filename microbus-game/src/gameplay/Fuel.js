// =====================================================================
//  البنزين: تانك لكل عربية (سعة + مستوى بيتحفظ)، استهلاك على حسب المسافة والبنزين اللي دايسه + شوية وهي دايرة،
//  تحذير لما يقل، والموتور بيقطّع وبعدين بيطفي لما يخلص. التفويل من البنزينة بفلوس من المحفظة.
//  (الاستهلاك متسرّع عن الحقيقة عشان التفويل يبقى جزء من اللعب: تانك كامل ≈ ساعة سواقة)
// =====================================================================
const KEY = 'egy-fuel-v1';

export const FUEL_SPECS = {
  microbus: { capacity: 70, perKm: 1.0, idle: 1.4, type: 'سولار', price: 17.5 },
  taxi: { capacity: 45, perKm: 0.55, idle: 0.9, type: 'بنزين ٩٢', price: 19.25 },
  tuktuk: { capacity: 8, perKm: 0.12, idle: 0.25, type: 'بنزين ٨٠', price: 17.75 },
};
const START = 0.38; // أول مرة: التانك تلته وشوية

export class FuelSystem {
  constructor({ hud, wallet } = {}) {
    this.hud = hud; this.wallet = wallet;
    this.tanks = {};
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
    for (const [k, sp] of Object.entries(FUEL_SPECS)) {
      const lv = Number.isFinite(saved[k]) ? saved[k] : sp.capacity * START;
      this.tanks[k] = { kind: k, spec: sp, capacity: sp.capacity, level: Math.max(0, Math.min(sp.capacity, lv)) };
    }
    this.player = null;
    this._saveT = 5; this._warned = 0; this._warnT = 0;
    this.filling = null;
  }

  /** العربية الحالية: player.fuel بيشاور على تانكها (العدادات والشاشات بتقرا منه) */
  attach(player) {
    this.player = player;
    player.fuel = this.tanks[player.kind] || this.tanks.microbus;
    this._warned = 0;
  }

  get tank() { return this.player?.fuel; }
  get frac() { const t = this.tank; return t ? t.level / t.capacity : 1; }
  get low() { return this.frac < 0.15; }
  get empty() { return (this.tank?.level ?? 1) <= 0; }

  update(dt, ph) {
    const t = this.tank;
    if (!t) return;
    // تفويل شغال: اللترات بتدخل التانك بالتدريج (8 لتر/ث)
    if (this.filling) {
      const f = this.filling, step = Math.min(f.left, 8 * dt);
      t.level = Math.min(t.capacity, t.level + step); f.left -= step;
      if (f.left <= 1e-3) { this.filling = null; f.done?.(); this._save(); }
    }
    if (t.level > 0) {
      const km = Math.abs(ph.speed) * dt / 1000;
      const use = t.spec.perKm * km * (0.55 + 0.9 * (ph.throttle || 0)) + (t.spec.idle / 3600) * dt;
      t.level = Math.max(0, t.level - use);
    }
    const fr = t.level / t.capacity;
    // آخر نقطة: الموتور بيقطّع، وبعدين بيطفي
    ph.starve = fr < 0.012 && fr > 0 ? 1 : 0;
    const was = ph.engineOff;
    ph.engineOff = t.level <= 0;
    if (ph.engineOff && !was) this.hud?.toast('⛽ البنزين خلص والموتور طفى! اطلب جركن أو زق لأقرب بنزينة', 4);
    // تحذيرات: 15% و 7% (ومرة كل دقيقة ونص لما يبقى قليل)
    this._warnT -= dt;
    if (fr < 0.15 && this._warned < 1) { this._warned = 1; this._warnT = 90; this.hud?.toast('⛽ البنزين قرب يخلص — الـ GPS هيوديك البنزينة', 3.5); }
    else if (fr < 0.07 && this._warned < 2) { this._warned = 2; this._warnT = 90; this.hud?.toast('⛽ احتياطي! فوّل حالًا', 3); }
    else if (fr < 0.1 && this._warnT <= 0) { this._warnT = 90; this.hud?.toast('⛽ البنزين قليل', 2.5); }
    if (fr > 0.2) this._warned = 0;
    this._saveT -= dt;
    if (this._saveT <= 0) { this._saveT = 5; this._save(); }
  }

  /** تكلفة لترات معينة */
  cost(liters) { return Math.round(liters * (this.tank?.spec.price || 19) * 100) / 100; }
  /** اللترات اللي التانك يشيلها */
  space() { const t = this.tank; return t ? Math.max(0, t.capacity - t.level) : 0; }

  /** تفويل (من البنزينة): بيدفع من المحفظة الأول. بيرجّع اللترات أو 0 لو الفلوس مش كفاية */
  buy(liters, done) {
    const t = this.tank;
    if (!t || this.filling) return 0;
    liters = Math.min(liters, this.space());
    if (liters < 0.2) return 0;
    const cost = Math.round(this.cost(liters));
    if (!this.wallet?.spend(cost, 'fuel', `${t.spec.type} ${liters.toFixed(1)} لتر`)) return 0;
    this.filling = { left: liters, done: () => done?.(liters, cost) };
    return liters;
  }

  /** جركن طوارئ لما البنزين يخلص في الطريق (أغلى، وبيتخصم حتى لو الرصيد مش كفاية) */
  jerrycan() {
    const t = this.tank;
    if (!t) return 0;
    const liters = Math.min(t.capacity * 0.2, 5, this.space());
    const cost = Math.round(this.cost(liters) * 1.6 + 40);
    this.wallet?.add(-cost, 'fuel', `جركن طوارئ ${liters.toFixed(1)} لتر`);
    t.level += liters;
    this._save();
    return cost;
  }

  _save() {
    const o = {};
    for (const [k, t] of Object.entries(this.tanks)) o[k] = Math.round(t.level * 100) / 100;
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* */ }
  }
}
