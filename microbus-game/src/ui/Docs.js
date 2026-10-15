// =====================================================================
//  لوحة "المحفظة والرخص" (🪪): الرصيد وآخر الحركات، البنزين، يوم اللعبة، والرخص (مع تجديد)
// =====================================================================
import { LICENSE } from '../gameplay/Licenses.js';

const ID_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v10h16V7H4zm2 2h5v2H6V9zm0 3h8v2H6v-2zm10-3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>';
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Docs {
  constructor(game, touchTop) {
    this.g = game;
    const btn = document.createElement('button');
    btn.className = 'set-btn'; btn.setAttribute('aria-label', 'المحفظة والرخص'); btn.innerHTML = ID_SVG;
    if (touchTop) touchTop.prepend(btn);
    else { btn.classList.add('set-btn-fixed', 'docs-btn'); document.body.appendChild(btn); }
    const p = (this.panel = document.createElement('div'));
    p.id = 'docs'; p.className = 'hidden';
    p.innerHTML = '<div class="set-card"><div class="set-head"><b>المحفظة والرخص</b><button class="set-close" aria-label="قفل">✕</button></div><div class="docs-body"></div></div>';
    document.body.appendChild(p);
    this.body = p.querySelector('.docs-body');
    const toggle = (show) => { this.open = show; p.classList.toggle('hidden', !show); if (show) this.render(); };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); toggle(!this.open); });
    p.querySelector('.set-close').addEventListener('click', () => toggle(false));
    p.addEventListener('pointerdown', (e) => { if (e.target === p) toggle(false); e.stopPropagation(); });
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-renew]');
      if (b && this.g.licenses.renew(b.dataset.renew)) this.render();
    });
    this.toggle = toggle;
    this._t = 0;
  }

  update(dt) { if (this.open && (this._t -= dt) <= 0) { this._t = 1; this.render(); } }

  render() {
    const { wallet, licenses, fuel, player } = this.g;
    const kind = player.kind, L = licenses;
    const hh = Math.floor((L.dayT / 900) * 24), mm = Math.floor(((L.dayT / 900) * 24 * 60) % 60);
    const tx = wallet.tx.slice(-6).reverse().map((t) => `<div class="dx-row"><span>${esc(t.label)}</span><b class="${t.amount < 0 ? 'neg' : 'pos'}">${t.amount > 0 ? '+' : ''}${Math.round(t.amount)} ج</b></div>`).join('');
    const lic = (k) => {
      const ok = L.valid(k), left = L.daysLeft(k);
      return `<div class="dx-row"><span>${esc(LICENSE[k].name)}<small>${ok ? (left === 0 ? 'آخر يوم النهارده' : `سارية لحد يوم ${L.exp[k]}`) : 'منتهية ⚠️'}</small></span>
        <button class="dx-renew ${ok ? '' : 'warn'}" data-renew="${k}">جدّد · ${LICENSE[k].fee} ج</button></div>`;
    };
    const t = fuel.tank;
    this.body.innerHTML = `
      <div class="dx-sec"><div class="dx-row big"><span>الرصيد</span><b class="${wallet.balance < 0 ? 'neg' : ''}">${Math.round(wallet.balance)} ج</b></div>${tx}</div>
      <div class="dx-sec"><div class="dx-row"><span>يوم ${L.day} · الساعة ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}</span><small>اليوم = ربع ساعة لعب</small></div></div>
      <div class="dx-sec"><div class="dx-row"><span>⛽ ${esc(t.spec.type)}</span><b>${Math.round((t.level / t.capacity) * 100)}% · ${t.level.toFixed(1)}/${t.capacity} لتر</b></div><small>التفويل من بنزينة الترعة (على الخريطة)</small></div>
      <div class="dx-sec">${lic('driver')}${lic(kind)}</div>`;
  }
}
