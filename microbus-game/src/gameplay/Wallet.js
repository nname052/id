// =====================================================================
//  المحفظة: رصيد حقيقي بيتحفظ (localStorage) + سجل حركات (دخل: أجرة — مصاريف: بنزين، مخالفات...)
// =====================================================================
const KEY = 'egy-wallet-v1';
const START = 250; // فلوس بنزين أول يوم

export class Wallet {
  constructor(hud = null) {
    this.hud = hud;
    this.balance = START;
    this.tx = [];
    this.listeners = new Set();
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { data = null; }
    if (data && Number.isFinite(data.balance)) {
      this.balance = data.balance;
      this.tx = Array.isArray(data.tx) ? data.tx.slice(-80) : [];
    } else {
      // أول مرة: نكمّل على الفلوس القديمة (لو كان فيه) — ومحدش يبدأ بأقل من فلوس بنزين
      let old = 0;
      try { old = +(localStorage.getItem('egy-microbus-money') || 0) || 0; } catch { old = 0; }
      this.balance = Math.max(START, Math.round(old));
      this.tx = [{ t: Date.now(), amount: this.balance, kind: 'start', label: 'رصيد البداية' }];
      this._save();
    }
  }

  /** دخل (موجب) أو مصروف (سالب). force: المخالفة بتتخصم حتى لو الرصيد مايكفيش (بيبقى عليك) */
  add(amount, kind, label) {
    const a = Math.round(amount * 100) / 100;
    if (!a) return;
    this.balance = Math.round((this.balance + a) * 100) / 100;
    this.tx.push({ t: Date.now(), amount: a, kind, label });
    if (this.tx.length > 80) this.tx.shift();
    this._save();
    this.hud?.setMoney?.(this.balance);
    for (const f of this.listeners) f(a, kind, label);
  }

  /** مصروف لازم يكون معاك تمنه (البنزين مثلًا) */
  spend(amount, kind, label) {
    if (amount > this.balance + 1e-6) return false;
    this.add(-amount, kind, label);
    return true;
  }

  /** مجموع نوع معين (للتقارير) */
  total(kind) { return this.tx.filter((t) => t.kind === kind).reduce((s, t) => s + t.amount, 0); }

  _save() { try { localStorage.setItem(KEY, JSON.stringify({ balance: this.balance, tx: this.tx })); } catch { /* مفيش تخزين */ } }
}
