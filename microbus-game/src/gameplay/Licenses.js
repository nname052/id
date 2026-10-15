// =====================================================================
//  الرخص + أيام اللعبة: رخصة السواقة (ليك) ورخصة لكل عربية. يوم اللعبة = ربع ساعة لعب.
//  الرخصة بتنتهي بعد كام يوم ولازم تجددها (بفلوس من المحفظة) — والكمين بيفتش عليها.
// =====================================================================
const KEY = 'egy-licenses-v2';
// يوم اللعبة = 8 دقايق لعب، والرخص قصيرة (يومين/تلاتة) → لازم تجددها كل شوية والكماين ليها لازمة
export const DAY_SECONDS = 8 * 60;
export const LICENSE = {
  driver: { name: 'رخصة القيادة', fee: 150, days: 3 },
  microbus: { name: 'رخصة الميكروباص', fee: 200, days: 2 },
  taxi: { name: 'رخصة التاكسي', fee: 160, days: 2 },
  tuktuk: { name: 'رخصة التوكتوك', fee: 100, days: 2 },
};

export class Licenses {
  constructor({ wallet, hud } = {}) {
    this.wallet = wallet; this.hud = hud;
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
    if (d && Number.isFinite(d.day)) Object.assign(this, { day: d.day, dayT: d.dayT || 0, exp: d.exp || {} });
    else { this.day = 1; this.dayT = 0; this.exp = { driver: 3, microbus: 2, taxi: 2, tuktuk: 2 }; this._save(); }
    for (const k of Object.keys(LICENSE)) if (!Number.isFinite(this.exp[k])) this.exp[k] = this.day + 3;
    this._saveT = 10;
  }

  /** الوقت بيعدّي وإنت بتلعب بس */
  update(dt) {
    this.dayT += dt;
    if (this.dayT >= DAY_SECONDS) {
      this.dayT -= DAY_SECONDS; this.day++;
      const soon = Object.keys(LICENSE).filter((k) => this.exp[k] - this.day === 0);
      const gone = Object.keys(LICENSE).filter((k) => this.exp[k] - this.day === -1);
      this.hud?.toast(`🌅 يوم ${this.day}${gone.length ? ` — انتهت: ${gone.map((k) => LICENSE[k].name).join('، ')}` : soon.length ? ` — آخر يوم: ${soon.map((k) => LICENSE[k].name).join('، ')}` : ''}`, 4);
      this._save();
    }
    this._saveT -= dt;
    if (this._saveT <= 0) { this._saveT = 10; this._save(); }
  }

  valid(k) { return this.exp[k] >= this.day; }
  daysLeft(k) { return this.exp[k] - this.day; }

  /** اللي ناقص للعربية دي (للكمين): ['driver','taxi'...] */
  problems(kind) { return ['driver', kind].filter((k) => !this.valid(k)); }

  /** سحب الرخص (الشرطة مسكتك): بتبقى منتهية ولازم تجددها */
  revoke(keys) {
    for (const k of keys) if (this.exp[k] !== undefined) this.exp[k] = this.day - 1;
    this._save();
  }

  renew(k) {
    const L = LICENSE[k];
    if (!L) return false;
    if (!this.wallet?.spend(L.fee, 'license', `تجديد ${L.name}`)) { this.hud?.toast(`الفلوس مش مكفية (${L.fee} ج)`, 2.5); return false; }
    this.exp[k] = Math.max(this.exp[k], this.day) + L.days;
    this._save();
    this.hud?.toast(`🪪 ${L.name} اتجددت لحد يوم ${this.exp[k]}`, 3);
    return true;
  }

  _save() { try { localStorage.setItem(KEY, JSON.stringify({ day: this.day, dayT: Math.round(this.dayT), exp: this.exp })); } catch { /* */ } }
}
